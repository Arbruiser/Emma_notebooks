import { findPage, pages } from "./content";

export interface GlossaryEntry {
  /** Canonical term as written in the glossary table. */
  term: string;
  /** Plain-text definition. */
  definition: string;
}

/** Strip the small set of inline markdown markers we expect in table cells. */
function stripInlineMarkdown(value: string): string {
  return value
    .replace(/`([^`]*)`/g, "$1") // inline code
    .replace(/\*\*([^*]+)\*\*/g, "$1") // bold
    .replace(/\*([^*]+)\*/g, "$1") // italic
    .replace(/__([^_]+)__/g, "$1") // bold (underscores)
    .replace(/_([^_]+)_/g, "$1") // italic (underscores)
    .trim();
}

/** Split a markdown table row into trimmed cell values. `\|` is a literal pipe. */
function parseRow(line: string): string[] | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|")) return null;
  // Drop the leading/trailing pipe, then split on unescaped pipes.
  const inner = trimmed.replace(/^\|/, "").replace(/(?<!\\)\|\s*$/, "");
  return inner.split(/(?<!\\)\|/).map((c) => c.replace(/\\\|/g, "|").trim());
}

/** A separator row looks like | :--- | :--- |. */
function isSeparatorRow(cells: string[]): boolean {
  return cells.every((c) => /^:?-{3,}:?$/.test(c.replace(/\s/g, "")));
}

let cache: Map<string, GlossaryEntry> | null = null;

/**
 * Parse the first two-column markdown table in the glossary page into a
 * case-insensitive lookup of term -> definition. Result is memoised.
 */
export function getGlossary(): Map<string, GlossaryEntry> {
  if (cache) return cache;

  const map = new Map<string, GlossaryEntry>();
  const page = findPage("glossary");
  if (!page) {
    cache = map;
    return map;
  }

  const lines = page.body.split(/\r?\n/);
  // The glossary page can hold several term tables (e.g. one per chapter).
  // `inTable` is true once we've passed a table's header separator; any
  // non-table line (blank line, heading, `---` rule) ends the current table
  // so the next table's header row is skipped instead of parsed as an entry.
  let inTable = false;

  for (const line of lines) {
    const cells = parseRow(line);
    if (!cells || cells.length < 2) {
      inTable = false;
      continue;
    }

    if (isSeparatorRow(cells)) {
      inTable = true;
      continue;
    }

    // Skip the literal "Term | Definition" header row that precedes each
    // separator — only data rows below a separator become entries.
    if (!inTable) continue;

    const term = stripInlineMarkdown(cells[0]);
    const definition = stripInlineMarkdown(cells[1]);
    if (!term || !definition) continue;

    const key = term.toLowerCase();
    if (map.has(key)) {
      console.warn(
        `[glossary] ${page.path}: "${term}" is defined more than once, so only its last row is used. Remove or merge the duplicate rows.`,
      );
    }
    map.set(key, { term, definition });
  }

  cache = map;
  return map;
}

/** Look up a definition by term (case-insensitive). */
export function lookupTerm(term: string): GlossaryEntry | undefined {
  return getGlossary().get(term.trim().toLowerCase());
}

const HTML_ESCAPE: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (c) => HTML_ESCAPE[c]);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Regular English plurals of a lowercase term: -s, -es, and consonant + y to -ies. */
function pluralForms(term: string): string[] {
  const forms = [`${term}s`, `${term}es`];
  if (/[^aeiou]y$/.test(term)) forms.push(`${term.slice(0, -1)}ies`);
  return forms;
}

let formsCache: Map<string, GlossaryEntry> | null = null;

/**
 * Every recognised form (lowercase) of every term, mapped to its entry.
 * A real glossary term always wins over a plural form of another term.
 */
function getForms(glossary: Map<string, GlossaryEntry>): Map<string, GlossaryEntry> {
  if (formsCache) return formsCache;
  const forms = new Map(glossary);
  for (const [key, entry] of glossary) {
    for (const form of pluralForms(key)) {
      if (!forms.has(form)) forms.set(form, entry);
    }
  }
  formsCache = forms;
  return forms;
}

let patternCache: RegExp | null = null;

/**
 * One regex that matches any form of any glossary term (longest first so
 * multi-word terms and plurals win), captured in group 1, with an optional
 * trailing percent marker in group 2. Word boundaries keep "Markdown" from
 * matching inside "Markdownish".
 */
function buildPattern(glossary: Map<string, GlossaryEntry>): RegExp {
  if (patternCache) return patternCache;
  const terms = [...getForms(glossary).keys()]
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp);
  patternCache = new RegExp(
    `(?<![\\p{L}\\p{N}])(${terms.join("|")})(?![\\p{L}\\p{N}])(%?)`,
    "giu",
  );
  return patternCache;
}

function spanFor(entry: GlossaryEntry, displayed: string): string {
  return `<span class="glossary-term" data-term="${escapeHtml(
    entry.term,
  )}">${escapeHtml(displayed)}</span>`;
}

function processSegment(
  text: string,
  glossary: Map<string, GlossaryEntry>,
  pattern: RegExp,
  linked: Set<string>,
): string {
  pattern.lastIndex = 0;
  return text.replace(pattern, (full, termText: string, pct: string) => {
    // Only an explicit `%` marker creates a link — no automatic matching, so
    // there are never false positives on ordinary prose.
    if (pct !== "%") return full;
    const entry = resolveEntry(termText, glossary, linked);
    if (!entry) return full;
    return spanFor(entry, termText);
  });
}

/** Resolve a term or one of its plurals and record it as linked. */
function resolveEntry(
  rawTerm: string,
  glossary: Map<string, GlossaryEntry>,
  linked: Set<string>,
): GlossaryEntry | undefined {
  const key = rawTerm.replace(/\s+/g, " ").trim().toLowerCase();
  const entry = getForms(glossary).get(key);
  if (!entry) return undefined;
  linked.add(entry.term.toLowerCase());
  return entry;
}

/**
 * Matches an inline code span (`` `code` ``, ``` ``code`` ```) with an
 * optional trailing `%` marker after the closing backticks. Group 1 is the
 * opening backtick run, group 2 the code content, group 3 the optional
 * trailing marker.
 */
const CODE_SPAN = /(`+)([\s\S]+?)\1(%?)/g;

/**
 * Matches a bold/italic token whose `%` marker sits either just inside the
 * closing delimiter (`*term%*`) or just outside it (`*term*%`). Inline code
 * is handled separately by CODE_SPAN. Group 1 is the delimiter, group 2 the
 * inner text, group 3 the optional trailing marker.
 */
const FORMATTED_MARKER = /(\*\*|__|\*|_)([\s\S]+?)\1(%?)/g;

/**
 * Handle a `%` marker sitting outside an inline code span's closing backticks
 * (`` `git clone`% ``): the whole chip is the term, so the glossary span
 * wraps the code token. Markers *inside* the code content (`` `pip%` ``,
 * `` `pip% install` ``) are left untouched here — raw glossary HTML between
 * backticks would render as literal text — and are resolved at render time
 * by the inline-code component via splitCodeGlossaryMarkers, which places
 * the trigger around just the term inside the rendered chip.
 */
function processCodeSpan(
  delim: string,
  inner: string,
  trailing: string,
  glossary: Map<string, GlossaryEntry>,
  linked: Set<string>,
): string {
  if (trailing === "%") {
    const entry = resolveEntry(inner.trim(), glossary, linked);
    if (entry) return spanFor(entry, `${delim}${inner}${delim}`);
    onUnknownMarker?.(`${delim}${inner}${delim}`);
    return `${delim}${inner}${delim}${trailing}`;
  }
  return `${delim}${inner}${delim}`;
}

export interface CodeGlossarySegment {
  /** Text to render (marker `%` stripped, `\%` unescaped). */
  text: string;
  /** Canonical glossary term when this segment should be a trigger. */
  term?: string;
}

/**
 * Split inline-code text on `Term%` glossary markers for render-time
 * resolution. Segments with `term` set should be wrapped in a glossary
 * trigger; other segments render as-is. Unresolvable markers keep their
 * literal `%`, and `\%` unescapes to a literal `%`.
 */
export function splitCodeGlossaryMarkers(text: string): CodeGlossarySegment[] {
  const unescape = (value: string) => value.replace(/\\%/g, "%");
  const glossary = getGlossary();
  if (glossary.size === 0 || !text.includes("%")) return [{ text: unescape(text) }];

  const pattern = buildPattern(glossary);
  const segments: CodeGlossarySegment[] = [];
  let cursor = 0;
  pattern.lastIndex = 0;
  for (let m = pattern.exec(text); m !== null; m = pattern.exec(text)) {
    const [full, termText, pct] = m;
    if (pct !== "%") continue;
    const entry = resolveEntry(termText, glossary, new Set());
    if (!entry) continue;
    if (m.index > cursor) segments.push({ text: unescape(text.slice(cursor, m.index)) });
    segments.push({ text: termText, term: entry.term });
    cursor = m.index + full.length;
  }
  if (cursor < text.length) segments.push({ text: unescape(text.slice(cursor)) });
  return segments;
}

/** Placeholder delimiter used to shield processed code spans from the later
 *  passes — a private-use codepoint that never appears in markdown content. */
const SHIELD = String.fromCharCode(0xe000);
const SHIELDED_CODE_SPAN = new RegExp(`${SHIELD}(\\d+)${SHIELD}`, "g");

function processText(
  text: string,
  glossary: Map<string, GlossaryEntry>,
  pattern: RegExp,
  linked: Set<string>,
): string {
  // 1) Inline code spans. Handle their markers now and shield their
  //    contents behind placeholders so the passes below never touch them.
  const codeSpans: string[] = [];
  text = text.replace(CODE_SPAN, (_full, delim: string, inner: string, trailing: string) => {
    codeSpans.push(processCodeSpan(delim, inner, trailing, glossary, linked));
    return `${SHIELD}${codeSpans.length - 1}${SHIELD}`;
  });

  // 2) Bold/italic terms with the `%` marker inside or outside the delimiters.
  text = text.replace(FORMATTED_MARKER, (full, delim: string, inner: string, trailing: string) => {
    let term: string;
    if (inner.endsWith("%")) {
      term = inner.slice(0, -1);
    } else if (trailing === "%") {
      term = inner;
    } else {
      return full; // no marker — leave the formatting for markdown to render
    }
    const entry = resolveEntry(term.trim(), glossary, linked);
    if (!entry) return full;
    return spanFor(entry, `${delim}${term}${delim}`);
  });

  // 3) Plain-text terms with a trailing `%`.
  text = processSegment(text, glossary, pattern, linked);
  if (onUnknownMarker) {
    for (const m of text.matchAll(UNKNOWN_MARKER)) onUnknownMarker(m[1]);
  }
  // Unescape \% to %
  text = text.replace(/\\%/g, "%");

  // 4) Restore the shielded code spans.
  return text.replace(SHIELDED_CODE_SPAN, (_m, n: string) => codeSpans[Number(n)]);
}

function processLine(
  line: string,
  glossary: Map<string, GlossaryEntry>,
  pattern: RegExp,
  linked: Set<string>,
): string {
  // Markdown links: only the link text is processed, never the URL.
  const parts = line.split(/(\[[^\]]*\]\([^)]*\))/g);
  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 0) {
      parts[i] = processText(parts[i], glossary, pattern, linked);
      continue;
    }
    // An image's alt text cannot hold markup, so images stay untouched.
    if (parts[i - 1].endsWith("!")) continue;
    const close = parts[i].indexOf("](");
    const text = parts[i].slice(1, close);
    // `[Term](url)%`: the whole link text is the term.
    if (parts[i + 1].startsWith("%")) {
      const entry = resolveEntry(text, glossary, linked);
      if (entry) {
        parts[i] = `[${spanFor(entry, text)}${parts[i].slice(close)}`;
        parts[i + 1] = parts[i + 1].slice(1);
        continue;
      }
      onUnknownMarker?.(text);
    }
    parts[i] = `[${processText(text, glossary, pattern, linked)}${parts[i].slice(close)}`;
  }
  return parts.join("");
}

/** A `%` straight after a word (or a closing `*`/`_`) that no term claimed. A
 *  letter or digit after it means a URL escape such as `%20`, not a marker. */
const UNKNOWN_MARKER = /([^\s%]*[\p{L}*_])%(?![\p{L}\p{N}])/gu;

/** Receives each unresolved marker while the load-time check below runs. */
let onUnknownMarker: ((marker: string) => void) | null = null;

/**
 * Warn about every `%` marker that matches no glossary term, usually a typo,
 * which would otherwise just show its `%` with no error. Runs once on load,
 * like the checks in content.ts, so it appears in the dev console and the CI
 * build log.
 */
function warnAboutUnknownMarkers() {
  if (getGlossary().size === 0) return;
  for (const page of pages) {
    if (page.slug === "glossary") continue;
    const unknown = new Set<string>();
    onUnknownMarker = (marker) => unknown.add(marker);
    applyGlossaryMarkers(page.body);
    onUnknownMarker = null;
    for (const marker of unknown) {
      console.warn(
        `[glossary] ${page.path}: "${marker}%" matches no term in content/glossary.md, so the percent sign shows as typed. Check the spelling against the glossary table.`,
      );
    }
  }
}

/**
 * Turn glossary terms in a markdown source into glossary `<span>` HTML.
 *
 * - Only the explicit `Term%` marker creates a link; the `%` itself is removed
 *   from the output. There is no automatic matching, so ordinary prose never
 *   produces false-positive links.
 * - Matching is case-insensitive and multi-word terms win over shorter ones.
 * - Markers work in any line, including headings, callouts, and table rows.
 *   A marker outside inline code (`` `pip`% ``) makes the whole chip the
 *   trigger; markers inside code content (`` `pip%` ``, `` `pip% install` ``)
 *   pass through untouched and are resolved at render time (see
 *   splitCodeGlossaryMarkers). Fenced code blocks, link URLs, and image alt
 *   text are skipped; link text is processed.
 */
export function applyGlossaryMarkers(source: string): string {
  const glossary = getGlossary();
  if (glossary.size === 0) return source;

  const pattern = buildPattern(glossary);
  const linked = new Set<string>();

  const lines = source.split(/\r?\n/);
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*(```|~~~)/.test(lines[i])) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    lines[i] = processLine(lines[i], glossary, pattern, linked);
  }
  return lines.join("\n");
}

// Last, so every constant the check uses is already initialised.
warnAboutUnknownMarkers();

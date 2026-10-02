import { load as parseYaml } from "js-yaml";
import {
  firstHeading,
  isFixedUrl,
  isNotebookPath,
  notebookToMarkdown,
  rewriteOutsideCode,
  toFrontMatter,
} from "./notebook";

/**
 * A Jupyter Book as the site.
 *
 * A course that already is a Jupyter Book keeps its layout exactly as it is:
 * `_toc.yml` at the repository root lists the pages, and the site follows it.
 *
 *     root: README.md                    -> the home page, at /
 *     parts:
 *       - caption: Materials             -> a heading in the sidebar
 *         chapters:
 *           - file: material/README.md   -> /material/
 *             sections:
 *               - file: material/01_LLMs -> /material/01_LLMs/, nested under it
 *
 * Pages keep the order and nesting the TOC gives them, a `title:` in the TOC
 * overrides the page's own heading, and `_config.yml`'s `title` names the site.
 * A file may be listed with or without its `.md`/`.ipynb` extension, as Jupyter
 * Book allows.
 *
 * The folders the pages live in are published as they are, so a picture shown
 * as `./images/plot.png` from `material/01_LLMs.ipynb` is served from
 * `<site>/material/images/plot.png`. Relative links keep working exactly as
 * they do in Jupyter or on GitHub: they are rewritten here to the published
 * path of whatever they point at, and a link to another page's file becomes a
 * link to that page.
 *
 * When there is no `_toc.yml`, none of this applies and the site is built from
 * `content/` as usual.
 *
 * Imported both by `content.ts` (in the browser bundle) and by `vite.config.ts`
 * (in Node), so like `notebook.ts` this module must stay free of `import.meta`.
 */
export const TOC_FILE = "_toc.yml";
export const CONFIG_FILE = "_config.yml";

export interface BookPage {
  /** Path from the repository root, e.g. `material/01_LLMs.ipynb`. */
  path: string;
  slug: string;
  /** The page this one is listed under in `sections:`. */
  parentSlug?: string;
  /** Position in the TOC, so siblings sort the way they are listed. */
  navOrder: number;
  /** A `title:` given in the TOC, which wins over the page's own heading. */
  title?: string;
  /** The `caption:` of the part a top-level chapter belongs to. */
  caption?: string;
}

export interface Book {
  pages: BookPage[];
  /** Top-level folders holding pages, published as they are. */
  folders: string[];
  page(repoPath: string): BookPage | undefined;
  /** Slug of the page a repo-relative file is, or undefined when it is not one. */
  slugOf(repoPath: string): string | undefined;
}

interface TocEntry {
  file?: unknown;
  title?: unknown;
  caption?: unknown;
  sections?: unknown;
  chapters?: unknown;
  parts?: unknown;
}

function asEntries(value: unknown): TocEntry[] {
  return Array.isArray(value)
    ? value.filter((v): v is TocEntry => !!v && typeof v === "object")
    : [];
}

function asText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** `a/b/../c/./d` as `a/c/d`; null when it climbs above the repository root. */
function normalizePath(path: string): string | null {
  const out: string[] = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (!out.length) return null;
      out.pop();
    } else out.push(part);
  }
  return out.join("/");
}

const FOLDER_INDEX = /(^|\/)(readme|index)$/i;

/** `material/01_LLMs.ipynb` is `material/01_LLMs`; `material/README.md` is `material`. */
function slugFor(repoPath: string): string {
  return repoPath.replace(/\.(md|ipynb)$/i, "").replace(FOLDER_INDEX, "");
}

/**
 * The book `_toc.yml` describes, or undefined when there is none (or it lists
 * no page that exists). `exists` says whether a repo-relative file is there.
 */
export function readBook(
  tocRaw: string | undefined,
  exists: (repoPath: string) => boolean,
  warn?: (message: string) => void,
): Book | undefined {
  if (!tocRaw) return undefined;
  let toc: TocEntry & { root?: unknown };
  try {
    toc = (parseYaml(tocRaw) ?? {}) as TocEntry & { root?: unknown };
  } catch {
    warn?.(`${TOC_FILE} is not valid YAML, so the site is built from content/ instead.`);
    return undefined;
  }

  const pages: BookPage[] = [];
  const byPath = new Map<string, BookPage>();

  const resolve = (file: string): string | undefined => {
    const path = normalizePath(file.replace(/\\/g, "/"));
    if (!path) return undefined;
    const candidates = /\.(md|ipynb)$/i.test(path) ? [path] : [`${path}.md`, `${path}.ipynb`, path];
    return candidates.find(exists);
  };

  const add = (entry: TocEntry, parentSlug?: string, caption?: string, isRoot = false) => {
    const file = asText(entry.file);
    if (!file) return undefined;
    const path = resolve(file);
    if (!path) {
      warn?.(`${TOC_FILE} lists "${file}", but there is no such .md or .ipynb file.`);
      return undefined;
    }
    if (byPath.has(path)) {
      warn?.(`${TOC_FILE} lists "${file}" more than once; only the first is used.`);
      return undefined;
    }
    const page: BookPage = {
      path,
      slug: isRoot ? "" : slugFor(path),
      parentSlug,
      navOrder: pages.length,
      title: asText(entry.title),
      caption,
    };
    pages.push(page);
    byPath.set(path, page);
    return page;
  };

  const walk = (entry: TocEntry, parentSlug?: string, caption?: string) => {
    const page = add(entry, parentSlug, caption);
    // A section without a file of its own still lists its sections, under
    // whatever this entry sits under.
    for (const section of asEntries(entry.sections)) walk(section, page?.slug ?? parentSlug);
  };

  add({ file: toc.root }, undefined, undefined, true);
  const parts = Array.isArray(toc.parts) ? asEntries(toc.parts) : [{ chapters: toc.chapters }];
  for (const part of parts) {
    const caption = asText(part.caption);
    for (const chapter of asEntries(part.chapters)) walk(chapter, undefined, caption);
  }
  if (!pages.length) return undefined;

  const folders = [
    ...new Set(pages.filter((p) => p.path.includes("/")).map((p) => p.path.split("/")[0])),
  ];
  return {
    pages,
    folders,
    page: (repoPath) => byPath.get(repoPath),
    slugOf: (repoPath) => byPath.get(repoPath)?.slug,
  };
}

/** The site's name from `_config.yml`, or "" when it gives none. */
export function bookTitle(configRaw: string | undefined): string {
  if (!configRaw) return "";
  try {
    const config = parseYaml(configRaw) as { title?: unknown } | null;
    return asText(config?.title) ?? "";
  } catch {
    return "";
  }
}

function decode(path: string): string {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

// Every place a markdown or HTML text can hold an address. Images and links
// share the `](url)` form, so one pattern covers both.
const MARKDOWN_URL = /(\]\([ \t]*<?)([^)<>\s]+)/g;
const REFERENCE_URL = /^([ \t]{0,3}\[[^\]]+\]:[ \t]*<?)([^\s>]+)/;
const HTML_URL =
  /(<(?:a|img|source|video|audio|iframe)\b[^>]*?\b(?:href|src)[ \t]*=[ \t]*")([^"]+)/gi;

/**
 * Rewrite every relative address in `text`, a file in the folder `fromDir`, to
 * where the thing it points at is published. A page's file becomes the page
 * (`/material/01_LLMs#training`); anything else becomes its repo-relative path
 * (`material/images/plot.png`), which the renderer resolves against the site's
 * base path. Each such file is reported to `onFile` so the build can check it.
 */
function rebaseUrls(
  text: string,
  fromDir: string,
  book: Book,
  onFile?: (repoPath: string) => void,
): string {
  const move = (url: string): string => {
    if (isFixedUrl(url)) return url;
    const split = /^([^?#]*)(.*)$/.exec(url);
    if (!split || !split[1]) return url;
    const target = normalizePath(`${fromDir}/${split[1]}`);
    if (target === null) return url;
    const slug = book.slugOf(decode(target));
    if (slug !== undefined) return `/${slug}${split[2]}`;
    onFile?.(decode(target));
    return target + split[2];
  };
  return rewriteOutsideCode(text, (prose) =>
    prose
      .replace(MARKDOWN_URL, (_all, before: string, url: string) => before + move(url))
      .replace(HTML_URL, (_all, before: string, url: string) => before + move(url))
      .replace(REFERENCE_URL, (_all, before: string, url: string) => before + move(url)),
  );
}

export interface BookOptions {
  /** Called with the repo-relative path of every file a page links to or shows,
   *  so the build can check that it exists and is published. */
  onFile?: (repoPath: string) => void;
}

/**
 * One page file of the book as the markdown of its page(s), front matter
 * included, with every relative address rewritten to its published place.
 */
export function bookMarkdown(
  raw: string,
  repoPath: string,
  book: Book,
  warn?: (message: string) => void,
  options?: BookOptions,
): string {
  let text = isNotebookPath(repoPath)
    ? notebookToMarkdown(raw, repoPath, warn, { keepImagePaths: true })
    : raw;
  // A README written for GitHub or Jupyter Book has no front matter: title the
  // page after its heading, as a notebook is.
  if (!isNotebookPath(repoPath) && !/^\uFEFF?---[ \t]*\r?\n/.test(text)) {
    const name = repoPath.slice(repoPath.lastIndexOf("/") + 1).replace(/\.md$/i, "");
    text = `${toFrontMatter({ title: firstHeading(text) || name })}\n\n${text}`;
  }
  const fromDir = repoPath.includes("/") ? repoPath.slice(0, repoPath.lastIndexOf("/")) : "";
  return rebaseUrls(text, fromDir, book, options?.onFile);
}

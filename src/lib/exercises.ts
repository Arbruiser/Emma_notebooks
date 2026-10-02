import {
  firstHeading,
  isFixedUrl,
  isNotebookPath,
  notebookToMarkdown,
  rewriteOutsideCode,
  toFrontMatter,
} from "./notebook";

/**
 * The `exercises/` folder as a section of the site.
 *
 * Exercise notebooks are kept as a folder people can also download and open in
 * Jupyter as it is: notebooks side by side, pictures in `images/`, data files
 * next to the code that reads them. Rather than ask the author to copy all of
 * that into `content/` and `public/assets/`, the site reads the folder in place:
 *
 * - every `.ipynb` (and `.md`) in it is a page under `/exercises/…`;
 * - its `README.md` is the section's own page at `/exercises`, and every other
 *   page in the folder nests under it in the sidebar;
 * - every other file (pictures, data, the notebooks themselves) is published at
 *   the same path, so `exercises/images/plot.png` is served as
 *   `<site>/exercises/images/plot.png`.
 *
 * Relative links therefore keep working exactly as they do in Jupyter or on
 * GitHub: they are rewritten here to the published path of whatever they point
 * at, and a link to another notebook or `.md` file becomes a link to its page.
 *
 * Imported both by `content.ts` (in the browser bundle) and by `vite.config.ts`
 * (in Node), so like `notebook.ts` this module must stay free of `import.meta`.
 */
export const EXERCISES_DIR = "exercises";

/** Where the section sits in the sidebar when its README sets no `nav_order`:
 *  after the chapters in `content/`, before the glossary (99). */
const DEFAULT_NAV_ORDER = 50;

const FOLDER_INDEX = /(^|\/)(readme|index)\.md$/i;

/** True for a repo-relative path inside `exercises/`, e.g. `exercises/07_rag.ipynb`. */
export function isExercisesPath(repoPath: string): boolean {
  return repoPath.startsWith(`${EXERCISES_DIR}/`);
}

/**
 * Page slug of a repo-relative page file in `exercises/`:
 * `exercises/README.md` is `exercises`, `exercises/07_rag.ipynb` is
 * `exercises/07_rag`, and `exercises/extra/README.md` is `exercises/extra`.
 */
export function exercisesSlug(repoPath: string): string {
  if (FOLDER_INDEX.test(repoPath)) return repoPath.replace(FOLDER_INDEX, "");
  return repoPath.replace(/\.(md|ipynb)$/i, "");
}

/** The slug of the section's own page; every other exercise page nests under it. */
export const EXERCISES_SLUG = EXERCISES_DIR;

/** Slug of the page a repo-relative `.md`/`.ipynb` path is, or undefined. */
function pageSlugOf(repoPath: string): string | undefined {
  if (isExercisesPath(repoPath)) return exercisesSlug(repoPath);
  if (repoPath.startsWith("content/")) {
    const rel = repoPath.slice("content/".length).replace(/\.(md|ipynb)$/i, "");
    return rel === "index" ? "" : rel;
  }
  return undefined;
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
 * where the thing it points at is published. A page file becomes its page
 * (`/exercises/08_faiss#setup`); anything else becomes its repo-relative path
 * (`exercises/images/plot.png`), which the renderer resolves against the site's
 * base path. Each such file is reported to `onFile` so the build can check it.
 */
function rebaseUrls(text: string, fromDir: string, onFile?: (repoPath: string) => void): string {
  const move = (url: string): string => {
    if (isFixedUrl(url)) return url;
    const split = /^([^?#]*)(.*)$/.exec(url);
    if (!split || !split[1]) return url;
    const target = normalizePath(`${fromDir}/${split[1]}`);
    if (target === null) return url;
    if (/\.(md|ipynb)$/i.test(target)) {
      const slug = pageSlugOf(decode(target));
      if (slug !== undefined) return `/${slug}${split[2]}`;
    }
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

export interface ExercisesOptions {
  /** Called with the repo-relative path of every file a page links to or shows,
   *  so the build can check that it exists and is published. */
  onFile?: (repoPath: string) => void;
}

/**
 * One page file of `exercises/` as the markdown of its page(s), front matter
 * included, with every relative address rewritten to its published place.
 * `repoPath` is relative to the repository root, e.g. `exercises/07_rag.ipynb`.
 */
export function exercisesMarkdown(
  raw: string,
  repoPath: string,
  warn?: (message: string) => void,
  options?: ExercisesOptions,
): string {
  let text = isNotebookPath(repoPath)
    ? notebookToMarkdown(raw, repoPath, warn, { keepImagePaths: true })
    : raw;
  // A README is written for GitHub and has no front matter. Name the section
  // after its heading, as the home page names the site after its own.
  if (FOLDER_INDEX.test(repoPath) && !/^\uFEFF?---[ \t]*\r?\n/.test(text)) {
    const title = firstHeading(text) || "Exercises";
    const isSection = exercisesSlug(repoPath) === EXERCISES_SLUG;
    text = `${toFrontMatter({ title, nav_order: isSection ? DEFAULT_NAV_ORDER : undefined })}\n\n${text}`;
  }
  const fromDir = repoPath.slice(0, repoPath.lastIndexOf("/"));
  return rebaseUrls(text, fromDir, options?.onFile);
}

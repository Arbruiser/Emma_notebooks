import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsConfigPaths from "vite-tsconfig-paths";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { extname, join, normalize, relative } from "node:path";
import type { Plugin } from "vite";
// Note: do NOT import ./src/lib/site here — it reads import.meta.env, which is
// undefined when vite.config.ts itself runs in Node, and would crash the build.
// ./src/lib/page-blocks is deliberately free of import.meta so that both this
// file and the app split markdown into pages by exactly the same rule.
import { pageSlugs } from "./src/lib/page-blocks";
import { isNotebookPath, notebookToMarkdown } from "./src/lib/notebook";
import { CONFIG_FILE, TOC_FILE, bookMarkdown, readBook, type Book } from "./src/lib/book";

const basePath = process.env.VITE_BASE_PATH || "/";

/**
 * Every file below `dir`, skipping hidden entries such as the
 * `.ipynb_checkpoints/` folders Jupyter leaves behind.
 */
function walkFiles(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name.startsWith(".")) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walkFiles(full, out);
    else out.push(full);
  }
  return out;
}

function isPageFile(filePath: string): boolean {
  return filePath.endsWith(".md") || isNotebookPath(filePath);
}

/** Path relative to the repository root, with forward slashes. */
function repoPath(filePath: string): string {
  return relative(process.cwd(), filePath).replace(/\\/g, "/");
}

/** A repo-relative file's text, or undefined when it does not exist. */
function readIfExists(path: string): string | undefined {
  return existsSync(path) ? readFileSync(path, "utf-8") : undefined;
}

/**
 * The Jupyter Book `_toc.yml` describes, or undefined when there is none and
 * the site is built from `content/`. Read afresh on every call, so the dev
 * server follows edits to the TOC. Silent: `content.ts` reads the same TOC for
 * the app and reports any problem with it there.
 */
function loadBook(): Book | undefined {
  return readBook(readIfExists(TOC_FILE), (path) => existsSync(path) && statSync(path).isFile());
}

/** Every file that is a page: those `_toc.yml` lists, or else the markdown and
 *  notebooks in `content/`. */
function walkPages(): string[] {
  const book = loadBook();
  return book ? book.pages.map((page) => page.path) : walkFiles("content").filter(isPageFile);
}

function fileToSlug(filePath: string): string {
  const book = loadBook();
  if (book) return book.slugOf(repoPath(filePath)) ?? "";
  const rel = relative("content", filePath).replace(/\\/g, "/").replace(/\.(md|ipynb)$/, "");
  return rel === "index" ? "" : rel;
}

/**
 * A page file as markdown, converting it first when it is a notebook. Silent on
 * purpose: `content.ts` converts the same files for the app and reports any
 * problem with them there, so warning here as well would print it twice.
 */
function pageMarkdown(filePath: string, onImage?: (fileName: string) => void): string {
  const raw = readFileSync(filePath, "utf-8");
  const book = loadBook();
  if (book) return bookMarkdown(raw, repoPath(filePath), book);
  if (!isNotebookPath(filePath)) return raw;
  const rel = relative("content", filePath).replace(/\\/g, "/");
  return notebookToMarkdown(raw, rel, undefined, { onImage });
}

/**
 * Every slug one page file contributes. Usually one, but a file whose author
 * kept the subchapters inside it contributes one per front-matter block, and
 * each of those is a real page that has to be prerendered and listed.
 */
function slugsInFile(filePath: string): string[] {
  return pageSlugs(pageMarkdown(filePath), fileToSlug(filePath));
}

/**
 * Warn about a picture a notebook expects but that is not in `public/assets/`.
 *
 * Jupyter keeps a notebook's images in a folder beside it and the site serves
 * them from `public/assets/`, so a notebook brought over from Jupyter needs its
 * image files moved once. Nothing else can catch that: the page builds fine and
 * the picture is simply missing, so say so while the build is still running.
 */
function notebookImagesPlugin(): Plugin {
  // The client and server builds each start the plugin; say it once.
  let reported = false;
  return {
    name: "lumi-notebook-images",
    buildStart() {
      if (reported || loadBook()) return;
      reported = true;
      const missing = new Map<string, Set<string>>();
      for (const filePath of walkFiles("content").filter(isNotebookPath)) {
        const rel = relative("content", filePath).replace(/\\/g, "/");
        pageMarkdown(filePath, (fileName) => {
          if (existsSync(join("public", "assets", fileName))) return;
          const seen = missing.get(rel) ?? new Set<string>();
          seen.add(fileName);
          missing.set(rel, seen);
        });
      }
      for (const [rel, names] of missing) {
        console.warn(
          `[content] content/${rel}: ${[...names].join(", ")} not found in public/assets/. A notebook's pictures are served from there: move the image files into public/assets/ (the notebook itself needs no editing).`,
        );
      }
    },
  };
}

const BOOK_MODULE = "virtual:book";
const RESOLVED_BOOK_MODULE = `\0${BOOK_MODULE}`;

/**
 * Hand the Jupyter Book to the app as `virtual:book`: the TOC, the config, and
 * the text of exactly the files the TOC lists. Reading them here rather than
 * with `import.meta.glob` keeps everything else in the repository, which a
 * glob over the whole of it would sweep up, out of the site's bundle. In dev,
 * editing the TOC or any page reloads the browser with the change.
 */
function bookModulePlugin(): Plugin {
  return {
    name: "lumi-book-module",
    resolveId: (id) => (id === BOOK_MODULE ? RESOLVED_BOOK_MODULE : undefined),
    load(id) {
      if (id !== RESOLVED_BOOK_MODULE) return undefined;
      const book = loadBook();
      const files = Object.fromEntries(
        (book?.pages ?? []).map((page) => [page.path, readFileSync(page.path, "utf-8")]),
      );
      return [
        `export const tocRaw = ${JSON.stringify(readIfExists(TOC_FILE))};`,
        `export const configRaw = ${JSON.stringify(readIfExists(CONFIG_FILE))};`,
        `export const files = ${JSON.stringify(files)};`,
      ].join("\n");
    },
    configureServer(server) {
      const refresh = (file: string) => {
        const path = repoPath(file);
        const book = loadBook();
        if (path !== TOC_FILE && path !== CONFIG_FILE && !book?.page(path)) return;
        for (const environment of Object.values(server.environments)) {
          const module = environment.moduleGraph.getModuleById(RESOLVED_BOOK_MODULE);
          if (module) environment.moduleGraph.invalidateModule(module);
        }
        server.ws.send({ type: "full-reload" });
      };
      server.watcher.on("change", refresh);
      server.watcher.on("add", refresh);
      server.watcher.on("unlink", refresh);
    },
  };
}

/**
 * Publish the folders a Jupyter Book's pages live in at their own paths, so a
 * picture a notebook shows as `./images/plot.png` is served at
 * `<site>/material/images/plot.png`, and a data file or the notebook itself can
 * be downloaded from beside the page that links to it. In dev the files are
 * served straight from the folders, so a change shows on the next reload.
 *
 * Also warns, once per build, about any file a page links to that is missing
 * or not published, since the page would build fine and the link would simply
 * be dead.
 */
function bookFilesPlugin(): Plugin {
  let reported = false;
  const isPublished = (book: Book, path: string) =>
    path.startsWith("public/") || book.folders.some((folder) => path.startsWith(`${folder}/`));
  return {
    name: "lumi-book-files",
    buildStart() {
      const book = loadBook();
      if (reported || !book) return;
      reported = true;
      for (const page of book.pages) {
        const missing = new Set<string>();
        bookMarkdown(readFileSync(page.path, "utf-8"), page.path, book, undefined, {
          onFile: (target) => {
            if (!isPublished(book, target) || !existsSync(target)) missing.add(target);
          },
        });
        if (missing.size) {
          console.warn(
            `[content] ${page.path}: links to ${[...missing].join(", ")}, which is missing or outside the published folders (${book.folders.join(", ")}, public), so the link or picture is broken on the site.`,
          );
        }
      }
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const book = loadBook();
        const prefix = joinUrl(basePath, "/");
        const url = decodeURIComponent((req.url ?? "").split(/[?#]/, 1)[0]);
        if (!book || !url.startsWith(prefix)) return next();
        const file = normalize(url.slice(prefix.length)).replace(/\\/g, "/");
        // Markdown files are pages, served by the app.
        if (!isPublished(book, file) || file.startsWith("public/") || file.endsWith(".md")) {
          return next();
        }
        if (!existsSync(file) || !statSync(file).isFile()) return next();
        const type = MIME[extname(file).toLowerCase()] ?? "application/octet-stream";
        res.setHeader("Content-Type", type);
        res.end(readFileSync(file));
      });
    },
    // The client build is what gets published; the server build needs none of it.
    applyToEnvironment: (environment) => environment.name === "client",
    generateBundle() {
      const book = loadBook();
      for (const file of (book?.folders ?? []).flatMap((folder) => walkFiles(folder))) {
        // Markdown files are pages; everything else ships as is.
        if (file.endsWith(".md")) continue;
        this.emitFile({ type: "asset", fileName: repoPath(file), source: readFileSync(file) });
      }
    },
  };
}

/** Content types for the files the dev server hands out from a book's folders. */
const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".txt": "text/plain; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".json": "application/json",
  ".ipynb": "application/x-ipynb+json",
  ".pdf": "application/pdf",
};

function joinUrl(a: string, b: string) {
  return `${a.replace(/\/$/, "")}/${b.replace(/^\//, "")}`;
}

// Last commit time of a file (ISO 8601). Falls back to filesystem mtime when
// git history is unavailable (shallow clone, uncommitted file, no git).
// Requires `fetch-depth: 0` on actions/checkout in CI — a shallow clone would
// silently report the wrong date.
function lastModified(filePath: string): string {
  try {
    const out = execFileSync("git", ["log", "-1", "--format=%cI", "--", filePath], {
      encoding: "utf-8",
    }).trim();
    if (out) return out;
  } catch {
    // fall through to mtime
  }
  return statSync(filePath).mtime.toISOString();
}

// Generate sitemap.xml + robots.txt at build time from markdown content.
function sitemapPlugin(): Plugin {
  return {
    name: "lumi-sitemap",
    apply: "build",
    closeBundle() {
      try {
        const files = walkPages();
        const base = (process.env.VITE_SITE_URL || "").replace(/\/$/, "");
        if (!base) return;
        const urls = files.flatMap((f) => {
          const lastmod = lastModified(f);
          return slugsInFile(f).map((slug) => {
            // Encode spaces and accents, and escape `&` for XML (`Q&A.md`).
            const loc = encodeURI(slug === "" ? `${base}/` : `${base}/${slug}/`).replace(
              /&/g,
              "&amp;",
            );
            return `  <url><loc>${loc}</loc><lastmod>${lastmod}</lastmod></url>`;
          });
        });
        const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`;
        const robots = `User-agent: *\nAllow: /\n\nSitemap: ${joinUrl(base, "sitemap.xml")}\n`;
        // Force write to dist/client so it gets uploaded to GitHub Pages
        const finalDir = join(process.cwd(), "dist", "client");
        mkdirSync(finalDir, { recursive: true });
        writeFileSync(join(finalDir, "sitemap.xml"), xml);
        writeFileSync(join(finalDir, "robots.txt"), robots);
      } catch (e) {
        // Don't fail the build on sitemap errors.

        console.warn("[lumi-sitemap] skipped:", e);
      }
    },
  };
}

// Prerender one HTML file per content page so deep links (opened directly or
// in a new tab) are served their own fully-rendered HTML — with the correct
// sidebar item highlighted — instead of falling back to the "/" shell (which
// would always show the first/home chapter as active until JS hydrates).
function contentPages() {
  const slugs = walkPages().flatMap(slugsInFile);
  const paths = new Set<string>(["/"]);
  for (const slug of slugs) paths.add(slug === "" ? "/" : `/${slug}/`);
  return Array.from(paths).map((path) => ({
    path,
    prerender: { enabled: true, crawlLinks: true },
  }));
}

export default defineConfig({
  base: basePath,
  // Match the build's CSS pipeline in dev. @tailwindcss/vite runs Lightning CSS
  // at build, so build-time transforms (e.g. collapsing a hand-written
  // `-webkit-backdrop-filter` to the prefixed form Chrome ignores) would break
  // the built/static output while the dev preview looks fine. Running Lightning
  // CSS in both keeps the preview honest.
  css: { transformer: "lightningcss" },
  resolve: {
    alias: {
      "@": `${process.cwd()}/src`,
    },
    dedupe: [
      "react",
      "react-dom",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
      "@tanstack/react-query",
      "@tanstack/query-core",
    ],
  },
  server: { host: "::", port: 8080 },
  plugins: [
    tailwindcss(),
    tsConfigPaths({ projects: ["./tsconfig.json"] }),
    tanstackStart({
      importProtection: {
        behavior: "error",
        client: {
          files: ["**/server/**"],
          specifiers: ["server-only"],
        },
      },
      server: { entry: "server" },
      // Render the SPA shell at its own path: at the default "/" it replaces the
      // prerendered home page. The workflow serves it as 404.html.
      spa: { enabled: true, maskPath: "/_shell" },
      pages: contentPages(),
    }),
    viteReact(),
    notebookImagesPlugin(),
    bookModulePlugin(),
    bookFilesPlugin(),
    sitemapPlugin(),
  ],
});

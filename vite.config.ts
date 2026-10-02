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
import {
  EXERCISES_DIR,
  exercisesMarkdown,
  exercisesSlug,
  isExercisesPath,
} from "./src/lib/exercises";

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

/** Every file that is a page: markdown or a Jupyter notebook, in `content/`
 *  or in `exercises/`. */
function walkPages(): string[] {
  return [...walkFiles("content"), ...walkFiles(EXERCISES_DIR)].filter(isPageFile);
}

/** Path relative to the repository root, with forward slashes. */
function repoPath(filePath: string): string {
  return relative(process.cwd(), filePath).replace(/\\/g, "/");
}

function fileToSlug(filePath: string): string {
  if (isExercisesPath(repoPath(filePath))) return exercisesSlug(repoPath(filePath));
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
  if (isExercisesPath(repoPath(filePath))) return exercisesMarkdown(raw, repoPath(filePath));
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
      if (reported) return;
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

/**
 * Publish the files of `exercises/` at their own paths, so a picture the
 * notebooks show as `./images/plot.png` is served at
 * `<site>/exercises/images/plot.png`, and a data file or the notebook itself can
 * be downloaded from beside the page that links to it. In dev the files are
 * served straight from the folder, so a change shows on the next reload.
 *
 * Also warns, once per build, about any file an exercise page links to that is
 * missing, since the page would build fine and the link would simply be dead.
 */
function exercisesFilesPlugin(): Plugin {
  let reported = false;
  return {
    name: "lumi-exercises-files",
    buildStart() {
      if (reported) return;
      reported = true;
      for (const filePath of walkFiles(EXERCISES_DIR).filter(isPageFile)) {
        const missing = new Set<string>();
        exercisesMarkdown(readFileSync(filePath, "utf-8"), repoPath(filePath), undefined, {
          onFile: (target) => {
            const published = isExercisesPath(target) || target.startsWith("public/");
            if (!published || !existsSync(target)) missing.add(target);
          },
        });
        if (missing.size) {
          console.warn(
            `[content] ${repoPath(filePath)}: links to ${[...missing].join(", ")}, which is not in exercises/ (or public/), so the link or picture is broken on the site.`,
          );
        }
      }
    },
    configureServer(server) {
      const prefix = joinUrl(basePath, `${EXERCISES_DIR}/`);
      server.middlewares.use((req, res, next) => {
        const url = decodeURIComponent((req.url ?? "").split(/[?#]/, 1)[0]);
        if (!url.startsWith(prefix)) return next();
        const file = normalize(join(EXERCISES_DIR, url.slice(prefix.length))).replace(/\\/g, "/");
        // Outside the folder, or a README (a page, served by the app): not ours.
        if (!file.startsWith(`${EXERCISES_DIR}/`) || file.endsWith(".md")) return next();
        if (!existsSync(file) || !statSync(file).isFile()) return next();
        const type = MIME[extname(file).toLowerCase()] ?? "application/octet-stream";
        res.setHeader("Content-Type", type);
        res.end(readFileSync(file));
      });
    },
    // The client build is what gets published; the server build needs none of it.
    applyToEnvironment: (environment) => environment.name === "client",
    generateBundle() {
      for (const file of walkFiles(EXERCISES_DIR)) {
        // A README is a page, not a download; everything else ships as is.
        if (file.endsWith(".md")) continue;
        this.emitFile({ type: "asset", fileName: repoPath(file), source: readFileSync(file) });
      }
    },
  };
}

/** Content types for the files the dev server hands out from `exercises/`. */
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
    exercisesFilesPlugin(),
    sitemapPlugin(),
  ],
});

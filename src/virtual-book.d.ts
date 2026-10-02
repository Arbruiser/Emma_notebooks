/**
 * The Jupyter Book files, read at build time by `vite.config.ts` and handed to
 * `content.ts`. Only the files `_toc.yml` lists are included, so nothing else
 * in the repository ends up in the site's bundle.
 */
declare module "virtual:book" {
  /** `_toc.yml`, or undefined when the repository has none. */
  export const tocRaw: string | undefined;
  /** `_config.yml`, or undefined. */
  export const configRaw: string | undefined;
  /** Every page file the TOC lists, by path from the repository root. */
  export const files: Record<string, string>;
}

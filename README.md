# LUMI AI Factory — Branded Learning Template

![LUMI AI Factory logo](public/assets/LAIF_logo_dark_white_background.jpg)

This is a template for creating clean, branded self-learning course sites for the **LUMI AI Factory**. The site:

- has the LUMI AI Factory branding and colours;
- has light and dark mode (auto-follows the visitor's system, with a manual toggle);
- supports headings, lists, tables, code blocks with syntax highlighting and copy-to-clipboard, math (KaTeX), diagrams (Mermaid), images, embedded videos, and five branded callout types;
- can be edited just by adding/editing `.md` files in the `content/` folder;
- turns Jupyter notebooks into pages too: drop your `.ipynb` files into `content/` and they are rendered alongside the Markdown ones;
- names itself from your content: the top heading of `content/index.md` becomes the site title, so there is no configuration file to edit;
- can be built and published on [GitHub Pages].

## Quick start

1. Click **[Use this template]** button at the top of this repository to make your own copy (you must be logged in for the button to be there). Name it after your study materials.
2. In your new repository, go to **Settings → Pages → Build and deployment → Source** and select **GitHub Actions**.
3. Click the gear icon ⚙ next to **About** on the right side of your repo, tick **Use your GitHub Pages website**, and click **Save**. The live link now appears at the top right of the repo.
4. Make and commit any change to `content/index.md` and your website will be "built and deployed". In a minute, when the yellow circle next to your name in the repo has changed from a yellow circle to a green tick (refresh the page), you can access your website via the link that appeared in Step 3.
5. Edit `content/index.md` and add your content. To force refresh the website page (to tell your browser not to use the cached version), press ctrl + F5 on Linux and Windows, or Cmd + Shift + R on Mac. 

Every time you push a commit to your repository, the website is rebuilt and redeployed automatically (can take a minute).

The demo with examples of how to add content and new pages can be found in `content/index.md`.

## Getting template updates into your course

The template keeps improving (styling fixes, new features), if you'd like to get the latest updates and features, you have 2 ways: do it yourself (if you know how to use the command line) or ask me to do it for you (you can reach out on RC or via email).

To do it yourself:

A repository made with **Use this template** does not share git history with this template, so there is no "Sync fork" button — instead you copy the template's internals over with the commands below. Your own work is left alone: everything in `content/`, everything in `public/` (your images, logos, and any files you link to), and your `README.md` are untouched.

You need a local clone of **your** repository (`git clone <your-repo-url>`). Then, one time only, register the template as an extra remote:

```bash
git remote add template https://github.com/lumi-ai-factory/course-template.git
```

Whenever you want the latest template version (commit and push your own work first):

```bash
git fetch template
git checkout template/main -- . ":(exclude)content" ":(exclude)public" ":(exclude)README.md"
git commit -m "Pull in template updates"
git push
```

After the push, your site rebuilds and redeploys automatically as usual.

Good to know:

- Review what changed before committing with `git status`.
- If you edited the template's internals yourself (anything under `src/`, the build config, the deploy workflow), those edits are overwritten by this — re-apply them afterwards.
- Older copies of the template had a `site.config.ts` in the repository root. The site now names itself from `content/index.md`, so that file no longer does anything and can be deleted.

[GitHub Pages]: https://docs.github.com/en/pages
[use this template]: https://github.com/Arbruiser/LUMI_AIF_template/generate

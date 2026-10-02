---
title: "Chapter 1: Getting Started with LUMI"
nav_order: 2
---

# Chapter 1: Getting Started with LUMI

This is an example of an extra page. Use chapters like this to add structure and split your materials into modules instead of a single long page.

Every page here is written in Markdown% and starts with Front Matter%. Hover over those highlighted words to see their glossary definitions, defined once in `content/glossary.md`.

## Adding Subpages

You can add subpages to your site using two different methods. Both methods look exactly the same to your readers, they will appear identically in the sidebar and navigation, but they work differently under the hood.

### Method 1: Separate files

Create a new `.md` file and set its `parent` field to the main page's title. Use this method if your subpage is long or if it needs its own nested sub-subpages.

For example, this template ships with `content/chapter1-1.md`, which starts with:

```yaml
---
title: "Chapter 1.1: Subpage Example"
parent: "Chapter 1: Getting Started with LUMI"
nav_order: 1
---
```

**Key rules for Method 1:**
- The `parent` value must match the parent page's `title` exactly.
- You must manually manage `nav_order` (the order in which subpages are listed) to control their order in the sidebar.
- **Supports sub-subpages:** You can nest even deeper by creating more files and pointing their `parent` field to this subpage.

> [!warning] Before you publish
> Double-check `nav_order` across all pages so the sidebar reads top-to-bottom in the order you teach. 

### Method 2: Multiple pages in one file

To avoid creating many small files, you can append subpages directly to the bottom of the parent `.md` file. Just start a new section with its own front matter:

```yaml
---
title: "Chapter 1.2: Written Inside Chapter 1"
---
```

Everything following this block becomes a new subpage nested under the main chapter.

**Key rules for Method 2:**
- **No `parent` needed:** The file it's in is automatically the parent.
- **No `nav_order` needed:** Subpages appear in the order you write them.
- **Order matters:** These blocks must be at the very bottom of the file. All content below a block belongs to that new subpage.
- **URL generation:** The page URL is generated from the `title`.
- **No sub-subpages:** You cannot add nested sub-subpages using this method.

> [!tip] Try it out!
> Chapter 1.1 is in a separate file, while Chapter 1.2 is at the bottom of this file (`content/chapter1.md`). Open both in the sidebar to verify that they look identical.

> [!warning]
> Don't rename `index.md`: it's the home page of the site. All other pages can be named arbitrarily. All `.md` files in `content/` (except `index.md`) can be named anything you like. The URL is derived from the filename.

## Quick quiz

Test what you picked up in this chapter:

```quiz
title: Getting started with LUMI

Q: Which file is always the home page of the site?
- [ ] home.md
- [x] index.md
- [ ] readme.md
> index.md is special: every other page can be named freely.

---

Q: Which front matter fields control where a page sits in the sidebar? (select all)
- [x] nav_order
- [x] parent
- [ ] slug
- [ ] author
> nav_order sets the order and parent nests a page under another. The URL comes from the filename, not a slug field.

---

Q: How do you mark the correct answer in a quiz block?
- [ ] With an asterisk before the option
- [x] With a checked Markdown checkbox, [x]
- [ ] By writing "correct" after it
> Use - [x] for correct answers and - [ ] for wrong ones.
```

---
title: "Chapter 1.2: Written Inside Chapter 1"
---

# Chapter 1.2: Written Inside Chapter 1

This page does not have its own file. It is defined at the very bottom of `content/chapter1.md` using just a front matter block:

```yaml
---
title: "Chapter 1.2: Written Inside Chapter 1"
---
```

Despite being in the same file, it behaves like any other page. It has its own URL, sidebar entry, and navigation buttons. You can use all standard features here:

> [!tip] Same features
> Callouts, code blocks, quizzes, images, and glossary terms (like Markdown%) work exactly as they do on separate pages.

You can add as many subpages as you need using this method, making it easy to group related, short content together.
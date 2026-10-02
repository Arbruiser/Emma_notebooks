---
title: "Chapter 1.1: Subpage Example"
parent: "Chapter 1: Getting Started with LUMI"
nav_order: 1
---

# Chapter 1.1: Subpage Example

This page is a **subpage**: in the sidebar it lives under *Chapter 1: Getting Started with LUMI*. A page with children (subpages) starts collapsed and the reader can click the expand button to see the subpages. Readers click it to reveal its child pages, and it expands automatically when they navigate to any page inside it.

All it took is one extra front matter line on this page:

```yaml
parent: "Chapter 1: Getting Started with LUMI"
```

The `parent` value must match the parent page's `title` exactly. Subpages are normal pages in every other way: they support the same Markdown, callouts, quizzes and glossary terms, and they're part of the *Previous/Next* reading flow at the bottom of each page.

You can nest deeper, too: give another page `parent: "Chapter 1.1: Subpage Example"` and it will appear inside this one. `nav_order` sorts pages among their siblings at every level.

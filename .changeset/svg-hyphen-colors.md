---
"@shadcn/lint": patch
---

Check `stop-color`, `flood-color` and `lighting-color` on SVG elements in HTML, Vue and Svelte templates, not only their JSX spelling (shadcn-ui/lint#105). The names are one list for every reader, so in JSX `stop-color="red"` is checked too.

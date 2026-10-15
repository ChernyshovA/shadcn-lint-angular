---
"@shadcn/lint": patch
---

Read the `components.json` spartan's CLI writes, which has no `aliases`: when a file without them has a field of spartan's schema (`componentsPath`, `importAlias`, `buildable`, `generateAs`), its `componentsPath`, `libs/ui` by default, is the directory of the design-system components, instead of a `@/components/ui` alias that does not resolve and a warning that says so. A file with `aliases` is read as before. spartan's schema is read for Angular code, a template or a script of an Angular project; a React, Vue or Svelte file, and a file outside an Angular project, read the file as before.

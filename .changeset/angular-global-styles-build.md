---
"@shadcn/lint": patch
---

Read an Angular project's global styles as Angular builds it: a style that names a package, `"tailwindcss"`, is its stylesheet, never its JavaScript; a test target's styles are not read, so an unreadable one no longer silences the project; each project's styles are its own, so two Nx projects naming the same missing stylesheet are each said; and a workspace config with a byte order mark is read. An Nx workspace says once when it has more than 500 `project.json` files, or when a linted file's `project.json` lies deeper than the 5 directories it is read to.

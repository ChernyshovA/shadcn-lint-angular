---
"@shadcn/lint": patch
---

Warn once per workspace when no stylesheet importing Tailwind is found, or only a Sass file imports it, instead of falling back to the bundled grammar silently in `no-unknown-classes`. A Tailwind v3 project, which has no CSS entry, is not warned.

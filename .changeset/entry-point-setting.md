---
"@shadcn/lint": patch
---

Add `settings.shadcn.entryPoint`, the stylesheet that imports Tailwind, for projects without `components.json` or whose entry is not found. The warning about a missing Tailwind entry now points to it.

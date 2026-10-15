---
"@shadcn/lint": patch
---

Keep one cached read of each Angular component file, stylesheet and directory, replaced when it changes, so a long-lived ESLint server no longer holds another copy of a file each time it is saved.

---
"@shadcn/lint": patch
---

Read only the URL an `@use`, `@forward` or `@import` names in Angular styles: `@use "./vars" with ($font: "Roboto")` no longer imports `Roboto` and silences the component. `@import` reads each entry of its list, `url(x.css)` unquoted included, an import last in a block or the file without a closing `;` is read, and `//` or `/*` inside a string is no comment.

---
"@shadcn/lint": patch
---

Read the elements in an ICU's cases in Angular templates, `{count, plural, =0 {<span class="…">}}`, which the parser keeps only in the i18n message: those the i18n runtime creates, with the HTML tags and attributes its sanitizer knows, have their classes and `color` checked like any element's, and as plain elements, no `no-restyle` contract judges them. An `<svg>`, a custom element and what they hold, `style` and other attributes the runtime drops are not read, nor a table's part outside a `<table>`, `<td>` or `<tr>`, though what it holds is. A suggestion rewrites the class where it is written, not an interpolation beside it that spells the same word.

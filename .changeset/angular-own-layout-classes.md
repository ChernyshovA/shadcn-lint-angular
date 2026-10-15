---
"@shadcn/lint": patch
---

Judge a class of an Angular component's own styles in `no-restyle` by what the rules it is in set, as an `@utility` is by its body: `.orders-card { max-width: 40rem; }` on `<mat-card class="orders-card">` is layout, allowed where layout is. A rule that sets anything else, a custom property, `all`, `@include`, `@extend` or `@apply`, or a class the global styles declare too, still leaves the class to the grammar, which cannot tell what it changes.

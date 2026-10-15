---
"@shadcn/lint": patch
---

Read the variants of a `cva` in an Angular file when an axis, the `variants` object or the config is written with a type on it: `<Record<Variant, string>>{ … }`, `{ … } as …`, `{ … } satisfies …`, or in parentheses, so `no-restyle` names a directive's variants and sizes as it does for one without. React, Vue and Svelte files read as before.

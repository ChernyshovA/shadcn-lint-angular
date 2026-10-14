---
"@shadcn/lint": patch
---

Know the classes a component's styles select on its own element, `:host(.x)`, `:host.x` and `:host-context(…).x`, where another Angular template uses it: `no-unknown-classes` no longer reports `row-fill` on `<app-form-row class="row-fill">` when `FormRowComponent` styles `:host(.row-fill)`. The component is found by its selector among what the template's component can use. When its styles cannot be read, the classes on its element are skipped as its template's are, and the warning says so.

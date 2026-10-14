---
"@shadcn/lint": patch
---

Say once under Oxlint that Angular templates are not read, when a component file is linted: Oxlint parses neither `.html` files nor inline `template:` strings, so only a component's `host` bindings and class helpers are checked there.

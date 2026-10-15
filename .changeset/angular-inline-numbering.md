---
"@shadcn/lint": patch
---

Tell which component an inline template belongs to the way angular-eslint's processor numbers them: a quoted `"template"` key, a decorator given more than its options, and a template that is not written `template: …` are not handed over and not counted, and a component declared inside a function is.

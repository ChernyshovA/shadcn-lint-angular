---
"@shadcn/lint": patch
---

Resolve a package a stylesheet imports as Tailwind does: through the `style` and `default` conditions of its `exports`, in the order the package writes them, `exports` written as a string or as bare conditions included, and through its `style` field when it has no `exports`. A script is never read as CSS, and a package whose `exports` name no stylesheet falls back to its `index.css`, where Tailwind would fail. `@import "tailwindcss"` read Tailwind's JavaScript as CSS, so `no-unknown-classes` took words such as `value`, `map` and `length` for declared classes.

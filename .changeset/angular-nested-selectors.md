---
"@shadcn/lint": patch
---

Read nested selectors in Angular styles without multiplying them out: `.a, .b` nested in itself twenty times over took seconds per lint. `@at-root .x { }` declares `.x`. Rules whose selectors, nested, come to more than 1,000,000 characters in all, with those of what the stylesheet imports, as `&:not(&)` or `&-x, &-y` nested in itself do, or rules side by side under such a one, leave the component's styles unread, with a warning, instead of hanging the linter.

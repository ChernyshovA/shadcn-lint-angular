---
"@shadcn/lint": patch
---

Count an Angular directive's calls to `classes()` or a `mergeFunctions` helper as styling its element only in its class body: its constructor, field initializers and methods. A call among its decorator's arguments or at module level builds classes for something else, as spartan's `HlmTooltip` calls `hlm` in its `providers` for the tooltip it opens, so `<button hlmTooltip class="…">` is a plain button again.

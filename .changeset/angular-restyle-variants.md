---
"@shadcn/lint": patch
---

List the variants and sizes of the directive an Angular element's name stands for in `no-restyle` messages, found through the standalone `imports` of the template's component and the selector each `@Directive` or `@Component` declares, and through its `hostDirectives` one level down. On an element several directives' names match, a finding is named after one whose `cva` gives variants or sizes, else one that styles the element, so `hlmBtn` and not the `hlmDropdownMenuTrigger` beside it.

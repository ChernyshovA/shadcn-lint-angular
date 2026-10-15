---
"@shadcn/lint": patch
---

Read tsconfig `paths` from `tsconfig.base.json` when the project's root has no `tsconfig.json` or `jsconfig.json`, as in an Nx workspace (shadcn-ui/lint#111). An alias resolved only through them, such as `aliases.ui`, was reported as one that does not resolve, and the components imported through it were not recognized.

---
"@shadcn/lint": patch
---

Read each re-export, constant list, constant string and class an Angular template's scope is followed through once: `export *` that loop in a library's `.d.ts` or bundle, constants that hold each other in `imports`, `declarations` or `hostDirectives`, a selector built of constants that meet, host directives in a library's bundle that meet again, and classes that extend each other no longer hang the linter, and lists spread into each other no longer overflow its stack. A list that holds itself is read as one whose entries are not known.

---
"@shadcn/lint": minor
---

Check Angular template elements in `no-restyle` once a contract names them: a contract's `pattern` matches the element's tag or the name of one of its attributes, bindings or events, a pattern in slashes as a regex. `multipleContracts: "all"` makes an element several contracts match take only a class every one allows. The contracts of an element's names judge the classes it wears (`class`, `[class]`, `[ngClass]`, `routerLinkActive`); an input such as `styleClass` is judged by the contract of the directive that takes it.

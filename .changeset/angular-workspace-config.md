---
"@shadcn/lint": patch
---

Read an `angular.json` or Nx `project.json` that holds something Angular does not take, a project that is not an object, as Nx's own `angular.json` names one by its directory, a `root` that is not a string or `styles` that is not a list, without failing: what cannot be read is skipped and said once, and a config that cannot be parsed is no workspace.

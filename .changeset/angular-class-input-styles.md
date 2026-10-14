---
"@shadcn/lint": patch
---

Count an Angular directive with an input whose public name is `class` as one that styles its element in `no-restyle`, read from the project's source (`@Input("class")`, `input("", { alias: "class" })`, `inputs: ["x: class"]`, an input its `hostDirectives` expose under that name) or a library's `.d.ts`: Material's `MatMenu` takes the class into `panelClass`, so `<mat-menu class="…">` is judged again. A directive with an input whose name cannot be read may take it too.

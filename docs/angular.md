# Angular

`@shadcn/lint` reads Angular templates under ESLint with
`@angular-eslint/template-parser`: `.html` files, and inline `template:`
strings through angular-eslint's processor.

The examples enable the four rules a static class or style reaches.
Requires Node.js 20.19 or later.

## ESLint

Requires ESLint 9.30 or later.

```bash
npm install -D @shadcn/lint eslint angular-eslint typescript-eslint
```

Create `eslint.config.mjs`. If `ng add angular-eslint` already wrote one,
it has both blocks: add the plugin and rules to its `**/*.html` block.

```js
import { plugin as shadcn } from "@shadcn/lint"
import angular from "angular-eslint"
import { defineConfig } from "eslint/config"
import tseslint from "typescript-eslint"

export default defineConfig([
  {
    files: ["**/*.ts"],
    languageOptions: { parser: tseslint.parser },
    processor: angular.processInlineTemplates,
  },
  {
    files: ["**/*.html"],
    languageOptions: { parser: angular.templateParser },
    plugins: { shadcn },
    rules: {
      "shadcn/no-raw-colors": "error",
      "shadcn/no-arbitrary-values": "error",
      "shadcn/no-unknown-classes": "error",
      "shadcn/no-inline-styles": "error",
    },
  },
])
```

```bash
npx eslint .
```

### Inline templates

`processInlineTemplates` hands each inline `template:` to the
`**/*.html` block as a file of its own. Without it, only `.html` files
are read.

A finding in an inline template is reported at its place in the `.ts`,
but without a suggestion. The processor moves fixes back into the `.ts`
and leaves suggestions where they were, so an applied one would rewrite
the top of the file instead of the class.

## Oxlint

Oxlint does not parse Angular templates, so no plugin can see
`class="..."` in them. Run ESLint for `.html` files and for the inline
templates in `.ts` files.

## Example

```html
<a routerLink="/billing" routerLinkActive="text-blue-600">Billing</a>
<div class="card-header p-[13px]" style="color: red"></div>
```

```text
"text-blue-600" uses the raw Tailwind palette and no declared theme color
is close to it. Use one of: primary, or declare --color-<name> in
src/styles.css for a new color.

"p-[13px]" hardcodes an off-token value. Use "p-3.25" instead (same value,
on the scale).

Inline style sets color. Style through classes; use CSS custom properties
for dynamic values.
```

`card-header` is not reported when the component's own stylesheet
declares it. See [Component styles](#component-styles).

## What is read

| Template                                  | Read as                       |
| ----------------------------------------- | ----------------------------- |
| `class="p-4"`                             | a static class string         |
| `styleClass="p-4"`, `ngClass="p-4"`       | a static class string         |
| `routerLinkActive="font-semibold"`        | the classes the router adds   |
| `style="color: red"`                      | a style, property by property |
| `fill="#f00"`, `stop-color="#f00"` on SVG | a color attribute             |

An attribute whose name ends in `Class` or `Classes` is read the way JSX
reads `labelClassName`. Elements inside `@if`, `@for`, `@switch`,
`@defer`, `<ng-template>`, `<ng-container>`, `*ngIf` and `*ngFor` are
read like any other.

### Component styles

`no-unknown-classes` knows the classes the component's own styles
select, the way the theme's classes are known. The component is the one
whose `@Component` names the template: by `templateUrl`, from a `.ts`
file in the template's directory, or the `.ts` an inline template sits
in. Its styles are `styleUrl`, `styleUrls` and `styles`.

SCSS and Less nesting is resolved, `&-header` included, and `@import`,
`@use` and `meta.load-css` are followed: beside the file, then in the
include paths, then into the package a bare name such as
`"font-awesome"` names, through its `sass` or `style` entry. A selector built from an
interpolation, `.btn-#{$size}`, settles every class that starts with
`btn-`.

Styles that cannot be read settle every class in the template:
`styles: [shared]`, a stylesheet that does not exist, a spread in the
decorator, a selector that starts with an interpolation, or `&-x` inside
a `@mixin`. No finding is better than a false one there, but the rule
says so once per component, on stderr:

```text
[@shadcn/lint] The styles of ListComponent in src/app/list.component.ts
cannot be read: styles holds `shared`, not a string.
shadcn/no-unknown-classes is skipped in its template, since any class
there may be one they declare.
```

### Global styles

`no-unknown-classes` also knows the classes in the project's global
stylesheets: the `styles` of its targets in `angular.json`, or of the
targets an Angular builder runs in an Nx `project.json`, a path or
`{ "input": ... }` from the workspace root.
They are read the way component styles are, and Sass imports in both are
also looked for in `stylePreprocessorOptions.includePaths`. A stylesheet
from a package, such as `node_modules/primeicons/primeicons.css`, counts
the classes its selectors write out.

A file belongs to the project whose `root` holds it, the deepest one. A
library that names no styles of its own sees the styles of every project
in the workspace, since the applications that use it bring theirs.

Global styles that cannot be read, a stylesheet that does not exist or a
selector that starts with an interpolation, settle every class in the
project, and the rule says so once on stderr.

### Component names

A tag with a hyphen is a component, but its selector names it, and
selectors are not matched yet. `no-restyle` and `require-static-classes`
do not apply to `<app-card>` or `<p-button>`. The token rules check
their classes like any element's.

## What it cannot see

- **Bindings.** `[class]`, `[ngClass]`, `[class.active]`, `[style.color]`,
  `[ngStyle]`, `[routerLinkActive]`, and an interpolated
  `class="p-4 {{ tone }}"`, its static part included, are not read yet.
- **Host classes.** `host: { class: "..." }` and `@HostBinding`.
- **A template in another directory than its component.**
  `templateUrl: "../shared/card.html"` is not traced back, so that
  template's classes are checked without its component's styles.
- **Classes a mixin generates** through `@include`, and indented Sass
  and Stylus beyond their flat `.class` selectors.
- **Another component's styles.** With the default emulated
  encapsulation they do not reach this template, so a class only they
  declare is reported. Under `ViewEncapsulation.None` or `::ng-deep`
  they do reach it, and the finding is false. Allow such a class by name.
- **CSS a library ships inside its components.** Angular Material
  (`mat-*`, `mdc-*`) and PrimeNG (`p-button-text`, `p-datatable-sm`)
  styles are not in any stylesheet the project names. Allow them by
  prefix:

  ```js
  "shadcn/no-unknown-classes": ["error", { allow: ["mat-*", "mdc-*"] }]
  ```

- **A Tailwind entry written in Sass.** `@use "tailwindcss"` in a
  `.scss` file is not found as the theme, so the grammar bundled with
  `@shadcn/lint` answers instead of the project's Tailwind, and a
  plugin's classes are reported. The rule says so once per project, on
  stderr. Point `tailwind.css` in `components.json` at a CSS file that
  imports Tailwind and the same plugins.
- **Classes no stylesheet declares**, kept as hooks for tests or
  scripts: `class="global-menu"` for `querySelector("button.global-menu")`.
  They generate no CSS, so `no-unknown-classes` reports them, the way it
  does in a `.tsx` file. Allow them by name or prefix:

  ```js
  "shadcn/no-unknown-classes": ["error", { allow: ["global-menu", "js-*"] }]
  ```

- **Global styles a builder does not list**, such as a stylesheet an
  Analog or other Vite app imports from `main.ts`.
- **A lone `\r` line ending**, as classic Mac OS wrote them. The template
  parser does not count it as a line break and ESLint does, so the line
  and column a finding shows can be off. A suggestion still rewrites the
  right text.

Everything in [What it cannot see](./how-it-works.md#what-it-cannot-see)
applies too.

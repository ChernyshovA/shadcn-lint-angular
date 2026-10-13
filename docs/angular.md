# Angular

`@shadcn/lint` reads Angular templates under ESLint with
`@angular-eslint/template-parser`: `.html` files, and inline `template:`
strings through angular-eslint's processor. In component files it reads
the `host` bindings of `@Component` and `@Directive`, and class helpers
such as `cva`.

The examples enable the four rules a static class or style reaches.
Requires Node.js 20.19 or later.

## ESLint

Requires ESLint 9.30 or later.

```bash
npm install -D @shadcn/lint eslint angular-eslint typescript-eslint
```

Create `eslint.config.mjs`. If `ng add angular-eslint` already wrote one,
it has both blocks: add the plugin and rules to each.

```js
import { plugin as shadcn } from "@shadcn/lint"
import angular from "angular-eslint"
import { defineConfig } from "eslint/config"
import tseslint from "typescript-eslint"

const rules = {
  "shadcn/no-raw-colors": "error",
  "shadcn/no-arbitrary-values": "error",
  "shadcn/no-unknown-classes": "error",
  "shadcn/no-inline-styles": "error",
}

export default defineConfig([
  {
    files: ["**/*.ts"],
    languageOptions: { parser: tseslint.parser },
    processor: angular.processInlineTemplates,
    plugins: { shadcn },
    rules,
  },
  {
    files: ["**/*.html"],
    languageOptions: { parser: angular.templateParser },
    plugins: { shadcn },
    rules,
  },
])
```

The `**/*.html` block reads templates. The `**/*.ts` block reads host
bindings and class helpers in component files; without it, only
templates are read.

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

### Tailwind entry

`no-unknown-classes` asks the project's Tailwind which classes exist,
and `no-raw-colors` reads the theme's tokens, from the stylesheet that
imports Tailwind: a CSS file under the project, or the one
`tailwind.css` in `components.json` names.

An Angular app often imports Tailwind from `src/styles.scss` instead.
Tailwind v4 is not meant to be used with Sass
([Compatibility](https://tailwindcss.com/docs/compatibility)), and a
Sass file is not read as the entry. Write the entry as CSS, with the
theme and the same plugins, such as `src/tailwind.css`:

```css
@import "tailwindcss";
@import "./styles/theme.css";
@plugin "tailwindcss-primeui";
```

and name it in the settings, as a path from where ESLint runs. This works
without `components.json`:

```js
export default defineConfig([
  { settings: { shadcn: { entryPoint: "src/tailwind.css" } } },
  // the blocks above
])
```

The global `.scss` does not replace it: its classes are read as
[global styles](#global-styles), but it is not asked which Tailwind
classes exist. Without an entry, the rule says so once per workspace, on
stderr, and the grammar bundled with `@shadcn/lint` answers instead.

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

### Bindings

| Binding                                              | Read as                         |
| ---------------------------------------------------- | ------------------------------- |
| `[class]="on ? 'p-4' : 'p-2'"`, `[ngClass]="'p-4'"`  | the class strings it holds      |
| `[class]="{ 'p-4': on }"`, `[ngClass]="{ ... }"`     | the keys, as classes            |
| `[class.p-4]="on"`                                   | the class the key names         |
| `class="p-4 {{ tone }}"`                             | the text around the braces      |
| `[routerLinkActive]="..."`                           | the classes the router adds     |
| `[styleClass]="..."`, `[panelClass]="{ ... }"`       | like `[class]`                  |
| `[style]="'color: red'"`, `[ngStyle]="{ color: c }"` | a style, property by property   |
| `[style.color]="c"`, `[style.width.px]="w"`          | a style that sets that property |
| `[attr.fill]="'#f00'"`, `[attr.class]="..."`         | like the attribute it sets      |

An input whose name ends in `Class` or `Classes`, PrimeNG's
`[styleClass]` or Material's `[panelClass]`, is read like `[class]`, an
object's keys included: the component hands the value on to `[class]` or
`[ngClass]`.

A binding's expression is read the way JSX reads one: string literals,
both branches of `? :`, the right side of `&&`, both sides of `||` and
`??`, arrays and template literals. A class glued to an interpolation,
`btn-{{ size }}`, is not read, and neither is anything a field, a call,
a pipe or `+` computes: see [What it cannot see](#what-it-cannot-see).
`[style.color]` sets `color` whatever its value is, so it is reported
the way `style="color: ..."` is.

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

### Host bindings

| `host` in `@Component` or `@Directive` | Read as                             |
| -------------------------------------- | ----------------------------------- |
| `class: "p-4"`                         | a static class string               |
| `style: "color: red"`                  | a style, property by property       |
| `"[class]": "on ? 'p-4' : 'p-2'"`      | the class strings, as in a template |
| `"[class.p-4]": "on"`                  | the class the key names             |
| `"[style.color]": "c"`, `"[style]"`    | a style, as in a template           |

A finding is placed where the `.ts` spells the class, inside the string,
and its suggestion rewrites it there. `class: base` with
`const base = "p-4"` in the same file is followed, the way Angular's
compiler evaluates it. `no-unknown-classes` knows the classes the
component's own styles select, as in its template.

The expressions in the strings are parsed with
`@angular-eslint/bundled-angular-compiler`, which angular-eslint
installs. When it cannot be loaded, bindings are not read and the rule
says so once on stderr; static `class` and `style` are read either way.

### Class helpers

In a component file, classes in `cva(...)` and `cn(...)` are read the
way they are in a `.tsx` file. A helper with another name is added with
`mergeFunctions`, for example spartan's `hlm` and `classes`:

```js
export default defineConfig([
  { settings: { shadcn: { mergeFunctions: ["hlm", "classes"] } } },
  // ...
])
```

A helper listed there also reads what an arrow function passed to it
returns, as spartan's `classes(() => "p-4")` merges it, whether the
arrow returns an expression or has a block with `return`. A function
passed to anything else is not read: `computed(() => "p-4")` leaves
`"p-4"` unread. `scanAllStrings` on `no-raw-colors` and
`no-arbitrary-values` reads every string literal in the file instead,
classes or not.

### Component names

A tag with a hyphen is a component, but its selector names it, and
selectors are not matched yet. `no-restyle` and `require-static-classes`
do not apply to `<app-card>` or `<p-button>`, nor to a host element. The
token rules check their classes like any element's.

## What it cannot see

- **What a binding computes.** `[class]="classes()"`,
  `[ngClass]="state"`, `[class]="'p-' + size"` and `{{ x | tone }}`: a
  template reads the component's fields, and they are not followed into
  its `.ts`, so the classes they hold are not checked there. A style
  object computed that way, `[ngStyle]="styles"`, is reported as one that
  cannot be checked.
- **`@HostBinding`.** `@HostBinding("class.active")` and
  `@HostBinding("style.color")` on a field are not read; the `host`
  property of the decorator is. Color attributes in `host`, such as
  `"[attr.fill]"`, are not checked either: the host element has no tag
  to tell an SVG element from a component.
- **A template in another directory than its component.**
  `templateUrl: "../shared/card.html"` is not traced back, so that
  template's classes are checked without its component's styles.
- **Classes a mixin generates** through `@include`, and indented Sass
  and Stylus beyond their flat `.class` selectors.
- **Another component's styles.** With the default emulated
  encapsulation they do not reach this template, so a class only they
  declare is reported. Under `ViewEncapsulation.None` or `::ng-deep`
  they do reach it, and the finding is false. Allow such a class by name.
- **The styles of the components that use a host.** A host element sits
  in the template of the component that renders it, so that component's
  styles reach it: `host: { class: "connections" }` styled by
  `g.connections` in the parent's stylesheet. Which components render it
  is not known, so such a class is reported, and the message says to
  allow it by name, as in
  [External stylesheets](./rules/no-unknown-classes.md#external-stylesheets).
- **CSS a library ships inside its components.** Angular Material
  (`mat-*`, `mdc-*`), the CDK overlay (`cdk-overlay-transparent-backdrop`)
  and PrimeNG (`p-button-text`, `p-datatable-sm`) styles are not in any
  stylesheet the project names. Allow them by prefix:

  ```js
  "shadcn/no-unknown-classes": ["error", { allow: ["mat-*", "mdc-*", "cdk-*"] }]
  ```

- **A Tailwind entry written in Sass.** `@use "tailwindcss"` in a
  `.scss` file is not found as the theme, so the grammar bundled with
  `@shadcn/lint` answers instead of the project's Tailwind, and a
  plugin's classes are reported. Name a CSS entry in
  `settings.shadcn.entryPoint`, as in [Tailwind entry](#tailwind-entry).
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

# Angular

`shadcn-lint-angular` reads Angular templates under ESLint with
`@angular-eslint/template-parser`: `.html` files, and inline `template:`
strings through angular-eslint's processor. In component files it reads
the `host` of `@Component` and `@Directive`, and class helpers such as
`cva`.

The examples enable the four rules a static class or style reaches, and
`no-restyle` once a contract names the design system's components.
Requires Node.js 20.19 or later.

## ESLint

Requires ESLint 9.30 or later, ESLint 10 included.

```bash
ng add angular-eslint  # skip it if the project lints with ESLint already
npm install -D shadcn-lint-angular
```

`ng add angular-eslint` installs the latest angular-eslint, made for the
latest Angular; on an older one, name its major, `ng add angular-eslint@21`,
as `ng add` asks. It writes `eslint.config.js` in CommonJS, with a block
for `**/*.ts` and one for `**/*.html`. Add the plugin's blocks after them;
they take the parser and the processor from angular-eslint's:

```js
// eslint.config.js
const { plugin: shadcn } = require("shadcn-lint-angular")
// and the requires ng add wrote

/** @type {import("eslint").Linter.RulesRecord} */
const rules = {
  "shadcn/no-raw-colors": "error",
  "shadcn/no-arbitrary-values": "error",
  "shadcn/no-unknown-classes": "error",
  "shadcn/no-inline-styles": "error",
}

module.exports = defineConfig([
  // the blocks ng add angular-eslint wrote
  { files: ["**/*.ts"], plugins: { shadcn }, rules },
  { files: ["**/*.html"], plugins: { shadcn }, rules },
])
```

`require` loads `shadcn-lint-angular`, an ES module, on Node.js 20.19 and
later. ESLint reads `eslint.config.js` before `eslint.config.mjs`, so an
`eslint.config.mjs` written beside it is ignored. The type on `rules`
keeps the `// @ts-check` that `ng add` writes from reading `"error"` as
any string.

Without `ng add`, install angular-eslint of the project's Angular major
and create `eslint.config.mjs`:

```bash
npm install -D shadcn-lint-angular eslint typescript-eslint angular-eslint@22  # Angular 22
```

```js
import angular from "angular-eslint"
import { defineConfig } from "eslint/config"
import { plugin as shadcn } from "shadcn-lint-angular"
import tseslint from "typescript-eslint"

// `rules` as above

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

```bash
npx eslint .
```

The `**/*.html` block reads templates, and `processInlineTemplates` hands
it each inline `template:` as a file of its own. The `**/*.ts` block
reads host bindings and class helpers; without it, only templates are
read.

### What to lint

Tests, stories and the page that hosts the app hold markup that is not
the design system's: a test's fixture template, `display: none` on the
loading screen in `src/index.html`. Leave them out of the plugin's
blocks with `ignores`, as in [Nx](#nx); in angular-eslint's blocks, it
would leave them out of its rules too.

```js
// The /** forms are the inline templates the processor hands over as
// files inside them.
const ignores = [
  "**/*.spec.ts",
  "**/*.spec.ts/**",
  "**/*.stories.ts",
  "**/*.stories.ts/**",
  "**/index.html",
]
```

### Design-system components

`no-restyle` keeps a design-system component's look its own: a class
that recolors or reshapes it is reported, with the variants to use
instead, and layout around it is allowed. A template imports nothing a
tag could be resolved through, so the rule judges an element only once a
contract's `pattern` names it ([Component names](#component-names)):

```js
/** @type {import("eslint").Linter.RulesRecord} */
const restyle = {
  "shadcn/no-restyle": [
    "error",
    {
      allow: ["layout"],
      contracts: [
        // spartan
        { pattern: "/^hlm/" },
        { pattern: "hlmCardContent", allow: ["layout", "spacing"] },
        // Angular Material and PrimeNG, by exact names
        { pattern: "/^mat-(card|(flat-|raised-|stroked-)?button)$/" },
        { pattern: "pButton" },
        { pattern: "/^p-(button|card|tag)$/" },
      ],
    },
  ],
}
```

Add it to the `**/*.html` block, `rules: { ...rules, ...restyle }`, which
inline templates reach too. Name a compiled library's styled components
and directives exactly: with `/^p[A-Z]/`, every `pButton` and `pRipple`
makes its element a component whose every class is reported, and
`tooltipStyleClass` is judged on every `pTooltip`.

The components style their own internals, so turn the rule off in their
directory ([no-restyle](./rules/no-restyle.md#setup)), with
`no-arbitrary-values` for structural values such as `ring-[3px]`
([Adoption](./adoption.md#add-more-rules)). The pattern takes in the
inline templates and `host` of the files there:

```js
{
  files: ["libs/ui/**"],
  rules: { "shadcn/no-restyle": "off", "shadcn/no-arbitrary-values": "off" },
}
```

## Nx

An Nx workspace has a root `eslint.config.mjs` that each project's
config imports, and the Angular blocks, with the template parser and the
processor, are in the project's (`nx.configs["flat/angular"]`,
`nx.configs["flat/angular-template"]`). Add the plugin's blocks, those
without a parser, to the root config:

```js
// eslint.config.mjs at the workspace root
import { plugin as shadcn } from "shadcn-lint-angular"

// and the imports Nx wrote; `rules` and `ignores` as above

export default [
  // the blocks Nx wrote
  { files: ["**/*.ts"], ignores, plugins: { shadcn }, rules },
  { files: ["**/*.html"], ignores, plugins: { shadcn }, rules },
]
```

Run ESLint the way Nx does, in each project:

```bash
npx nx run-many -t lint
```

`npx eslint .` at the root reads the root config alone, which parses no
template: each `.html` file is a parsing error, `Unexpected token <`.

A project is Angular's when a target of its `project.json` runs a
builder or executor whose name has `angular` in it
(`@nx/angular:package`, `@analogjs/vitest-angular:test`) or
`ngx-build-plus`, or when it has a `prefix`, which Nx's Angular
generators write: a library that is not buildable has no such target. A
message that names another project's file shows it from the workspace's
root.

## Oxlint

Oxlint does not parse Angular templates, so no plugin can see
`class="..."` in them. Run ESLint for `.html` files and for the inline
templates in `.ts` files. Under Oxlint 1.80 or later, component files are
still linted for their `host` and class helpers:

```bash
npm install -D shadcn-lint-angular oxlint
```

```json
{
  "jsPlugins": ["shadcn-lint-angular"],
  "rules": {
    "shadcn/no-raw-colors": "error",
    "shadcn/no-arbitrary-values": "error",
    "shadcn/no-unknown-classes": "error",
    "shadcn/no-inline-styles": "error"
  }
}
```

Save it as `.oxlintrc.json` and run `npx oxlint`. When a component file
is linted, the run says once that its templates are not
([Warnings](#warnings)).

## Tailwind entry

`no-unknown-classes` asks the project's Tailwind which classes exist,
and `no-raw-colors` reads the theme's tokens, from the stylesheet that
imports Tailwind. It is the first of:

1. the one `settings.shadcn.entryPoint` names, as a path from where
   ESLint runs, else the one `tailwind.css` in `components.json` names;
2. among the [global styles](./angular-how-it-works.md#global-styles), the one that imports
   Tailwind together with a theme, `@theme`, `@plugin`, `@utility`,
   `@custom-variant` or `@config`, in it or in what it imports; of
   several, the one that declares the most tokens;
3. a CSS file under the project that imports Tailwind, the one that
   declares the most color tokens.

Angular's build hands each global stylesheet to Tailwind on its own, so
the app's classes are those of the one with the theme. `ng add
tailwindcss` writes `src/tailwind.css` with Tailwind alone, and spartan's
CLI then writes Tailwind, its preset and the theme into
`src/styles.scss`: the entry is `src/styles.scss`.

A project that names no global styles, a library, or an app whose
builder lists none such as Analog's, takes those of every project in the
workspace, and their entry only when the CSS file found under it holds
no theme. The entry is chosen so for [Angular code](./angular-how-it-works.md#angular-code); any
other file finds its own as `@shadcn/lint` does, by 1 and 3.

A Sass entry is read the way Tailwind's compiler reads it, as CSS:
Angular compiles the Sass first, and the linter does not. Tailwind v4 is
not meant to be used with Sass
([Compatibility](https://tailwindcss.com/docs/compatibility)), and some
Sass reads otherwise as CSS: a `//` comment swallows what follows it,
`.gap-#{$size}` breaks its rule, `@use`, `@forward` and `meta.load-css`
load nothing (a built-in module such as `sass:math` aside), and a
partial, `@import "variables"`, cannot be loaded. A global stylesheet
with any of those, or one Tailwind's compiler stops at, is not taken,
and the rule says which line once. Write the entry as CSS, with the
theme and the same plugins:

```css
/* src/tailwind.css */
@import "tailwindcss";
@import "./styles/theme.css";
@plugin "tailwindcss-primeui";
```

and list it among the `styles` of `angular.json`, or name it. The
setting works without `components.json` and outside a workspace:

```js
export default defineConfig([
  { settings: { shadcn: { entryPoint: "src/tailwind.css" } } },
  // the blocks above
])
```

Every global stylesheet's own classes are known whichever is the entry
([Global styles](./angular-how-it-works.md#global-styles)). Without an entry, the grammar bundled
with `shadcn-lint-angular` answers, and on Tailwind v4 the rule says so once per
workspace. The other choices it says once are in [Warnings](#warnings).

## spartan

```js
export default defineConfig([
  {
    settings: {
      shadcn: {
        mergeFunctions: ["hlm", "classes"],
        themeImports: ["^@spartan-ng/brain/"],
      },
    },
  },
  // the blocks above, with the spartan contracts of no-restyle
])
```

- **Class helpers.** `mergeFunctions` reads the classes spartan's
  directives pass to `hlm` and `classes`
  ([Class helpers](./angular-how-it-works.md#class-helpers)).
- **Theme.** spartan's theme imports its tokens from
  `@spartan-ng/brain/hlm-tailwind-preset.css`. Installed from npm, that
  stylesheet is in `node_modules`, and its tokens are not the project's
  until `themeImports` names the package
  ([Theme tokens](./how-it-works.md#theme-tokens)). Without it,
  `no-raw-colors` knows no `primary`: `bg-primaryy` is reported by no
  rule, and a raw color gets no nearest token. A preset imported from
  outside `node_modules` counts without the setting.
- **`components.json`.** spartan's CLI writes one without `aliases`. A
  file without them that has a field of spartan's schema
  (`componentsPath`, `importAlias`, `buildable`, `generateAs`) is read as
  spartan's, for Angular code: `componentsPath`, `libs/ui` by default,
  is the components' directory. The CLI writes no `tailwind.css` there,
  so the entry is found among the global styles. A file with `aliases` is
  read as shadcn's.
- **Its directory.** Turn `no-restyle` off in `componentsPath`, as in
  [Design-system components](#design-system-components).

## Angular Material and PrimeNG

Their components and directives are read from the `.d.ts` and published
JavaScript in `node_modules`
([Libraries and NgModules](./angular-how-it-works.md#libraries-and-ngmodules)); name them exactly
in contracts ([Design-system components](#design-system-components)).
The CSS they ship inside their components is in no stylesheet the
project names, so `no-unknown-classes` reports its classes: Material's
`mat-*` and `mdc-*`, the CDK's `cdk-overlay-*`, PrimeNG's
`p-button-text`. Allow them by prefix:

```js
"shadcn/no-unknown-classes": ["error", { allow: ["mat-*", "mdc-*", "cdk-*"] }]
```

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
declares it ([Component styles](./angular-how-it-works.md#component-styles)).

## What is read

| Template                                             | Read as                         |
| ---------------------------------------------------- | ------------------------------- |
| `class="p-4"`, `styleClass="p-4"`, `ngClass="p-4"`   | a static class string           |
| `routerLinkActive="x"`, `[routerLinkActive]="..."`   | the classes the router adds     |
| `style="color: red"`                                 | a style, property by property   |
| `fill="#f00"`, `stop-color="#f00"` on SVG            | a color attribute               |
| `[class]="on ? 'p-4' : 'p-2'"`, `[ngClass]="'p-4'"`  | the class strings it holds      |
| `[class]="{ 'p-4': on }"`, `[ngClass]="{ ... }"`     | the keys, as classes            |
| `[class.p-4]="on"`                                   | the class the key names         |
| `class="p-4 {{ tone }}"`                             | the text around the braces      |
| `[styleClass]`, `[panelClass]`, `[className]`        | like `[class]`                  |
| `[style]="'color: red'"`, `[ngStyle]="{ color: c }"` | a style, property by property   |
| `[style.color]="c"`, `[style.width.px]="w"`          | a style that sets that property |
| `[attr.fill]="'#f00'"`, `[attr.class]="..."`         | like the attribute it sets      |

An attribute or input whose name ends in `Class` or `Classes`, PrimeNG's
`styleClass` or Material's `panelClass`, is read like `class`: the
component hands it on to `[class]` or `[ngClass]`. Elements inside
`@if`, `@for`, `@switch`, `@defer`, `<ng-template>`, `<ng-container>`,
`*ngIf` and `*ngFor` are read like any other.

An expression is read the way JSX reads one: string literals, both
branches of `? :`, the right side of `&&`, both sides of `||` and `??`,
arrays and template literals. `[style.color]` sets `color` whatever its
value is, so it is reported as `style="color: ..."` is. A finding on an
object's key, `[class]="{ 'p-[13px]': on }"`, is placed on the key, with
a suggestion.

**ICU messages.** In a case, `{n, plural, =0 {<span class="…">}}`, nested
ones included, only what Angular's i18n runtime creates is read: plain
elements and attributes its sanitizer knows, and of those `class` and
`color`, the text around `{{ }}` as in `class="p-4 {{ tone }}"`.
An `<svg>`, a custom element or an `<ng-container>` is dropped with all
it holds, and so are `style`, `fill`, `ngClass` and `routerLinkActive`.
The runtime parses a case as a page's body, so `<td>`, `<tr>`, `<tbody>`,
`<caption>` or `<col>` outside a `<table>` is not created either, though
what it holds is. No `no-restyle` contract judges an element in a case.

In component files, the `host` of `@Component` and `@Directive` and class
helpers such as `cva` are read too, and `no-unknown-classes` knows the
classes the component's own styles and the project's global styles
declare. [How it reads](./angular-how-it-works.md) has the details: which
files count as Angular code, what is followed into a stylesheet, and when
styles cannot be read.

## Component names

No element is a design-system component until a `no-restyle` contract
names it. A `pattern` matches the element's tag or the name of one of its
attributes, bindings or events, as the template writes it: `hlmBtn`,
`p-button`. A pattern in slashes is a regex, `/^hlm/` or `/^p-/i`, as in
angular-eslint's options; any other is the whole name, so `hlmBtn` does
not match `hlmBtnGroup`. `class`, `style`, `[class.x]`, `[style.x]`,
`[attr.x]`, animation bindings and events, a reference (`#ref`), a
structural directive (`*hlmIf`) and events on `window`, `document` or
`body` are not names.

```html
<!-- Allowed with the spartan contracts above. -->
<button hlmBtn class="mt-4 w-full">Save</button>
<div hlmCardContent class="p-4">...</div>

<!-- Reported. -->
<button hlmBtn class="bg-pink-500">Save</button>
```

```text
"bg-pink-500" is not allowed on <button hlmBtn>: <button hlmBtn> owns
its color. Use a variant: default, outline, secondary, ghost,
destructive, link. Add a new variant in
libs/ui/button/src/lib/hlm-button.ts only if the design explicitly
calls for a treatment none of these provides.
```

A name takes the last contract that matches it. An element with several
matched names, `<button hlmBtn hlmTooltipTrigger>`, takes a class any of
their contracts allows; with `multipleContracts: "all"`, only one every
contract allows.

The classes the element wears, `class`, `[class]`, `[class.x]`,
`[ngClass]`, `[attr.class]`, `[className]` and those `ngClass` and
`routerLinkActive` add, are judged by the contracts of all its names. An
input such as `styleClass` or `panelClass` hands its classes to the
directive that takes it, so that directive's contract judges them:

```html
<!-- Reported on <p-dialog>: Dialog takes styleClass. -->
<p-dialog styleClass="bg-pink-500"></p-dialog>

<!-- matTooltipClass is MatTooltip's: a contract on mat-icon leaves it
     alone, one on matTooltip judges it. -->
<mat-icon matTooltip="Delete" matTooltipClass="bg-pink-500">delete</mat-icon>
```

A contract written for React, `^Button$`, names no element in a template.
`require-static-classes` and the contracts of the other rules do not
apply to template elements, nor `no-restyle` to a host element; the token
rules check their classes like any element's.

Which directive a name stands for, where the variants in a message come
from, which directive takes an input such as `styleClass`, and how a
library's `.d.ts` and published JavaScript are read: see
[How it reads](./angular-how-it-works.md#variants-in-messages).

## Warnings

What cannot be read is skipped rather than guessed, and the rule says so
once on stderr, prefixed `[shadcn-lint-angular]`:

- **The styles of _Component_ … cannot be read**, **The global styles
  _file_ names cannot be read**: see [Component styles](./angular-how-it-works.md#component-styles);
  `no-unknown-classes` is skipped in the template and on the component's
  element, or in the whole project.
- **The host of _Directive_ … cannot be read**: `host: HOST`, a spread, a
  computed key, a value that is no string,
  `` `on ? ${A} : 'p-2'` ``; its classes and styles are not checked.
- **Host binding values … could not be loaded**: install angular-eslint.
- **Angular templates … are read under ESLint**: under Oxlint, only host
  bindings and class helpers are linted.
- **The Angular declarations in _package_ cannot be read**: its `.d.ts`
  or published JavaScript is in a form a later Angular may write; inputs
  are judged by the tag's contract, and its directives may style.
- **Tailwind entry**: a Sass global stylesheet Tailwind's compiler
  cannot read as written, or such an entry the settings or
  `components.json` name; a theme read from a stylesheet without one
  while another global stylesheet has it; several global stylesheets, or
  for a library several apps', each with a theme; no stylesheet importing
  Tailwind; an `entryPoint` that is not a string, empty, missing, a
  directory, or does not import Tailwind. Each says what is read instead.
  Set `entryPoint` to a CSS entry with the theme.
- **_angular.json_ cannot be read**, or **has fields that are not read**,
  such as a project that is not an object, as Nx's own `angular.json`
  names one by its directory.
- **… an Nx workspace with more than 500 project.json files**, **… more
  than 5 directories below …**: those projects' global styles are not
  read.
- **_field_ in components.json must be a non-empty string**, **The
  componentsPath … is not a directory**: spartan's schema.

## What it cannot see

- **What a binding computes.** `[class]="classes()"`, `[ngClass]="state"`,
  `[class]="'p-' + size"`, `btn-{{ size }}` and `{{ x | tone }}`: fields
  are not followed into the `.ts`. A style object computed so,
  `[ngStyle]="styles"`, is reported as one that cannot be checked.
- **`@HostBinding` values.** `@HostBinding("class.active")` and
  `@HostBinding("style.color")` are not linted; `host` is. Color
  attributes in `host`, `"[attr.fill]"`, are not checked: a host element
  has no tag to tell an SVG element from a component.
- **Suggestions in inline templates.** A finding there is reported at
  its place in the `.ts`, without a suggestion: the processor moves fixes
  back into the `.ts` but not suggestions, so an applied one would
  rewrite the top of the file. On a line with escapes before the class,
  `\'` or `\n`, the column is off by them.
- **Keys with angular-eslint 19 and 20.** Their compiler does not say
  where an object's key starts, so a finding there covers the whole
  object, without a suggestion.
- **A template in another directory than its component.**
  `templateUrl: "../shared/card.html"` is not traced back, so that
  template is checked without its component's styles.
- **A stylesheet a template links.** Angular's compiler adds
  `<link rel="stylesheet" href="./card.css">` in a template to the
  component's styles; it is not read, so a class only it declares is
  reported. Name the stylesheet in `styleUrl` instead.
- **Classes a mixin generates** through `@include`, and indented Sass
  and Stylus beyond their flat `.class` selectors.
- **Another component's styles.** With emulated encapsulation they do
  not reach this template, so a class only they declare is reported.
  Under `ViewEncapsulation.None` or `::ng-deep` they do, and the finding
  is false: allow such a class by name. A component's `:host(.x)` on its
  own element is read ([Component styles](./angular-how-it-works.md#component-styles)).
- **The styles of the components that render a host.** A host element
  sits in its parent's template, so the parent's styles reach it:
  `host: { class: "connections" }` styled by `g.connections` there. The
  message says to allow such a class, as in
  [External stylesheets](./rules/no-unknown-classes.md#external-stylesheets).
- **What Sass makes of a Tailwind entry.** A theme a mixin writes out, or
  `--color-brand: $brand`, is not what the build makes of it.
- **Classes no stylesheet declares**, kept as hooks for tests or
  scripts: `class="global-menu"` for `querySelector("button.global-menu")`.
  They generate no CSS, so they are reported, as in a `.tsx` file:

  ```js
  "shadcn/no-unknown-classes": ["error", { allow: ["global-menu", "js-*"] }]
  ```

- **Global styles a builder does not list**, such as a stylesheet an
  Analog or other Vite app imports from `main.ts`.
- **A lone `\r` line ending.** The template parser does not count it as a
  line break and ESLint does, so the line and column shown can be off. A
  suggestion still rewrites the right text.

Everything in [What it cannot see](./how-it-works.md#what-it-cannot-see)
applies too.

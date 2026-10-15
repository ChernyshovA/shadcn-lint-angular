# Angular

`@shadcn/lint` reads Angular templates under ESLint with
`@angular-eslint/template-parser`: `.html` files, and inline `template:`
strings through angular-eslint's processor. In component files it reads
the `host` bindings of `@Component` and `@Directive`, and class helpers
such as `cva`.

The examples enable the four rules a static class or style reaches, and
`no-restyle` once a contract names the design system's components
([Design-system components](#design-system-components)). Requires
Node.js 20.19 or later.

## ESLint

Requires ESLint 9.30 or later.

```bash
npm install -D @shadcn/lint eslint angular-eslint typescript-eslint
```

`ng add angular-eslint` writes `eslint.config.js` in CommonJS, with a
block for `**/*.ts` and one for `**/*.html`. Add the plugin's blocks
after them; they take the parser and the processor from angular-eslint's:

```js
// eslint.config.js
const { plugin: shadcn } = require("@shadcn/lint")
// and the requires ng add wrote

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

`require` loads `@shadcn/lint`, an ES module, on Node.js 20.19 and later.
ESLint reads `eslint.config.js` before `eslint.config.mjs`, so an
`eslint.config.mjs` written beside it is ignored: add to the file that is
there.

Without angular-eslint's config, create `eslint.config.mjs`:

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

In an Nx workspace, see [Nx](#nx).

### Inline templates

`processInlineTemplates` hands each inline `template:` to the
`**/*.html` block as a file of its own. Without it, only `.html` files
are read.

A finding in an inline template is reported at its place in the `.ts`,
but without a suggestion. The processor moves fixes back into the `.ts`
and leaves suggestions where they were, so an applied one would rewrite
the top of the file instead of the class. The processor places a
template as the string spells it, so on a line with escapes before the
class, `\'` or `\n`, the column it reports is off by them.

### Design-system components

`no-restyle` keeps a design-system component's look its own: a class
that recolors or reshapes it is reported, with the variants to use
instead, and layout around it is allowed. A template imports nothing a
tag could be resolved through, so it judges an element only once a
contract's `pattern` names it ([Component names](#component-names)).
Add it to the `**/*.html` block, with spartan's directives or Angular
Material's components:

```js
const restyle = {
  "shadcn/no-restyle": [
    "error",
    {
      allow: ["layout"],
      contracts: [
        // spartan
        { pattern: "/^hlm/" },
        { pattern: "hlmCardContent", allow: ["layout", "spacing"] },
        // Angular Material
        { pattern: "/^mat-(card|(flat-|raised-|stroked-)?button)$/" },
      ],
    },
  ],
}

export default defineConfig([
  // the **/*.ts block
  {
    files: ["**/*.html"],
    plugins: { shadcn },
    rules: { ...rules, ...restyle },
  },
])
```

The inline templates of `.ts` files reach that block through the
processor. The components' own files style their internals, so the rule
is turned off in their directory, as in
[The design system's own directory](#the-design-systems-own-directory).

### Tailwind entry

`no-unknown-classes` asks the project's Tailwind which classes exist,
and `no-raw-colors` reads the theme's tokens, from the stylesheet that
imports Tailwind. It is the first of:

1. the one `settings.shadcn.entryPoint` names, as a path from where
   ESLint runs, else the one `tailwind.css` in `components.json` names;
2. among the [global styles](#global-styles) of `angular.json` or an Nx
   `project.json`, the one that imports Tailwind together with a theme:
   `@theme`, `@plugin`, `@utility`, `@custom-variant` or `@config`, in it
   or in what it imports;
3. a CSS file under the project that imports Tailwind, the one that
   declares the most color tokens.

A file of a project that names no styles of its own, a library or an
app whose builder lists none, such as Analog's, which imports its own
stylesheet, takes the global styles of every project in the workspace,
as [Global styles](#global-styles) reads them, and their entry only
when the CSS file found under it holds no theme.

The entry is chosen so for [Angular code](#angular-code), a project's
plain `.ts` files included. A React, Vue or Svelte file, and a file
outside the Angular projects, finds its own as upstream does, from 1
and 3.

Angular's build hands each global stylesheet to Tailwind on its own, so
the app's classes are those of the one that imports Tailwind with the
theme. `ng add tailwindcss` writes `src/tailwind.css` with Tailwind
alone, and spartan's CLI then writes the Tailwind imports, its preset
and the theme into `src/styles.scss`: the entry is `src/styles.scss`.

A Sass stylesheet is read the way Tailwind's compiler reads it, as CSS:
Angular compiles the Sass first, and the linter does not. Tailwind v4 is
not meant to be used with Sass
([Compatibility](https://tailwindcss.com/docs/compatibility)), and as
CSS some Sass reads otherwise: a `//` comment swallows what follows it,
an interpolation such as `.gap-#{$size}` breaks its rule, `@use`,
`@forward` and `meta.load-css` load nothing, `@use "tailwindcss"` or
`@use "./tokens"` alike (a built-in module such as `sass:math` aside),
and a partial, `@import "variables"`, cannot be loaded. A global
stylesheet with any of those is not taken, nor one Tailwind's compiler
stops at, as at a rule left open.
The entry is then found as for any project, and the rule says so once,
on stderr:

```text
[@shadcn/lint] src/styles.scss imports Tailwind and holds the theme, but
Tailwind's compiler cannot read it as written: line 7 has a // comment,
which only Sass skips. The theme is read from src/tailwind.css instead.
Import Tailwind and the theme from a CSS file among the styles of
angular.json, or set settings.shadcn.entryPoint to one.
```

Write that entry as CSS, with the theme and the same plugins, such as
`src/tailwind.css`:

```css
@import "tailwindcss";
@import "./styles/theme.css";
@plugin "tailwindcss-primeui";
```

and list it among the `styles` of `angular.json`, or name it in the
settings. The setting works without `components.json` and outside a
workspace:

```js
export default defineConfig([
  { settings: { shadcn: { entryPoint: "src/tailwind.css" } } },
  // the blocks above
])
```

The rule also says, once, when the theme is read from a stylesheet that
holds none while another global stylesheet holds one, as when
`entryPoint` names the `src/tailwind.css` of `ng add tailwindcss` beside
spartan's `src/styles.scss`, when a Sass entry the setting or
`components.json` names cannot be read as written, and when several
global stylesheets import Tailwind with a theme: Tailwind builds each
on its own, and the one that declares the most tokens is taken. A
library that names no global styles takes those of every app in the
workspace; when several of them hold a theme, set `entryPoint` to the
entry of the app it is built for. Every global
stylesheet's own classes are known either way, as
[global styles](#global-styles). Without an entry, the rule says so once
per workspace, on stderr, and the grammar bundled with `@shadcn/lint`
answers instead.

### spartan's components.json

The `components.json` spartan's CLI writes has no `aliases`. A file
without them that has a field of spartan's schema (`componentsPath`,
`importAlias`, `buildable`, `generateAs`) is read as spartan's:
`componentsPath` is the directory of the design-system components,
`libs/ui` when left out. Its CLI writes no `tailwind.css` there, so the
entry is found among the global styles, as above. A file with `aliases`
is read as shadcn's. spartan's schema is read for
[Angular code](#angular-code), a barrel or a helper of an Angular
project included. A React, Vue or Svelte file, and a file outside the
Angular projects, reads a `components.json` without `aliases` as
upstream does, at the default alias.

### spartan's theme

The theme spartan's CLI writes imports its tokens from
`@spartan-ng/brain/hlm-tailwind-preset.css`. Installed from npm, that
stylesheet sits in `node_modules`, and its tokens are not the
project's until `themeImports` names the package
([Theme tokens](./how-it-works.md#theme-tokens)). Without it,
`no-raw-colors` knows no `primary`: `bg-primaryy` is reported by no
rule, and a raw color gets no nearest token. Name it:

```js
export default defineConfig([
  { settings: { shadcn: { themeImports: ["^@spartan-ng/brain/"] } } },
  // the blocks above
])
```

```text
"bg-primaryy" is not a declared theme color. Did you mean "bg-primary"?
Declared colors: accent, background, border, card, ...
```

A preset imported from outside `node_modules`, as spartan's own
repository imports it from `libs/brain`, counts without the setting.

### What to lint

`npx eslint .` also lints tests, stories and the page that hosts the
app. Their classes are not the design system's: a test's fixture
template, a story's markup, `display: none` on the loading screen in
`src/index.html`. Leave them out of the plugin's blocks with `ignores`:

```js
// The /** forms are the inline templates of those files, which
// angular-eslint's processor hands over as files inside them.
const ignores = [
  "**/*.spec.ts",
  "**/*.spec.ts/**",
  "**/*.stories.ts",
  "**/*.stories.ts/**",
  "**/index.html",
]

export default defineConfig([
  {
    files: ["**/*.ts"],
    ignores,
    languageOptions: { parser: tseslint.parser },
    processor: angular.processInlineTemplates,
    plugins: { shadcn },
    rules,
  },
  {
    files: ["**/*.html"],
    ignores,
    languageOptions: { parser: angular.templateParser },
    plugins: { shadcn },
    rules,
  },
])
```

In blocks `ng add angular-eslint` wrote, `ignores` would leave these
files out of angular-eslint's rules too. Give the plugin blocks of its
own after them instead; they take the parser and the processor from
angular-eslint's:

```js
export default defineConfig([
  // the blocks ng add angular-eslint wrote
  { files: ["**/*.ts"], ignores, plugins: { shadcn }, rules },
  { files: ["**/*.html"], ignores, plugins: { shadcn }, rules },
])
```

### The design system's own directory

The components of the design system style their own internals, so
`no-restyle` is turned off in their directory
([no-restyle](./rules/no-restyle.md#setup)), and `no-arbitrary-values`
with it, for structural values such as `ring-[3px]`
([Adoption](./adoption.md#add-more-rules)). For spartan, that is the
directory its CLI generates helm into, `componentsPath` in its
`components.json`, `libs/ui` by default:

```js
export default defineConfig([
  // the blocks above
  {
    files: ["libs/ui/**"],
    rules: {
      "shadcn/no-restyle": "off",
      "shadcn/no-arbitrary-values": "off",
    },
  },
])
```

The pattern takes in the inline templates of the files there, and their
`host`. `no-raw-colors` and `no-inline-styles` stay on inside it.

## Nx

An Nx workspace has a root `eslint.config.mjs` that each project's
config imports, and the Angular blocks, with the template parser and
the processor, are in the project's: `nx.configs["flat/angular"]` and
`nx.configs["flat/angular-template"]`. Add the plugin's blocks, those
without a parser, to the root config, where every project's config takes
them in:

```js
// eslint.config.mjs at the workspace root
import { plugin as shadcn } from "@shadcn/lint"

// and the imports Nx wrote

// `rules` and `ignores` as above, in What to lint.

export default [
  // the blocks Nx wrote
  { files: ["**/*.ts"], ignores, plugins: { shadcn }, rules },
  { files: ["**/*.html"], ignores, plugins: { shadcn }, rules },
]
```

and run ESLint the way Nx does, in each project:

```bash
npx nx run-many -t lint
```

`npx eslint .` at the root reads the root config alone, which parses no
template: each `.html` file is a parsing error, `Unexpected token <`,
and no rule runs in it.

A project is Angular's when a target of its `project.json` runs
Angular's builder or executor, or when it has a `prefix`, which Nx's
Angular generators write: a library that is not buildable has no target
of Angular's ([Angular code](#angular-code)). A project's global styles
are its `project.json` targets' `styles`
([Global styles](#global-styles)). A message that names another
project's file, such as a directive in `libs/ui` from `apps/shop`,
shows it from the workspace's root.

## Oxlint

Oxlint does not parse Angular templates, so no plugin can see
`class="..."` in them. Run ESLint for `.html` files and for the inline
templates in `.ts` files.

Under Oxlint, component files are still linted for their `host` bindings
and class helpers. Requires Oxlint 1.80 or later:

```bash
npm install -D @shadcn/lint oxlint
```

Create `.oxlintrc.json`:

```json
{
  "jsPlugins": ["@shadcn/lint"],
  "rules": {
    "shadcn/no-raw-colors": "error",
    "shadcn/no-arbitrary-values": "error",
    "shadcn/no-unknown-classes": "error",
    "shadcn/no-inline-styles": "error"
  }
}
```

```bash
npx oxlint
```

When a component file is linted, the rule says once, on stderr, that
its templates are not:

```text
[@shadcn/lint] Angular templates, .html files and inline template
strings, are read under ESLint with @angular-eslint/template-parser.
Oxlint does not parse them, so in component files only host bindings and
class helpers are linted.
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
read like any other, and so are those in an ICU's cases,
`{count, plural, =0 {<span class="…">none</span>}}`, nested ICUs
included, as far as Angular's i18n runtime creates them: as plain
elements with static attributes, and only for the HTML tags and
attributes its sanitizer knows. An `<svg>`, a custom element or an
`<ng-container>` in a case is dropped with all it holds, and so are
`style`, `fill`, `ngClass`, `routerLinkActive` and the other attributes
it does not know; of those it keeps, `class` and `color` are read. The
runtime parses a case as a browser parses a page's body, so a table's
part outside a `<table>`, `<td>`, `<tr>`, `<tbody>`, `<caption>` or
`<col>`, is not created either, though what it holds is. No
directive matches such an element, so no `no-restyle` contract judges
it, and the text around `{{ }}` in an attribute is read as in
`class="p-4 {{ tone }}"`.

### Angular code

What this plugin reads the Angular way, the global styles and the
Tailwind entry among them, spartan's `components.json`, `classes` and
the functions passed to helpers, the `host` of a decorator, it reads in
Angular code:

- templates, `.html` files and inline ones;
- scripts that import from `@angular/`;
- the other scripts of an Angular project, such as a barrel or a helper
  of its components: a file under the `root` of a project in
  `angular.json`, or under the nearest Nx `project.json` when that one
  is an Angular project's. A project whose root is the workspace's,
  `"root": ""` as `ng new` writes it, holds every file there, a script
  at the workspace's root too, short of a directory below it with a
  `package.json` of its own. One is when a target runs a builder or
  executor of Angular's, one whose name has `angular` in it
  (`@angular/build:application`, `@nx/angular:package`,
  `@analogjs/vitest-angular:test`) or `ngx-build-plus`, or when it has
  a `prefix`, the one Nx's Angular generators write for the selectors
  of its components; a library that is not buildable has no target of
  Angular's. A project of `angular.json` that is not an object, as Nx's
  own `angular.json` names one by its directory, is not read, and that
  is said once on stderr.

A `.tsx`, `.jsx`, `.vue`, `.svelte`, `.astro` or `.mdx` file is its
framework's, inside an Angular project too, and any file outside the
Angular projects, a React app's in the same Nx workspace or one with a
`package.json` of its own beside a project rooted at the workspace,
lints as upstream lints it. A dependency on
`@angular/core` in `package.json` makes no file Angular's: an Nx
workspace has one `package.json` for all its projects.

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
| `[className]="..."`                                  | like `[class]`                  |

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

A finding on an object's key, `[class]="{ 'p-[13px]': on }"`, is placed
on the key and suggests a fix there. The compiler of angular-eslint 19
and 20 does not say where a key starts, so with those versions the
finding covers the whole object, without a suggestion.

### Component styles

`no-unknown-classes` knows the classes the component's own styles
select, the way the theme's classes are known. The component is the one
whose `@Component` names the template: by `templateUrl`, from a `.ts`
file in the template's directory, or the `.ts` an inline template sits
in. Its styles are `styleUrl`, `styleUrls` and `styles`.

A class one slip from one they or the
[global styles](#global-styles) write in the project's own stylesheets,
`card-footr` where the styles nest `&-footer` in `.card`, is reported
as that one misspelled, with a suggestion, when Tailwind knows no class
it is one slip from. A package's stylesheet, such as an icon font's, is
not looked in: its hundreds of names are a slip from many a word.

SCSS and Less nesting is resolved, `&-header` included, and `@import`,
`@use`, `@forward` and `meta.load-css` are followed, the URL each names
and nothing after it: `@use "./vars" with ($font: "Roboto")` imports
`./vars`, and `@import "a", url(b.css)` both. They are looked for beside the file, then in the
include paths, then into the package a bare name such as
`"font-awesome"` names, through its `sass` or `style` entry, its index,
or what its `exports` give a stylesheet under `style`, as
`@import "tw-animate-css"` finds `dist/tw-animate.css`. `sass:math` and
the like declare no class, and a stylesheet a URL names is the
browser's to load, so neither is read. A selector built from an
interpolation, `.btn-#{$size}`, settles every class that starts with
`btn-`.

A component's styles also reach its own element where another template
uses it: `:host(.row-fill)` styles `<app-form-row class="row-fill">`. A
class in `:host(...)`, written onto `:host` (`:host.row-fill`, or
`&.row-fill` nested in `:host`) or in or after `:host-context(...)` is
known on that element, in `class` and in the bindings that put classes
on it, `[class]`, `[class.x]` and `[ngClass]`, and in no input such as
`styleClass`. The component is the one whose selector matches the
element among what the template's component can use, found as
[Component names](#component-names) finds a directive. One a library
publishes compiled, or one that cannot be found, declares no class
there.

Styles that cannot be read settle every class in the template, and on
the component's element in the templates that use it:
`styles: [shared]`, a stylesheet that does not exist, a spread in the
decorator, a selector that starts with an interpolation, `&-x` inside
a `@mixin`, an import that does not resolve to a stylesheet or is
written with webpack's `~`, more than 64 stylesheets imported in
all, or rules whose selectors, nested in the rules around them, grow
by more than 1,000,000 characters in all, imports included, as
`&:not(&)` nested in itself does; rules nested in none add nothing. No
finding is better than a false one there, but the rule
says so once per component, on stderr:

```text
[@shadcn/lint] The styles of ListComponent in src/app/list.component.ts
cannot be read: styles holds `shared`, not a string.
shadcn/no-unknown-classes is skipped in its template and in the classes
of its element in others, since any class there may be one they declare.
```

### Global styles

`no-unknown-classes` also knows the classes in the project's global
stylesheets: the `styles` of its targets in `angular.json`, or of the
targets an Angular builder runs in an Nx `project.json`, a path or
`{ "input": ... }` from the workspace root. A target that runs tests, one
named `test` or run by Karma, Jest, Vitest or Angular's `unit-test`,
loads its styles in its test bed only, so they are not read. A style
that names a package, `"tailwindcss"`, is that package's stylesheet, as
Angular's stylesheet bundler resolves it: its `sass` or `style` entry,
its index, or what its `exports` give a stylesheet under `style`, never
its JavaScript.
They are read the way component styles are, and Sass imports in both are
also looked for in `stylePreprocessorOptions.includePaths`. A stylesheet
from a package, such as `node_modules/primeicons/primeicons.css`, counts
the classes its selectors write out.

An Nx workspace is read for its `project.json` files 5 directories
deep, up to 500 of them. A file whose own `project.json` lies deeper is
linted without its project's global styles, and a workspace with more
files reads the first 500; either is said once on stderr. Whether a
file is [Angular code](#angular-code) is read from its own
`project.json`, however deep.

A file belongs to the project whose `root` holds it, the deepest one. A
library that names no styles of its own sees the styles of every project
in the workspace, since the applications that use it bring theirs.
Global styles serve [Angular code](#angular-code), a project's plain
`.ts` files included. A React, Vue or Svelte file in the same
workspace, and a file outside the Angular projects, is not styled by
them and does not see their classes.

Global styles that cannot be read, a stylesheet that does not exist, a
selector that starts with an interpolation or an import that cannot be
read, settle every class in the
project, and the rule says so once on stderr.

### Host bindings

| `host` in `@Component` or `@Directive` | Read as                             |
| -------------------------------------- | ----------------------------------- |
| `class: "p-4"`                         | a static class string               |
| `style: "color: red"`                  | a style, property by property       |
| `"[class]": "on ? 'p-4' : 'p-2'"`      | the class strings, as in a template |
| `"[class.p-4]": "on"`                  | the class the key names             |
| `"[attr.class]"`, `"[className]"`      | like `[class]`                      |
| `"[style.color]": "c"`, `"[style]"`    | a style, as in a template           |

`host` is read in [Angular code](#angular-code), which every
`@Component` is, importing it from `@angular/core`. A finding is placed where the `.ts` spells the class, inside the string,
and its suggestion rewrites it there. `class: base` with
`const base = "p-4"` in the same file is followed, the way Angular's
compiler evaluates it. `no-unknown-classes` knows the classes the
component's own styles select, as in its template.

The expressions in the strings are parsed with
`@angular-eslint/bundled-angular-compiler`, which angular-eslint
installs. When it cannot be loaded, bindings are not read and the rule
says so once on stderr; static `class` and `style` are read either way.

A `host` that is not written out may bind any class: `host: HOST`, a
spread in it, a computed key, or a binding whose value is no string,
`` "[class]": `on ? ${A} : 'p-2'` ``. The rules that read it say so once
per component, on stderr:

```text
[@shadcn/lint] The host of HlmCard in src/app/card.ts cannot be read:
host is `HOST`, not an object. The classes and styles it binds there are
not checked.
```

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
arrow returns an expression or has a block with `return`. Of a helper
named `classes`, only that first argument is read: spartan's takes its
options second, `{ elementRef, injector }`, not classes. A function
passed to anything else is not read: `computed(() => "p-4")` leaves
`"p-4"` unread. Both readings are for spartan, so they apply in
[Angular code](#angular-code); in a React file, and in a file outside
the Angular projects, a helper reads every argument, and a function
passed to it is not read. `scanAllStrings` on `no-raw-colors` and
`no-arbitrary-values` reads every string literal in the file instead,
classes or not.

### Component names

A template imports nothing a tag could be resolved through, so no
element is a design-system component until a `no-restyle` contract names
it. Its `pattern` matches the element's tag or the name of one of its
attributes, bindings or events, as the template writes it: `hlmBtn`,
`p-button`. A pattern in slashes is a regex, `/^hlm/` or `/^p-/i`, the
way angular-eslint's options take one; any other pattern is the whole
name, so `hlmBtn` does not match `hlmBtnGroup`.

```js
"shadcn/no-restyle": ["error", {
  allow: ["layout"],
  contracts: [
    { pattern: "/^hlm/" },
    { pattern: "hlmCardContent", allow: ["layout", "spacing"] },
  ],
}]
```

```html
<!-- Allowed. -->
<button hlmBtn class="mt-4 w-full">Save</button>
<div hlmCardContent class="p-4">...</div>

<!-- Reported. -->
<button hlmBtn class="bg-pink-500">Save</button>
```

```text
"bg-pink-500" is not allowed on <button hlmBtn>: <button hlmBtn> owns
its color. Use a variant: default, outline, secondary, ghost,
destructive, link. Add a new variant in
libs/helm/button/src/lib/hlm-button.ts only if the design explicitly
calls for a treatment none of these provides.
```

The variants and sizes are those of the directive the name stands for,
found the way the compiler finds it: the template's component and what
it can use, the classes its standalone `imports` name or, for a
component an NgModule declares, what that module can use (see
[Libraries and NgModules](#libraries-and-ngmodules)), followed through
tsconfig paths, barrels and the arrays a library exports them in, such
as spartan's `HlmButtonImports`, and the selector each `@Directive` or
`@Component` declares. The paths are those of the `tsconfig.json` beside
the nearest `package.json`, or of `tsconfig.base.json` there when there
is none, as in an Nx workspace. A tag stands for a selector that is the tag
alone: a directive on `p-select[multiple]` adds to the `p-select`
component and is not it. The `cva` that class uses gives them, as it
does for a `.tsx` component, or when the file declares no other
directive, the `cva` in it. What its own `cva` lacks comes from the
directives its `hostDirectives` apply, one level down: spartan's
`HlmInputGroupButton` has its own sizes and `HlmButton`'s variants. A
message sends a new variant to a file that holds a `cva`, and to none
when no file does. A directive compiled into `node_modules`, whose
`.d.ts` holds no `cva`, gets a message that leaves what it offers to its
library, and a name no selector the component can use matches on that
element gets the message without variants. In both, `{{variants}}` and
`{{sizes}}` are empty in a contract's own words.

`class` and `style` are not names, and neither are `[class.x]`,
`[style.x]`, `[attr.x]` and animation bindings: no directive is matched
by them. Nor are a reference (`#ref`), a structural directive
(`*hlmIf`), whose template is another node, an animation's events
(`(@fade.done)`, `(animate.leave)`) and events on `window`, `document`
or `body`: they are not the element's own.

A name takes the last contract that matches it, as a component name
does. An element with several matched names,
`<button hlmBtn hlmTooltipTrigger>`, takes a class any of their
contracts allows; with `multipleContracts: "all"`, only one every
contract allows. A finding is named after a directive whose `cva` gives
the variants or sizes the message lists: `hlmBtn`, not the
`hlmDropdownMenuTrigger` written before it in
`<button [hlmDropdownMenuTrigger]="menu" hlmBtn>`, though the trigger
styles the element too through the CDK's `CdkMenuTrigger`. A `cva` that
gives neither is not the element's: the one beside `HlmTooltip` places
the arrow of the tooltip it opens. Else after a directive that styles
the element: one that takes its class into its own as spartan's
`classes()` does, builds classes with a helper `mergeFunctions` names
(`cn`, or `hlm` once named) in its class body, binds `class`,
`[class]`, `[class.x]`, `[attr.class]` or `[className]` in `host` or
with `@HostBinding`, or takes the class into an input whose public name
is `class`. What a class it extends does, it does too, as Angular
inherits host bindings, host directives and constructors: a class of
the project, or a library's, read as its own are. A library's class
that declares no directive, a helper or an `@Injectable` such as NgRx's
`ComponentStore`, has no host to compile: it adds nothing, and the
class it extends in turn still counts. `HlmTooltip` calls `hlm` only in its `providers` and at
module level, for the tooltip it opens, so it does not style its
element. Else after a name a directive the template imports stands for,
else after the first that refused the class.

A broad pattern also matches directives that only behave, such as
`hlmTooltipTrigger`. An element is left alone when every name a contract
matches on it stands for an attribute directive the template can use
and none of them styles the element: `<button hlmTooltipTrigger
class="…">` is a plain button. A component is never left alone this
way, whatever its `host` says: it draws itself in its template, as
`<Card className>` renders its own markup in React. That takes the directive's source, and that of the
directives it hosts. A library compiled into `node_modules`, such as
PrimeNG, Angular Material or spartan's brain, says it in its published
JavaScript: the declaration the Angular linker reads for each class,
with its `host`, the directives it hosts, and whether it inherits what
the class it extends declares (see
[Libraries and NgModules](#libraries-and-ngmodules)). A static class or
a binding of `class`, of one class, of `attr.class` or of `className`
there styles the element, a label such as
`cdk-menu-trigger` too. So `pTooltip`, `pStyleClass` and brain's
triggers style nothing; `pButton`, `pRipple`, which adds `p-ripple`,
and `matTooltip` do, and so does spartan's `HlmDropdownMenuTrigger`,
which hosts the CDK's `CdkMenuTrigger`. Whatever its `host` says, a
directive with an input whose public name is `class` takes the
element's class and puts it where it likes: Material's `MatMenu` on the
menu's panel through `panelClass`, so `<mat-menu class="…">` is judged,
brain's `BrnDialogOverlay` through `className`. That is read from the
source or the `.d.ts`, `@Input("class")`, `input("", { alias: "class" })`
or `inputs: ["panelClass: class"]`, among the directive's own inputs,
those of the class it extends and those its `hostDirectives` expose; a
directive that hosts one and leaves its `class` unexposed takes no
class through it. A library whose JavaScript is not installed, or
cannot be read, counts as one whose directives may style, and so does a
directive of yours that hosts one of them. So does a directive whose
`host` or `@HostBinding` is written through a constant, `host: HOST`,
one that extends what cannot be followed, a mixin's
`extends Mixin(Base)`, and one with an input whose public name cannot
be read, `input("", OPTIONS)`. With `/^p[A-Z]/` every `pButton` and `pRipple`
makes its element a component whose every class is reported, and the
contract judges `tooltipStyleClass` on every `pTooltip`. Name such a
library's styled components and directives exactly instead:

```js
"shadcn/no-restyle": ["error", {
  allow: ["layout"],
  contracts: [
    { pattern: "pButton" },
    { pattern: "/^p-(button|card|tag)$/" },
    { pattern: "/^mat-(card|(flat-|raised-|stroked-)?button)$/" },
  ],
}]
```

The classes the element itself wears, `class`, `[class]`, `[class.x]`,
`[ngClass]`, `[attr.class]`, `[className]` and the classes `ngClass` and
`routerLinkActive` add to it, are judged by the contracts of all its
names. An input such as `styleClass`, `panelClass` or `enterActiveClass`
hands its classes to the directive that takes it, which puts them where
it likes, inside its component or on another element, so that
directive's contract judges them:

```html
<!-- Reported on <p-dialog>: Dialog takes styleClass. -->
<p-dialog styleClass="bg-pink-500"></p-dialog>

<!-- matTooltipClass is MatTooltip's, so a contract on mat-icon leaves it
     alone and one on matTooltip judges it. -->
<mat-icon matTooltip="Delete" matTooltipClass="bg-pink-500">delete</mat-icon>
```

The directive that takes an input is the one the element matches that
declares the input under that public name: an `@Input()`, `input()` or
`model()` field, an entry of `inputs` in its decorator, an input of the
class it extends, or one its `hostDirectives` expose. A component takes
its inputs whether its selector is a tag or an attribute, as
`button[mat-flat-button]` is. A directive no contract names judges
nothing. When everything the template's component can use was read and
no directive on the element declares the input, its value lands nowhere
and is not judged: `styleClass` on PrimeNG 22.1's `<p-table>`, which
takes `tableStyleClass`. When that cannot be told, because an import, a
`.d.ts` or the module that declares the component cannot be read, the
input is taken for the component whose tag a contract names. So it is
when a decorator holds what cannot be read: a spread among its options,
an input under a computed key, or a selector built of another file's
constant. Lists written as constants, `imports: MATERIAL` or
`hostDirectives: HOSTS`, are followed to them, and a selector to the
constants its own file declares, `` selector: `${PREFIX}-card` ``. The
token rules check an input's classes either way. An `<ng-container>`
renders no element, so no contract judges its class.

A class the component's own styles declare is judged by what their
rules set, the way an `@utility` is by its body:
`.orders-card { max-width: 40rem; margin: 0 auto; }` is layout, so
`<mat-card class="orders-card">` passes a contract that allows layout.
Every rule the class is in counts, those for what the element holds
too, `.orders-card .title { ... }`, and each property must be one that
Tailwind's layout utilities set, prefixed or not: `margin`, `width`,
`position`, `grid-column`, `overflow`, `visibility`, or `text-align` as
`text-center` sets it. A rule that sets anything else, `padding`,
`color`, `background-image` or `text-overflow`, a custom property the
component inside may read, `all`, or what cannot be read as a property,
`@include`, `@extend` or `@apply`, leaves the class to the grammar,
which cannot tell what it changes, and so does a class the
[global styles](#global-styles) declare too, or only they do: it is
reported as one your CSS declares, not as a misspelling.

A contract written for React, `^Button$`, names no element in a
template. `require-static-classes` and the contracts of the other rules
do not apply to template elements, nor does `no-restyle` to a host
element. The token rules check their classes like any element's.

### Libraries and NgModules

What a class is, a directive or a component with a selector and inputs,
or a module and what it exports, is read from the first source that
knows it, as the compiler asks its readers in turn:

1. the project's own source: its `@Directive`, `@Component` and
   `@NgModule`;
2. an installed library's `.d.ts`: the `ɵɵComponentDeclaration`,
   `ɵɵDirectiveDeclaration` and `ɵɵNgModuleDeclaration` types the
   compiler writes there, read the way the compiler reads them, the same
   in Angular 19 to 22;
3. when neither can tell whose an input is, the tag: a contract that
   matches it makes the input that component's.

So the verdict follows the versions installed: an input a library
renames or moves to another component is judged by where the installed
`.d.ts` declares it. Without `node_modules`, as in a CI step that skips
the install, the second source is not there and the third answers. Only
the `.d.ts` a template's component reaches through its imports are
read, once per version of each package. One that has declarations none
of which can be read, as a later Angular may write them, is said once
per package on stderr:

```text
[@shadcn/lint] The Angular declarations in broken-kit 99.0.0 cannot be
read: index.d.ts has 2, none of them in the form Angular 19 to 22 write.
Until they can be, shadcn/no-restyle judges a *Class input on an
element by the contract of its tag, as it does without the package
installed.
```

Whether a library's class styles its element is read from its
published JavaScript, the partial declaration Angular's linker reads
(`ɵɵngDeclareDirective`, `ɵɵngDeclareComponent`): the module the
package's `exports`, or `module`, gives for the entry point the class
was imported from, and the modules it re-exports from. A declaration
the linker of Angular 22 would refuse, one whose `minVersion` is newer,
is not read. These are read only for an element a contract judges, once
per version of each package, and one with declarations none of which
can be read is said once per package:

```text
[@shadcn/lint] The Angular declarations in torn-kit 1.0.0 cannot be
read: fesm2022/torn-kit.mjs has 1, none of them in the form the linker
of Angular 22 reads. Until they can be, shadcn/no-restyle takes its
directives for ones that may style their element, as it does without
the package's JavaScript.
```

A component an NgModule declares, `standalone: false`, can use what
that module declares and what its `imports` export, and through those,
what the modules they export export in turn. The module is looked for in
the component's directory and the ones above it, up to the project's
root, the directory with `package.json`, `project.json` or
`angular.json`: `input.module.ts` beside `check/check.component.ts`. A
module declared anywhere else is not found: the messages on the
component's elements list no variants, and an input on them is taken
for the component its tag names.

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
  The exception, a component's `:host(.x)` on its own element, is read:
  see [Component styles](#component-styles).
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

- **What Sass makes of a Tailwind entry.** A Sass entry is read as CSS,
  not compiled: a theme a mixin writes out, or a token whose value is a
  Sass variable, `--color-brand: $brand`, is not what the build makes of
  it. One with Sass that CSS reads otherwise is not taken at all; see
  [Tailwind entry](#tailwind-entry).
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

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

### spartan's components.json

The `components.json` spartan's CLI writes has no `aliases`. A file
without them that has a field of spartan's schema (`componentsPath`,
`importAlias`, `buildable`, `generateAs`) is read as spartan's:
`componentsPath` is the directory of the design-system components,
`libs/ui` when left out, and `tailwind.css` names the entry as above. A
file with `aliases` is read as shadcn's.

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
arrow returns an expression or has a block with `return`. Of a helper
named `classes`, only that first argument is read: spartan's takes its
options second, `{ elementRef, injector }`, not classes. A function
passed to anything else is not read: `computed(() => "p-4")` leaves
`"p-4"` unread. `scanAllStrings` on `no-raw-colors` and
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
`.d.ts` holds no `cva`, or a name no selector the component can use
matches on that element gets the message without them, and
`{{variants}}` and `{{sizes}}` are empty in a contract's own words.

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
(`cn`, or `hlm` once named) in its class body, binds `class` or
`[class]` in `host`, or takes the class into an input whose public name
is `class`. `HlmTooltip` calls `hlm` only in its `providers` and at
module level, for the tooltip it opens, so it does not style its
element. Else after a name a directive the template imports stands for,
else after the first that refused the class.

A broad pattern also matches directives that only behave, such as
`hlmTooltipTrigger`. An element is left alone when every name a contract
matches on it stands for a directive the template can use and none of
them styles the element: `<button hlmTooltipTrigger class="…">` is a
plain button. That takes the directive's source, and that of the
directives it hosts. A library compiled into `node_modules`, such as
PrimeNG, Angular Material or spartan's brain, says it in its published
JavaScript: the declaration the Angular linker reads for each class,
with its `host`, the directives it hosts, and whether it inherits what
the class it extends declares (see
[Libraries and NgModules](#libraries-and-ngmodules)). A static class or
a binding of `class` there styles the element, a label such as
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
and one with an input whose public name cannot be read,
`input("", OPTIONS)`. With `/^p[A-Z]/` every `pButton` and `pRipple`
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
`[ngClass]`, `[attr.class]` and the classes `ngClass` and
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

A class the component's own styles or the
[global styles](#global-styles) declare, such as `card-header`, is
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

# Angular: how it reads

How `shadcn-lint-angular` reads an Angular project, for when a finding, or
its absence, needs explaining. Setup is in the [Angular guide](./angular.md).

## Host bindings

`host` in `@Component` and `@Directive` is read as a template's element
is: `class: "p-4"` and `style: "color: red"`, and the bindings
`"[class]"`, `"[class.p-4]"`, `"[attr.class]"`, `"[className]"`,
`"[style]"` and `"[style.color]"`. A finding is placed where the `.ts`
spells the class, and its suggestion rewrites it there. `class: base`
with `const base = "p-4"` in the same file is followed, as Angular's
compiler evaluates it. The expressions are parsed with
`@angular-eslint/bundled-angular-compiler`, which angular-eslint
installs; without it, static `class` and `style` and the keys of
`[class.x]` are still read.

## Class helpers

In a component file, classes in `cva(...)` and `cn(...)` are read as in a
`.tsx` file. Add a helper with another name with `mergeFunctions`, such
as spartan's `hlm` and `classes`. A helper listed there also reads what
an arrow passed to it returns, `classes(() => "p-4")`, an expression or
a block's `return`; of `classes`, only that first argument is read, since
spartan's takes `{ elementRef, injector }` second. Both readings are for
spartan, so they apply in [Angular code](#angular-code) only. A function
passed to anything else is not read: `computed(() => "p-4")` leaves
`"p-4"` unread, short of `scanAllStrings` on `no-raw-colors` and
`no-arbitrary-values`, which reads every string literal in the file.

## Angular code

The global styles, the Tailwind entry among them, spartan's
`components.json`, the class helpers and `host` are read the Angular way
in Angular code:

- templates, `.html` files and inline ones;
- scripts that import from `@angular/`;
- the other scripts of an Angular project, such as a barrel or a helper:
  a file under the `root` of a project in `angular.json`, or under the
  nearest Nx `project.json` when that project is Angular's
  ([Nx](./angular.md#nx)). A project with `"root": ""`, as `ng new` writes it, holds
  every file in the workspace, short of a directory below it with a
  `package.json` of its own.

A `.tsx`, `.jsx`, `.vue`, `.svelte`, `.astro` or `.mdx` file is its
framework's, inside an Angular project too, and any file outside the
Angular projects lints as `@shadcn/lint` lints it. A dependency on
`@angular/core` makes no file Angular's: an Nx workspace has one
`package.json` for all its projects.

## Component styles

`no-unknown-classes` knows the classes the component's own styles
select, as it knows the theme's. The component is the one whose
`@Component` names the template, by `templateUrl` from a `.ts` file in
the template's directory, or whose `.ts` holds the inline template. Its
styles are `styleUrl`, `styleUrls`, `styles` and a `<style>` in the template, as Angular's compiler adds it; its `host` is judged by
them too.

SCSS and Less nesting is resolved, `&-header` included. `@import`,
`@use`, `@forward` and `meta.load-css` are followed, the URL each names
and nothing after it (`@use "./vars" with (...)`): beside the file, in
the include paths, then into the package a bare name names, through its
`sass` or `style` entry, its index, or what its `exports` give under
`style`. A stylesheet a URL names is the browser's to load, and is not
read. A selector built from an interpolation, `.btn-#{$size}`, settles
every class that starts with `btn-`.

A class one slip from one the project's stylesheets write, `card-footr`
where `.card` nests `&-footer`, is reported as that one misspelled, with
a suggestion, when Tailwind knows no class it is one slip from. A
package's stylesheet, such as an icon font's, is not looked in.

A component's styles also reach its element where another template uses
it: `:host(.row-fill)`, `:host.row-fill`, `&.row-fill` nested in `:host`,
or a class in or after `:host-context(...)` make `row-fill` known on
`<app-form-row class="row-fill">`, in `class`, `[class]`, `[class.x]` and
`[ngClass]`, not in an input such as `styleClass`. The component is the
one whose selector matches the element, found as for
[Component names](./angular.md#component-names); one a library publishes compiled,
or one that cannot be found, declares no class there.

Styles that cannot be read settle every class in the template, and on
the component's element in the templates that use it: `styles: [shared]`,
a stylesheet that does not exist, a spread in the decorator, a selector
that starts with an interpolation, `&-x` inside a `@mixin`, an import
that does not resolve to a stylesheet or is written with webpack's `~`,
more than 64 stylesheets imported, or nesting that grows the selectors
by more than 1,000,000 characters in all, imports included, as
`&:not(&)` nested in itself does. The rule says so once per component
([Warnings](./angular.md#warnings)).

### Global styles

`no-unknown-classes` also knows the classes of the project's global
stylesheets: the `styles` of the build targets in `angular.json`, or of
those an Angular builder runs in an Nx `project.json`, a path or
`{ "input": ... }` from the workspace root. A test target, one named
`test` or run by Karma, Jest, Vitest or Angular's `unit-test`, is not
read. A style that names a package, `"tailwindcss"`, is its stylesheet,
never its JavaScript, as Angular's bundler resolves it. They are read as
component styles are, with `stylePreprocessorOptions.includePaths`, and a
package's stylesheet such as `primeicons.css` counts the classes its
selectors write out.

A file belongs to the deepest project whose `root` holds it. A project
that names no styles sees those of every project in the workspace, as
the apps that use a library bring theirs. An Nx workspace is read for
its `project.json` files 5 directories deep, up to 500 of them; whether
a file is Angular code is read from its own `project.json`, however deep.
Global styles serve [Angular code](#angular-code) only; a React, Vue or
Svelte file in the same workspace does not see their classes. Global styles
that cannot be read, for the reasons component styles cannot, settle
every class in the project.

## Variants in messages

The variants and sizes are those of the directive a name stands for,
found as the compiler finds it: through the component's standalone
`imports` or its NgModule, tsconfig paths (`tsconfig.base.json` when
there is no `tsconfig.json`, as in Nx), barrels and exported arrays such
as spartan's `HlmButtonImports`, to the selector each `@Directive` or
`@Component` declares. A tag stands for a selector that is the tag
alone: a directive on `p-select[multiple]` is not the `p-select`
component. They come from the `cva` that class uses, or the one in its
file when the file declares no other directive, and what that lacks from
its `hostDirectives`, one level down: spartan's `HlmInputGroupButton`
takes `HlmButton`'s variants. A new variant is sent to a file that holds
a `cva`, or to none. A directive compiled into `node_modules` gets a
message that leaves its variants to its library, and a name no selector
matches one without variants; in both, `{{variants}}` and `{{sizes}}` are
empty in a contract's own message.

## Which directive

A finding is named after a directive whose `cva` gives the variants or
sizes it lists, `hlmBtn` and not the `hlmDropdownMenuTrigger` before it
in `<button [hlmDropdownMenuTrigger]="menu" hlmBtn>`; else one that
styles the element; else a name a directive the template imports stands
for; else the first name that refused the class.

A directive styles its element when it takes the element's class into
its own, as spartan's `classes()` does; builds classes with a
`mergeFunctions` helper in its class body, not in `providers` or at
module level as `HlmTooltip` does for the tooltip it opens; binds
`class`, `[class]`, `[class.x]`, `[attr.class]` or `[className]` in
`host` or with `@HostBinding`, or `[ngClass]` in `host`; or has an input
whose public name is `class` (`@Input("class")`,
`input("", { alias: "class" })`, `inputs: ["panelClass: class"]`), its
own, inherited, or exposed by a directive it hosts, as Material's
`MatMenu` does. What the class it extends or a directive it hosts does,
it does too, as Angular inherits them; a library class that declares no
directive, such as NgRx's `ComponentStore`, adds nothing. A library's
directive is read from the `host` its published JavaScript declares, a
label such as `cdk-menu-trigger` included: `pTooltip`, `pStyleClass` and
spartan's brain triggers style nothing; `pButton`, `pRipple` and
`matTooltip` do.

An element is left alone when every name a contract matches on it is an
attribute directive that does not style it: `<button hlmTooltipTrigger
class="…">` is a plain button. A component is never left alone: it draws
itself in its template, as `<Card className>` does in React. What cannot
be read may style: a library whose JavaScript is not installed or cannot
be read, a directive that hosts one, `host: HOST`, a mixin's
`extends Mixin(Base)`, `input("", OPTIONS)`.

## Inputs

An input is taken by the directive on the element that declares it under
that public name: an `@Input()`, `input()` or `model()` field, an entry
of `inputs`, an input of the class it extends, or one its
`hostDirectives` expose. A component takes its inputs whether its
selector is a tag or an attribute, `button[mat-flat-button]`. A
directive no contract names judges nothing. When no directive declares
the input and everything the component can use was read, the value lands
nowhere and is not judged: `styleClass` on PrimeNG 22.1's `<p-table>`,
which takes `tableStyleClass`.

When it cannot be told, the input is taken for the component whose tag a
contract names: an import, a `.d.ts` or the NgModule that cannot be read,
a spread in a decorator, an input under a computed key, a selector built
from another file's constant. Constants in the same file are followed:
`imports: MATERIAL`, `hostDirectives: HOSTS`,
`` selector: `${PREFIX}-card` ``. An `<ng-container>` renders no element,
so no contract judges its class.

## Classes from the component's styles

A class the component's own styles declare is judged by what their rules
set, as an `@utility` is by its body: `.orders-card { max-width: 40rem;
margin: 0 auto; }` is layout, so `<mat-card class="orders-card">` passes
a contract that allows layout. Every rule the class is in counts,
`.orders-card .title` too, and each property must be one Tailwind's
layout utilities set, prefixed or not: `margin`, `width`, `position`,
`grid-column`, `overflow`, `visibility`, `text-align`. Anything else,
`padding`, `color`, `background-image`, `text-overflow`, a custom
property, `all`, `@include`, `@extend` or `@apply`, leaves the class to
the grammar, and so does a class the global styles declare too, or only
they do: it is reported as one your CSS declares.

## Libraries and NgModules

What a class is, a directive or a component with its selector and
inputs, or a module and its exports, is read from the first source that
knows it, as the compiler asks its readers in turn: the project's
`@Directive`, `@Component` and `@NgModule`; an installed library's
`.d.ts`, the `ɵɵComponentDeclaration`, `ɵɵDirectiveDeclaration` and
`ɵɵNgModuleDeclaration` types Angular 19 to 22 write; else, for an
input, the tag a contract matches. Whether a library's directive styles
its element is read from its published JavaScript, the partial
declaration Angular's linker reads (`ɵɵngDeclareDirective`,
`ɵɵngDeclareComponent`), short of one whose `minVersion` is newer than
Angular 22. So the verdict follows the installed versions, and without
`node_modules`, as in a CI step that skips the install, the tag answers.
Only what the templates reach is read, once per package version.

A component an NgModule declares, `standalone: false`, can use what the
module declares and what its `imports` export, transitively. The module
is looked for in the component's directory and those above it, up to the
project's root (`package.json`, `project.json` or `angular.json`); one
declared elsewhere is not found, so the messages list no variants and an
input is taken for the component its tag names.

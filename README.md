# shadcn-lint-angular

**[`@shadcn/lint`](https://github.com/shadcn-ui/lint) for Angular templates.**

`@shadcn/lint` is shadcn's agent-first linter for Tailwind design systems: when code breaks a rule, the error says what to use instead, from your components, variants and theme. It reads JSX, Vue and Svelte. In an Angular project it finds nothing, since it never sees a template ([shadcn-ui/lint#63](https://github.com/shadcn-ui/lint/issues/63)).

This unofficial fork adds the Angular side: `.html` templates and inline `template:` strings, class and style bindings, `host` metadata, component and global styles, and `no-restyle` contracts for directives such as spartan's `hlmBtn`. Everything else is `@shadcn/lint`.

```html
<button hlmBtn class="bg-pink-500">Save</button>
<div
  class="p-[13px]"
  [class]="on ? 'bg-primaryy' : 'p-4'"
  style="color: red"
></div>
```

```text
"bg-pink-500" is not allowed on <button hlmBtn>: <button hlmBtn> owns its color.
Use a variant: default, outline, secondary, ghost, destructive, link. Add a new
variant in libs/ui/button/src/lib/hlm-button.ts only if the design explicitly
calls for a treatment none of these provides

"p-[13px]" hardcodes an off-token value. Use "p-3.25" instead (same value, on
the scale)

"bg-primaryy" is not a declared theme color. Did you mean "bg-primary"?
Declared colors: accent, background, border, card, chart-1, ...

Inline style sets color. Style through classes; use CSS custom properties for
dynamic values
```

That is a spartan app with the [spartan settings](https://github.com/ChernyshovA/shadcn-lint-angular/blob/main/docs/angular.md#spartan) and the [`no-restyle` contracts](https://github.com/ChernyshovA/shadcn-lint-angular/blob/main/docs/angular.md#design-system-components) from the Angular guide; `no-raw-colors` reports `bg-pink-500` too.

## Quickstart

Give your coding agent this prompt:

```text
Read https://github.com/ChernyshovA/shadcn-lint-angular/blob/main/SETUP.md
and set up shadcn-lint-angular in this project.
```

## Get started

Requires Node.js 20.19 and ESLint 9.30 or later, ESLint 10 included.

```bash
ng add angular-eslint  # skip it if the project lints with ESLint already
npm install -D shadcn-lint-angular
```

`ng add angular-eslint` installs the latest angular-eslint, made for the latest Angular; on an older one, name its major, `ng add angular-eslint@21`, as `ng add` asks. It writes `eslint.config.js`; add the plugin's blocks after its own:

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

```bash
npx eslint .
```

The [Angular guide](https://github.com/ChernyshovA/shadcn-lint-angular/blob/main/docs/angular.md) covers a config without `ng add`, Nx, Oxlint, the Tailwind entry, spartan, Angular Material and PrimeNG, `no-restyle` contracts, and what is not read.

## Rules

The rules are `@shadcn/lint`'s, under the same `shadcn/` names.

| Rule                                                                                                                          | What it catches                                                        |
| ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| [`no-restyle`](https://github.com/ChernyshovA/shadcn-lint-angular/blob/main/docs/rules/no-restyle.md)                         | Restyling a design-system component with classes.                      |
| [`no-raw-colors`](https://github.com/ChernyshovA/shadcn-lint-angular/blob/main/docs/rules/no-raw-colors.md)                   | Raw colors such as `bg-pink-500`.                                      |
| [`no-arbitrary-values`](https://github.com/ChernyshovA/shadcn-lint-angular/blob/main/docs/rules/no-arbitrary-values.md)       | Arbitrary values such as `p-[13px]`.                                   |
| [`no-inline-styles`](https://github.com/ChernyshovA/shadcn-lint-angular/blob/main/docs/rules/no-inline-styles.md)             | Inline styles.                                                         |
| [`no-unknown-classes`](https://github.com/ChernyshovA/shadcn-lint-angular/blob/main/docs/rules/no-unknown-classes.md)         | Classes Tailwind cannot generate, such as `rounded-huge`.              |
| [`require-static-classes`](https://github.com/ChernyshovA/shadcn-lint-angular/blob/main/docs/rules/require-static-classes.md) | Component classes the linter cannot read, such as `` `bg-${color}` ``. |

## Settings

The settings are `@shadcn/lint`'s, described in [its README](https://github.com/shadcn-ui/lint#settings) with monorepos. This fork adds two, which change nothing unless set: `settings.shadcn.entryPoint`, the stylesheet that imports Tailwind ([Tailwind entry](https://github.com/ChernyshovA/shadcn-lint-angular/blob/main/docs/angular.md#tailwind-entry)), and `no-restyle`'s `multipleContracts` ([Component names](https://github.com/ChernyshovA/shadcn-lint-angular/blob/main/docs/angular.md#component-names)).

## Differences from @shadcn/lint

This release is built on `@shadcn/lint`'s `main` at [`8551d00`](https://github.com/shadcn-ui/lint/commit/8551d008d756fdf7bc02e74ccb3224ee3b140267), after 0.2.1. Files that are not Angular code lint as they do there, apart from:

- fixes for [shadcn-ui/lint#98](https://github.com/shadcn-ui/lint/issues/98) (hyphenated SVG color attributes), [#108](https://github.com/shadcn-ui/lint/issues/108) (a stylesheet's `@import "tailwindcss"` read Tailwind's JavaScript as CSS) and [#111](https://github.com/shadcn-ui/lint/issues/111) (`tsconfig.base.json` paths in Nx), proposed upstream in [#105](https://github.com/shadcn-ui/lint/pull/105), [#113](https://github.com/shadcn-ui/lint/pull/113) and [#114](https://github.com/shadcn-ui/lint/pull/114);
- two settings that change nothing unless set: `settings.shadcn.entryPoint` and `no-restyle`'s `multipleContracts`;
- warnings prefixed `[shadcn-lint-angular]`.

For React, Vue or Svelte alone, use [`@shadcn/lint`](https://github.com/shadcn-ui/lint): its README covers the agent evals, settings and monorepos, which apply here too.

## Documentation

The [documentation](https://github.com/ChernyshovA/shadcn-lint-angular/blob/main/docs/README.md) holds the [Angular guide](https://github.com/ChernyshovA/shadcn-lint-angular/blob/main/docs/angular.md), [how it reads](https://github.com/ChernyshovA/shadcn-lint-angular/blob/main/docs/angular-how-it-works.md) an Angular project, the rules and their options, and troubleshooting. Its guides for React, Vue and Svelte are `@shadcn/lint`'s.

## Contributing

Report what goes wrong in an Angular project in [this repository's issues](https://github.com/ChernyshovA/shadcn-lint-angular/issues). A bug that also shows with `@shadcn/lint`, in a React, Vue or Svelte file, belongs [upstream](https://github.com/shadcn-ui/lint/issues). Workspace setup, tests and benchmarks are in the [contributing guide](https://github.com/ChernyshovA/shadcn-lint-angular/blob/main/CONTRIBUTING.md).

## License

[MIT](https://github.com/ChernyshovA/shadcn-lint-angular/blob/main/LICENSE).

# Set up shadcn-lint-angular

Install and register `shadcn-lint-angular` in the user's Angular project.
Do not enable new rules or change existing rule policies. Once setup is
complete, help the user find where to configure their rules.

Read the [Angular guide](https://github.com/ChernyshovA/shadcn-lint-angular/blob/main/docs/angular.md)
before making changes. Its examples enable rules; use their plugin, parser
and processor setup without adding those rules.

## Inspect the project

- Detect the package manager from the project metadata and lockfile.
- Determine whether this is an Angular CLI project (`angular.json`) or an
  Nx workspace (`nx.json`, `project.json`). Find the apps, the libraries
  that hold UI components, the lint configs, and the task runner.
- Use the existing ESLint setup, usually the `eslint.config.js` that
  `ng add angular-eslint` or Nx wrote. If there is no ESLint, set it up
  with `ng add angular-eslint`, which picks the `angular-eslint` version
  for the project's Angular. Oxlint cannot read Angular templates: if the
  project has only Oxlint, keep it and tell the user that templates need
  ESLint. Check Node.js and linter version compatibility against the
  guide.
- Find the Tailwind v4 entry: the global stylesheet in `angular.json` or
  `project.json` that imports Tailwind with the theme. If it is Sass or
  cannot be found, the guide's
  [Tailwind entry](https://github.com/ChernyshovA/shadcn-lint-angular/blob/main/docs/angular.md#tailwind-entry)
  section says when to name one with `settings.shadcn.entryPoint`.
- Find the design-system components. For spartan (`@spartan-ng/*`, `hlm`
  directives), follow the guide's
  [spartan](https://github.com/ChernyshovA/shadcn-lint-angular/blob/main/docs/angular.md#spartan)
  section for its settings; configure only the settings the project needs.

## Install and register the plugin

Use the project's package manager. Install `shadcn-lint-angular` in the
package that owns the lint configuration. In a workspace, follow the
existing shared-config and dependency conventions.

Preserve existing rules, parsers, processors, scripts, and ignores. Add
the plugin's blocks after angular-eslint's: one for `**/*.ts`, which reads
`host` bindings and class helpers, and one for `**/*.html`, which reads
templates; inline templates reach it through angular-eslint's processor.
In an Nx workspace, add the blocks to the root `eslint.config.mjs`, as the
guide's [Nx](https://github.com/ChernyshovA/shadcn-lint-angular/blob/main/docs/angular.md#nx)
section shows. Do not add rule presets, enable new rules, or add rule
overrides.

Ensure the lint command works with the project's scripts and task runner:
`ng lint`, `npx eslint .`, or `npx nx run-many -t lint` in an Nx
workspace. Reuse the existing command where possible; add one if needed.

## Verify and hand off

Run the relevant lint commands to check that the configuration loads.
Separate configuration errors from existing lint findings. Read any
message prefixed `[shadcn-lint-angular]` on stderr: it names what could
not be read, such as the Tailwind entry, and the guide's
[Warnings](https://github.com/ChernyshovA/shadcn-lint-angular/blob/main/docs/angular.md#warnings)
section says what to do. With no new rules enabled, this verifies setup,
not design-system enforcement.

Tell the user:

- What was installed and which configuration files changed.
- How to run lint, including workspace commands where applicable.
- That no new `shadcn-lint-angular` rules were enabled. If the project
  already had rules configured, explain that those were preserved.
- Where to add rules, and where to read the
  [available rules](https://github.com/ChernyshovA/shadcn-lint-angular/blob/main/README.md#rules)
  and the guide's
  [design-system components](https://github.com/ChernyshovA/shadcn-lint-angular/blob/main/docs/angular.md#design-system-components)
  section for `no-restyle` contracts.

Leave choosing rules and defining what is allowed to the user.

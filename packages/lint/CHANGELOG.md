# shadcn-lint-angular

## 0.1.0

First release: [`@shadcn/lint`](https://github.com/shadcn-ui/lint) with Angular template support, built on its `main` at [`8551d00`](https://github.com/shadcn-ui/lint/commit/8551d008d756fdf7bc02e74ccb3224ee3b140267), after 0.2.1. For the history before, see [its changelog](https://github.com/shadcn-ui/lint/blob/main/packages/lint/CHANGELOG.md).

- Read Angular templates under ESLint, `.html` files and inline `template:` strings through angular-eslint's processor: static `class`, `style` and `*Class` attributes, class and style bindings, `routerLinkActive`, and the elements of ICU messages. In component files, read the `host` of `@Component` and `@Directive` and class helpers such as `cva`.
- Know the classes a component's own styles and the project's global styles declare, from `angular.json` or Nx `project.json`, SCSS and Less nesting included.
- Find the Tailwind entry among an Angular app's global styles, as spartan's `styles.scss`, or take the one `settings.shadcn.entryPoint` names.
- Check Angular elements in `no-restyle` once a contract names them by tag, attribute or binding, with the variants of the directive they stand for, read from the project's sources, a library's `.d.ts` and its published JavaScript. `multipleContracts: "all"` makes an element several contracts match take only a class every one allows.
- Read the `components.json` spartan's CLI writes.
- Fix shadcn-ui/lint#98 (`stop-color` and other hyphenated SVG color attributes in templates), shadcn-ui/lint#108 (a stylesheet's `@import "tailwindcss"` read Tailwind's JavaScript as CSS) and shadcn-ui/lint#111 (`paths` in an Nx workspace's `tsconfig.base.json`).

Files that are not Angular code lint as they do with `@shadcn/lint` at `8551d00`, apart from those three fixes and the two settings, which change nothing unless they are set.

// What this plugin reads the Angular way it reads only in Angular code:
// templates, scripts that import Angular, and the other scripts of an
// Angular project. A React file next to an Angular application, or one
// that happens to call its helper `classes` or its decorator
// `Component`, lints as it does without Angular.

import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import * as ngParser from "@angular-eslint/template-parser"
import tsParser from "@typescript-eslint/parser"
import { Linter } from "eslint"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { plugin } from "../src/plugin"
import { workspaceReadsForTests } from "../src/project/angular-workspace"
import { resetWarnings, setWarningSink } from "../src/project/warn"

const FIXTURES = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures"
)
const REACT = path.join(FIXTURES, "project")

const ALL = {
  "shadcn/no-raw-colors": "error",
  "shadcn/no-arbitrary-values": "error",
  "shadcn/no-unknown-classes": "error",
  "shadcn/no-inline-styles": "error",
}

function lintScript(
  code: string,
  filename: string,
  rules: Record<string, unknown> = ALL,
  settings: Record<string, unknown> = {}
) {
  return new Linter({ cwd: path.dirname(filename) }).verify(
    code,
    [
      {
        files: ["**/*.{ts,tsx}"],
        languageOptions: {
          parser: tsParser as any,
          parserOptions: { ecmaFeatures: { jsx: true } },
        },
        plugins: { shadcn: plugin as any },
        rules: rules as any,
        settings,
      },
    ],
    { filename }
  )
}

const tokens = (messages: Linter.LintMessage[]) =>
  messages.map((m) => `${m.ruleId}: ${m.message.split('"')[1]}`)

let warnings: string[] = []
beforeEach(() => {
  warnings = []
  resetWarnings()
  setWarningSink((message) => warnings.push(message))
})
afterEach(() => setWarningSink((message) => console.warn(message)))

describe("a React file in a workspace with an Angular application", () => {
  const unknown = { "shadcn/no-unknown-classes": "error" }

  it("does not know the Angular projects' global classes", () => {
    const file = path.join(FIXTURES, "angular-nx/apps/react/src/page.tsx")
    expect(
      tokens(
        lintScript(
          `export const Page = () => <div className="web-global admin-global react-global zz-unknown" />`,
          file,
          unknown
        )
      )
    ).toEqual([
      "shadcn/no-unknown-classes: web-global",
      "shadcn/no-unknown-classes: admin-global",
      "shadcn/no-unknown-classes: react-global",
      "shadcn/no-unknown-classes: zz-unknown",
    ])
    // The Angular project's own files still do.
    expect(
      new Linter({ cwd: path.join(FIXTURES, "angular-nx") })
        .verify(
          `<div class="web-global zz-unknown"></div>`,
          [
            {
              files: ["**/*.html"],
              languageOptions: { parser: ngParser as any },
              plugins: { shadcn: plugin as any },
              rules: unknown as any,
            },
          ],
          { filename: path.join(FIXTURES, "angular-nx/apps/web/src/a.html") }
        )
        .map((m) => m.message.split('"')[1])
    ).toEqual(["zz-unknown"])
  })

  it("does not read the workspace's project.json files", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shadcn-ng-reads-"))
    try {
      fs.writeFileSync(path.join(dir, "nx.json"), "{}")
      fs.mkdirSync(path.join(dir, "apps/web/src"), { recursive: true })
      fs.mkdirSync(path.join(dir, "apps/react/src"), { recursive: true })
      fs.writeFileSync(
        path.join(dir, "apps/web/project.json"),
        `{ "targets": { "build": { "executor": "@nx/angular:application" } } }`
      )
      const before = workspaceReadsForTests()
      lintScript(
        `export const P = () => <div className="zz" />`,
        path.join(dir, "apps/react/src/page.tsx"),
        unknown
      )
      expect(workspaceReadsForTests()).toBe(before)
      // Nor does a plain script of the React app: only its project.json.
      fs.writeFileSync(path.join(dir, "apps/react/project.json"), `{}`)
      lintScript(
        `export const box = cn("zz")`,
        path.join(dir, "apps/react/src/box.ts"),
        unknown
      )
      expect(workspaceReadsForTests()).toBe(before)
      // An Angular file in the same workspace does.
      lintScript(
        `import { Component } from "@angular/core"\nexport const c = Component`,
        path.join(dir, "apps/web/src/a.ts"),
        unknown
      )
      expect(workspaceReadsForTests()).toBe(before + 1)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it("is checked where the Angular project's global styles cannot be read", () => {
    const file = path.join(
      FIXTURES,
      "angular-workspace/projects/broken/src/page.tsx"
    )
    expect(
      tokens(
        lintScript(
          `export const Page = () => <div className="zz-unknown" />`,
          file,
          unknown
        )
      )
    ).toEqual(["shadcn/no-unknown-classes: zz-unknown"])
    expect(warnings.filter((w) => w.includes("global styles"))).toEqual([])
  })
})

describe("merge functions outside Angular code", () => {
  const PAGE = path.join(REACT, "app/page.tsx")
  const settings = { shadcn: { mergeFunctions: ["classes"] } }

  it("reads every argument of a function named classes", () => {
    expect(
      tokens(
        lintScript(
          `import { classes } from "@/lib/utils"\nexport const a = classes("p-4", "bg-red-500", "w-[13px]")`,
          PAGE,
          ALL,
          settings
        )
      )
    ).toEqual([
      "shadcn/no-raw-colors: bg-red-500",
      "shadcn/no-arbitrary-values: w-[13px]",
    ])
  })

  it("does not read what a function argument returns", () => {
    expect(
      lintScript(
        [
          `import { cn } from "@/lib/utils"`,
          `export const a = cn(() => "bg-red-500")`,
          `export const b = cn(() => { return "p-[7px]" })`,
          `export const c = cn(async () => "bg-red-500")`,
          `export const d = classes(() => "bg-red-500")`,
          `declare function classes(...a: unknown[]): string`,
        ].join("\n"),
        PAGE,
        ALL,
        settings
      )
    ).toEqual([])
  })
})

describe("merge functions in Angular code", () => {
  const FILE = path.join(FIXTURES, "angular-project/src/app/hlm.ts")
  const settings = { shadcn: { mergeFunctions: ["hlm", "classes"] } }
  const angular = (lines: string[]) =>
    [`import { Directive } from "@angular/core"`, ...lines].join("\n")

  it("reads only the first argument of classes, and what its function returns", () => {
    expect(
      tokens(
        lintScript(
          angular([
            `declare function classes(...a: unknown[]): void`,
            `declare function hlm(...a: unknown[]): string`,
            `classes(() => hlm("bg-red-500", "p-[7px]"), { element: null })`,
            `classes(() => { if (on) return "w-[3px]"; return "bg-blue-500" })`,
            `declare const on: boolean`,
          ]),
          FILE,
          ALL,
          settings
        )
      )
    ).toEqual([
      "shadcn/no-raw-colors: bg-red-500",
      "shadcn/no-arbitrary-values: p-[7px]",
      "shadcn/no-arbitrary-values: w-[3px]",
      "shadcn/no-raw-colors: bg-blue-500",
    ])
  })

  it("does not read what an async function returns", () => {
    expect(
      lintScript(
        angular([
          `declare function classes(...a: unknown[]): void`,
          `classes(async () => "bg-red-500")`,
        ]),
        FILE,
        ALL,
        settings
      )
    ).toEqual([])
  })
})

describe("host objects outside Angular code", () => {
  const decorated = (decorator: string) =>
    [
      `declare function ${decorator}(config: any): ClassDecorator`,
      `@${decorator}({`,
      `  selector: "x-foo",`,
      `  host: { class: "bg-red-500 p-[13px] flexx", "[style.color]": "'red'" },`,
      `})`,
      `export class Foo {}`,
    ].join("\n")

  it("reads a decorator named Component or Directive as plain code", () => {
    for (const file of ["app/foo.ts", "app/foo.tsx"]) {
      for (const decorator of ["Component", "Directive"]) {
        expect(
          lintScript(decorated(decorator), path.join(REACT, file))
        ).toEqual([])
      }
    }
  })

  it("reads the host of a component that imports Angular", () => {
    expect(
      tokens(
        lintScript(
          `import { Component } from "@angular/core"\n` +
            decorated("Component").split("\n").slice(1).join("\n"),
          path.join(FIXTURES, "angular-project/src/app/foo.component.ts")
        )
      )
    ).toEqual([
      "shadcn/no-raw-colors: bg-red-500",
      "shadcn/no-arbitrary-values: p-[13px]",
      "shadcn/no-unknown-classes: flexx",
      "shadcn/no-inline-styles: undefined",
    ])
  })
})

// One package.json for the workspace, which depends on Angular and on
// React, as an Nx monorepo has it: what a plain script is, Angular's or
// not, is told by the project that holds it.
describe("a plain script in a mixed Nx workspace", () => {
  let dir = ""
  const write = (files: Record<string, string>) => {
    for (const [file, text] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true })
      fs.writeFileSync(path.join(dir, file), text)
    }
  }
  beforeEach(() => {
    dir = fs.realpathSync.native(
      fs.mkdtempSync(path.join(os.tmpdir(), "shadcn-ng-mixed-"))
    )
    fs.symlinkSync(
      path.resolve(FIXTURES, "../../node_modules"),
      path.join(dir, "node_modules")
    )
    write({
      "nx.json": "{}",
      "package.json": JSON.stringify({
        name: "mixed",
        dependencies: { "@angular/core": "^22.0.0", react: "^19.0.0" },
      }),
      // `ng add tailwindcss` writes Tailwind alone into tailwind.css,
      // spartan's CLI the theme into styles.scss.
      "apps/web/project.json": JSON.stringify({
        targets: {
          build: {
            executor: "@angular/build:application",
            options: {
              styles: [
                "apps/web/src/tailwind.css",
                "apps/web/src/styles.scss",
                "apps/web/src/global.scss",
              ],
            },
          },
        },
      }),
      "apps/web/src/tailwind.css": `@import "tailwindcss";`,
      "apps/web/src/styles.scss": [
        `@import "tailwindcss/theme.css" layer(theme);`,
        `@import "tailwindcss/utilities.css";`,
        `@theme { --color-brand: #123456; }`,
      ].join("\n"),
      "apps/web/src/global.scss": `.web-global { color: red; }`,
      "apps/react/project.json": JSON.stringify({
        targets: { build: { executor: "@nx/vite:build" } },
      }),
      // A library Nx's Angular generator writes: no target of Angular's,
      // the prefix of its selectors.
      "libs/kit/project.json": JSON.stringify({
        prefix: "kit",
        projectType: "library",
        targets: {},
      }),
      "libs/hooks/project.json": JSON.stringify({
        projectType: "library",
        targets: {},
      }),
    })
  })
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

  const lint = (
    code: string,
    file: string,
    rules: Record<string, unknown> = ALL,
    settings: Record<string, unknown> = {}
  ) =>
    new Linter({ cwd: dir }).verify(
      code,
      [
        {
          files: ["**/*.{ts,tsx}"],
          languageOptions: {
            parser: tsParser as any,
            parserOptions: { ecmaFeatures: { jsx: true } },
          },
          plugins: { shadcn: plugin as any },
          rules: rules as any,
          settings,
        },
      ],
      { filename: path.join(dir, file) }
    )
  const unknown = { "shadcn/no-unknown-classes": "error" }

  it("takes the Angular app's entry for its script, and upstream's for the React app's", () => {
    const helper = `export const box = cn("zz-box")`
    const where = (file: string) =>
      lint(helper, file, unknown).map((m) => m.message.split(" in ")[1])
    expect(where("apps/web/src/app/box.ts")).toEqual([
      expect.stringMatching(/^apps\/web\/src\/styles\.scss/),
    ])
    // Upstream takes a CSS file under the project that imports Tailwind.
    expect(where("apps/react/src/box.ts")).toEqual([
      expect.stringMatching(/^apps\/web\/src\/tailwind\.css/),
    ])
    expect(warnings).toEqual([])
  })

  it("knows the Angular app's global classes in its script alone", () => {
    const helper = `export const box = cn("web-global zz-box")`
    expect(tokens(lint(helper, "apps/web/src/app/box.ts", unknown))).toEqual([
      "shadcn/no-unknown-classes: zz-box",
    ])
    expect(tokens(lint(helper, "apps/react/src/box.ts", unknown))).toEqual([
      "shadcn/no-unknown-classes: web-global",
      "shadcn/no-unknown-classes: zz-box",
    ])
  })

  it("reads spartan's components.json for the Angular app's script alone", () => {
    write({ "components.json": JSON.stringify({ componentsPath: "libs/kit" }) })
    const restyle = { "shadcn/no-restyle": "error" }
    const helper = `export const box = cn("p-4")`
    lint(helper, "apps/web/src/app/box.ts", restyle)
    lint(helper, "libs/kit/src/index.ts", restyle)
    expect(warnings).toEqual([])
    lint(helper, "apps/react/src/box.ts", restyle)
    expect(warnings).toEqual([
      expect.stringContaining('The ui alias "@/components/ui"'),
    ])
  })

  it("reads helpers as spartan means them in an Angular project alone", () => {
    const settings = { shadcn: { mergeFunctions: ["classes"] } }
    const helper = [
      `export const a = classes("p-4", "bg-red-500")`,
      `export const b = cn(() => "w-[3px]")`,
    ].join("\n")
    const angular = ["shadcn/no-arbitrary-values: w-[3px]"]
    const upstream = ["shadcn/no-raw-colors: bg-red-500"]
    for (const [file, expected] of [
      ["apps/web/src/app/box.ts", angular],
      ["libs/kit/src/lib/box.ts", angular],
      ["apps/react/src/box.ts", upstream],
      ["libs/hooks/src/box.ts", upstream],
      // A component file of another framework, in an Angular project too.
      ["apps/web/src/app/box.tsx", upstream],
      // Outside any project.
      ["tools/box.ts", upstream],
    ] as const) {
      expect(tokens(lint(helper, file, ALL, settings)), file).toEqual(expected)
    }
  })

  // An Nx workspace whose Angular app is at its root, with a React app
  // inside it.
  it("gives a file to the nearest project", () => {
    write({
      "project.json": JSON.stringify({
        targets: { build: { executor: "@nx/angular:application" } },
      }),
    })
    fs.rmSync(path.join(dir, "libs/hooks/project.json"))
    const settings = { shadcn: { mergeFunctions: ["classes"] } }
    const helper = `export const a = classes("p-4", "bg-red-500")`
    expect(tokens(lint(helper, "src/box.ts", ALL, settings))).toEqual([])
    expect(
      tokens(lint(helper, "libs/hooks/src/box.ts", ALL, settings))
    ).toEqual([])
    expect(
      tokens(lint(helper, "apps/react/src/box.ts", ALL, settings))
    ).toEqual(["shadcn/no-raw-colors: bg-red-500"])
  })
})

// An Angular CLI workspace has no project.json.
describe("a plain script in an Angular CLI workspace", () => {
  const settings = { shadcn: { mergeFunctions: ["classes"] } }
  const helper = `export const a = classes("p-4", "bg-red-500")`

  it("is Angular code under a project's root, and not outside it", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shadcn-ng-cli-"))
    try {
      fs.writeFileSync(
        path.join(dir, "angular.json"),
        JSON.stringify({ projects: { app: { root: "projects/app" } } })
      )
      expect(
        tokens(
          lintScript(
            helper,
            path.join(dir, "projects/app/src/box.ts"),
            ALL,
            settings
          )
        )
      ).toEqual([])
      expect(
        tokens(
          lintScript(helper, path.join(dir, "tools/box.ts"), ALL, settings)
        )
      ).toEqual(["shadcn/no-raw-colors: bg-red-500"])
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  // `ng new` roots its project at the workspace. A library has a
  // package.json too, which ng-packagr reads, and is a project of its own.
  it("is a root project's up to a package of its own below the workspace", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shadcn-ng-cli-"))
    try {
      const files: Record<string, string> = {
        "package.json": `{ "name": "ws", "private": true }`,
        "angular.json": JSON.stringify({
          projects: {
            app: { root: "", sourceRoot: "src" },
            lib: { root: "projects/lib", projectType: "library" },
          },
        }),
        "react/package.json": `{ "name": "react", "private": true }`,
        "projects/lib/package.json": `{ "name": "lib" }`,
      }
      for (const [file, text] of Object.entries(files)) {
        fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true })
        fs.writeFileSync(path.join(dir, file), text)
      }
      const lint = (file: string) =>
        tokens(lintScript(helper, path.join(dir, file), ALL, settings))
      expect(lint("src/app/box.ts")).toEqual([])
      expect(lint("tools/box.ts")).toEqual([])
      expect(lint("projects/lib/src/box.ts")).toEqual([])
      expect(lint("react/src/lib/box.ts")).toEqual([
        "shadcn/no-raw-colors: bg-red-500",
      ])
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  // Nx's own angular.json names a project by its directory: it holds no
  // root, so a file is no project's but by its imports, and that is said.
  it("is no project's where angular.json names one by its directory", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shadcn-ng-cli-"))
    try {
      fs.writeFileSync(
        path.join(dir, "angular.json"),
        JSON.stringify({ version: 2, projects: { app: "apps/app" } })
      )
      expect(
        tokens(
          lintScript(
            helper,
            path.join(dir, "apps/app/src/box.ts"),
            ALL,
            settings
          )
        )
      ).toEqual(["shadcn/no-raw-colors: bg-red-500"])
      expect(warnings).toEqual([
        expect.stringContaining(
          "has fields that are not read, since they are not what Angular takes there: projects.app (not an object)."
        ),
      ])
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})

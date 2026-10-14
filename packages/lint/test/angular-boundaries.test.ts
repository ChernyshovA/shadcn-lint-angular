// What this plugin reads the Angular way it reads only in Angular code:
// templates, and scripts that import Angular. A React file next to an
// Angular application, or one that happens to call its helper `classes`
// or its decorator `Component`, lints as it does without Angular.

import * as path from "node:path"
import { fileURLToPath } from "node:url"
import * as ngParser from "@angular-eslint/template-parser"
import tsParser from "@typescript-eslint/parser"
import { Linter } from "eslint"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { plugin } from "../src/plugin"
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

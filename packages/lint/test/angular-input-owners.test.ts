// no-restyle on an input such as styleClass: its classes are judged by
// the contract of the directive that takes it. Whose an input is comes
// from the first source that knows: the project's own decorators, then
// the declarations an installed library's .d.ts carries, the way ngtsc
// reads one (compiler-cli, src/ngtsc/metadata). When neither can tell,
// the component a contract names by its tag takes it.

import * as path from "node:path"
import { fileURLToPath } from "node:url"
import * as ngParser from "@angular-eslint/template-parser"
import { Linter } from "eslint"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { plugin } from "../src/plugin"
import {
  declarationFilesReadForTests,
  resetDeclarationFilesForTests,
} from "../src/project/angular-dts"
import { resetFsMemo } from "../src/project/fs"
import { resetWarnings, setWarningSink } from "../src/project/warn"
import { setAngularCompilerForTests } from "../src/sites/readers/angular-compiler"

const FIXTURES = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures"
)
const LIBRARIES = path.join(FIXTURES, "angular-libraries")
const APP = path.join(LIBRARIES, "src/app")
const PAGE = path.join(APP, "page.component.html")

function lintAt(
  code: string,
  options: unknown,
  filename = PAGE,
  cwd = LIBRARIES
) {
  return new Linter({ cwd }).verify(
    code,
    [
      {
        files: ["**/*.html"],
        languageOptions: { parser: ngParser as any },
        plugins: { shadcn: plugin as any },
        rules: { "shadcn/no-restyle": ["error", options] } as any,
      },
    ],
    { filename }
  )
}

// Each finding as the class and the element it names.
const findings = (code: string, options: unknown, filename = PAGE) =>
  lintAt(code, options, filename).map(
    (m) => `${m.message.split('"')[1]} on <${/<([^>]+)>/.exec(m.message)![1]}>`
  )

const contracts = (...patterns: string[]) => ({
  allow: ["layout"],
  contracts: patterns.map((pattern) => ({ pattern })),
})

describe("the input of a directive a library's .d.ts declares", () => {
  // <mat-icon matTooltip matTooltipClass>: the tag is MatIcon, the
  // input MatTooltip's, whose classes go to the tooltip's panel.
  it("is not the input of the component on the tag", () => {
    const code = `<mat-icon matTooltip="Delete" matTooltipClass="bg-pink-500" class="bg-pink-500">delete</mat-icon>`
    expect(findings(code, contracts("/^mat-/"))).toEqual([
      "bg-pink-500 on <mat-icon>",
    ])
    // A contract on the directive judges it.
    expect(findings(code, contracts("/^mat-/", "matTooltip"))).toEqual([
      "bg-pink-500 on <mat-icon matTooltip>",
      "bg-pink-500 on <mat-icon>",
    ])
  })

  it("is the input of the component on the tag that declares it", () => {
    expect(
      findings(
        `<mat-select panelClass="bg-pink-500" [panelClass]="{ 'rounded-full': on }"></mat-select>`,
        contracts("/^mat-/")
      )
    ).toEqual(["bg-pink-500 on <mat-select>", "rounded-full on <mat-select>"])
    expect(
      findings(
        `<p-dialog styleClass="bg-pink-500"></p-dialog>`,
        contracts("/^p-/")
      )
    ).toEqual(["bg-pink-500 on <p-dialog>"])
  })

  it("an attribute's component takes its inputs", () => {
    expect(
      findings(
        `<button kitBtn iconClass="bg-pink-500"></button><a kitBtn [iconClass]="'rounded-full'"></a>`,
        contracts("/^kit/")
      )
    ).toEqual(["bg-pink-500 on <button kitBtn>", "rounded-full on <a kitBtn>"])
  })

  // PrimeNG's Tooltip puts tooltipStyleClass on its tooltip, and
  // StyleClass enterActiveClass on the element it targets.
  it("is judged by the directive's own contract, and not without one", () => {
    const code = `<div pTooltip="Info" tooltipStyleClass="bg-pink-500"></div><button pButton pStyleClass="@next" enterActiveClass="animate-scalein"></button>`
    expect(findings(code, contracts("/^p-/", "pButton"))).toEqual([])
    expect(findings(code, contracts("pTooltip"))).toEqual([
      "bg-pink-500 on <div pTooltip>",
    ])
  })

  // The files ng-packagr wrote before it bundled them: `export declare
  // class` in a file of its own, behind `export *`.
  it("is read from declarations in files of their own", () => {
    expect(
      findings(
        `<split-chip splitTip splitTipClass="rounded-full" labelClass="bg-pink-500"></split-chip>`,
        contracts("/^split-/")
      )
    ).toEqual(["bg-pink-500 on <split-chip>"])
  })

  it("is inherited from the class it extends", () => {
    expect(
      findings(
        `<kit-panel panelClass="bg-pink-500"></kit-panel>`,
        contracts("/^kit/")
      )
    ).toEqual(["bg-pink-500 on <kit-panel>"])
  })

  it("is one a host directive exposes", () => {
    expect(
      findings(
        `<span kitTooltip kitHintClass="bg-pink-500" kitTooltipClass="rounded-full"></span>`,
        contracts("/^kit/")
      )
    ).toEqual([
      "bg-pink-500 on <span kitTooltip>",
      "rounded-full on <span kitTooltip>",
    ])
  })

  // Every directive on it was read whole, and none takes it: the
  // attribute lands nowhere.
  it("is no one's when every directive on the element was read and none declares it", () => {
    expect(
      findings(
        `<kit-card fooClass="bg-pink-500"></kit-card><mat-icon iconClass="bg-pink-500"></mat-icon>`,
        contracts("/^(kit|mat)-/")
      )
    ).toEqual([])
  })

  it("is no one's on an element of a standalone component that imports nothing", () => {
    expect(
      findings(
        `<mat-select panelClass="bg-pink-500" class="rounded-full"></mat-select>`,
        contracts("/^mat-/"),
        path.join(APP, "bare.component.html")
      )
    ).toEqual(["rounded-full on <mat-select>"])
  })

  it("is the tag's when a class it extends cannot be read", () => {
    expect(
      findings(
        `<kit-mixed fooClass="bg-pink-500"></kit-mixed>`,
        contracts("/^kit/")
      )
    ).toEqual(["bg-pink-500 on <kit-mixed>"])
  })

  it("leaves the message without variants: a compiled class has no cva to read", () => {
    expect(
      lintAt(
        `<p-dialog styleClass="bg-pink-500"></p-dialog>`,
        contracts("/^p-/")
      ).map((m) => m.message)
    ).toEqual([
      '"bg-pink-500" is not allowed on <p-dialog>: <p-dialog> owns its color. Use one of its variants. Add a new variant only if the design explicitly calls for a treatment none of them provides.',
    ])
  })
})

describe("the input of a directive the project declares", () => {
  it("reads inputs, signal inputs, models, aliases and what the class extends", () => {
    expect(
      findings(
        [
          `<span appTip appTipClass="bg-pink-500" appTipPanelClass="rounded-full"></span>`,
          `<span appTip arrowClass="shadow-lg" appBaseClass="border-red-500"></span>`,
          `<span appTip appEdgeClass="text-red-500" appHintClass="bg-blue-500"></span>`,
          `<app-chip labelClass="bg-pink-500"></app-chip>`,
        ].join(""),
        contracts("/^app/")
      )
    ).toEqual([
      "bg-pink-500 on <span appTip>",
      "rounded-full on <span appTip>",
      "shadow-lg on <span appTip>",
      "border-red-500 on <span appTip>",
      "text-red-500 on <span appTip>",
      "bg-blue-500 on <span appTip>",
      "bg-pink-500 on <app-chip>",
    ])
  })

  it("is the tag's when a directive on the element names an input this cannot read", () => {
    expect(
      findings(
        `<app-chip appOdd appOddClass="bg-pink-500"></app-chip><app-chip appTip fooClass="rounded-full"></app-chip>`,
        contracts("app-chip")
      )
    ).toEqual(["bg-pink-500 on <app-chip>"])
  })

  it("on a component's tag is the directive's, not the component's", () => {
    expect(
      findings(
        `<app-chip appTip appTipClass="bg-pink-500" labelClass="rounded-full"></app-chip>`,
        contracts("app-chip")
      )
    ).toEqual(["rounded-full on <app-chip>"])
  })
})

describe("the scope of a component an NgModule declares", () => {
  const CHECK = path.join(APP, "legacy/check/check.component.html")
  const code = `<mat-icon matTooltip="Delete" matTooltipClass="bg-pink-500">delete</mat-icon>`

  // check.component.ts is declared by legacy.module.ts above it, which
  // imports SharedModule, which exports MatTooltipModule.
  it("is the module's, through what its imports export", () => {
    expect(findings(code, contracts("/^mat-/"), CHECK)).toEqual([])
  })

  it("is read from a module in the component's own file, through forRoot()", () => {
    expect(
      findings(
        `<span appTip appTipClass="bg-pink-500"></span><app-scam fooClass="rounded-full"></app-scam>`,
        contracts("/^app/"),
        path.join(APP, "legacy/scam.component.html")
      )
    ).toEqual(["bg-pink-500 on <span appTip>"])
  })

  // The cycle is read once; what lies past it is not known, so an input
  // no one declares is the tag's.
  it("reads a module that exports one exporting it back once", () => {
    expect(
      findings(
        `<app-chip labelClass="bg-pink-500"></app-chip><app-chip fooClass="rounded-full"></app-chip>`,
        contracts("app-chip"),
        path.join(APP, "cycle/cycle.component.html")
      )
    ).toEqual(["bg-pink-500 on <app-chip>", "rounded-full on <app-chip>"])
  })

  it("is unknown when no module declaring it is found", () => {
    expect(
      findings(
        code,
        contracts("/^mat-/"),
        path.join(APP, "orphan.component.html")
      )
    ).toEqual(["bg-pink-500 on <mat-icon>"])
  })
})

// A list a decorator names by a constant is read through it. What is
// there and cannot be read leaves whose an input is unknown, never no
// one's.
describe("a scope written through constants", () => {
  const FORMS = path.join(APP, "forms")
  const code = `<mat-select panelClass="bg-pink-500"></mat-select><mat-icon matTooltip="Delete" matTooltipClass="rounded-full"></mat-icon>`

  it("reads what a module exports and imports as a constant", () => {
    expect(
      findings(
        code,
        contracts("/^mat-/"),
        path.join(FORMS, "modules.component.html")
      )
    ).toEqual(["bg-pink-500 on <mat-select>"])
  })

  it("finds the module that declares a component as a constant", () => {
    expect(
      findings(
        code,
        contracts("/^mat-/"),
        path.join(FORMS, "declared.component.html")
      )
    ).toEqual(["bg-pink-500 on <mat-select>"])
  })

  // A component with no selector is matched by no element, and leaves
  // the scope read whole.
  it("reads a selector built of the file's own constants", () => {
    expect(
      findings(
        `<kit-local localClass="bg-pink-500" fooClass="rounded-full"></kit-local><kit-tpl tplClass="shadow-lg"></kit-tpl>`,
        contracts("/^kit-/"),
        path.join(FORMS, "selectors.component.html")
      )
    ).toEqual(["bg-pink-500 on <kit-local>", "shadow-lg on <kit-tpl>"])
  })

  it("is the tag's when a selector in the scope cannot be read", () => {
    expect(
      findings(
        `<kit-local fooClass="rounded-full"></kit-local>`,
        contracts("/^kit-/"),
        path.join(FORMS, "unread-selector.component.html")
      )
    ).toEqual(["rounded-full on <kit-local>"])
  })

  it("reads what hostDirectives listed as a constant expose", () => {
    expect(
      findings(
        `<span kitHinted kitHintClass="bg-pink-500"></span>`,
        contracts("/^kit/"),
        path.join(FORMS, "directives.component.html")
      )
    ).toEqual(["bg-pink-500 on <span kitHinted>"])
  })

  it("reads inputs through a namespace import of @angular/core", () => {
    expect(
      findings(
        `<kit-spaced spaceClass="bg-pink-500" tintClass="shadow-lg" toneClass="text-red-500" fooClass="rounded-full"></kit-spaced>`,
        contracts("/^kit/"),
        path.join(FORMS, "directives.component.html")
      )
    ).toEqual([
      "bg-pink-500 on <kit-spaced>",
      "shadow-lg on <kit-spaced>",
      "text-red-500 on <kit-spaced>",
    ])
  })

  it("is the tag's when a spread or a computed key can carry an input", () => {
    expect(
      findings(
        `<kit-spread fooClass="bg-pink-500"></kit-spread><kit-keyed fooClass="rounded-full"></kit-keyed>`,
        contracts("/^kit/"),
        path.join(FORMS, "directives.component.html")
      )
    ).toEqual(["bg-pink-500 on <kit-spread>", "rounded-full on <kit-keyed>"])
  })

  it("is the tag's when a spread can carry the component's imports", () => {
    expect(
      findings(
        `<mat-select panelClass="bg-pink-500"></mat-select>`,
        contracts("/^mat-/"),
        path.join(FORMS, "spread.component.html")
      )
    ).toEqual(["bg-pink-500 on <mat-select>"])
  })

  it("is the tag's when an entry calls a method of a list", () => {
    expect(
      findings(
        code,
        contracts("/^mat-/"),
        path.join(FORMS, "concat.component.html")
      )
    ).toEqual(["bg-pink-500 on <mat-select>", "rounded-full on <mat-icon>"])
  })

  // An element is left alone only when every directive its names stand
  // for is read and styles nothing.
  it("may style its element through what this cannot read", () => {
    expect(
      findings(
        [
          `<span kitTrigger class="bg-pink-500"></span>`,
          `<span kitHostsLibrary class="bg-pink-500"></span>`,
          `<span kitHostConstant class="bg-pink-500"></span>`,
          `<span kitBound class="bg-pink-500"></span>`,
          `<span kitDeep class="bg-pink-500"></span>`,
        ].join(""),
        contracts("/^kit/"),
        path.join(FORMS, "styles.component.html")
      )
    ).toEqual([
      "bg-pink-500 on <span kitHostsLibrary>",
      "bg-pink-500 on <span kitHostConstant>",
      "bg-pink-500 on <span kitBound>",
      "bg-pink-500 on <span kitDeep>",
    ])
  })
})

describe("a library's .d.ts that cannot be read", () => {
  beforeEach(() => {
    resetWarnings()
    setWarningSink(() => {})
  })

  afterEach(() => {
    setWarningSink((message) => console.warn(message))
    resetWarnings()
  })

  // Said once per package (angular-dts.test.ts).
  it("leaves the input to the component its tag names", () => {
    expect(
      findings(
        `<broken-card cardClass="bg-pink-500"></broken-card><garbled-card cardClass="rounded-full"></garbled-card>`,
        contracts("/-card$/"),
        path.join(APP, "broken.component.html")
      )
    ).toEqual([
      "bg-pink-500 on <broken-card>",
      "rounded-full on <garbled-card>",
    ])
  })
})

describe("whose input it is, when that cannot be told", () => {
  it("is the tag's without the compiler", () => {
    setAngularCompilerForTests(null)
    try {
      expect(
        findings(
          `<mat-icon matTooltip="Delete" matTooltipClass="bg-pink-500"></mat-icon><div pTooltip="Info" tooltipStyleClass="bg-pink-500"></div>`,
          contracts("/^mat-/", "pTooltip")
        )
      ).toEqual(["bg-pink-500 on <mat-icon>"])
    } finally {
      setAngularCompilerForTests(undefined)
    }
  })
})

describe("without the library installed", () => {
  const PROJECT = path.join(FIXTURES, "angular-project")
  const CARD = path.join(PROJECT, "src/app/card.component.html")

  it("an input on a tag a contract names is that component's", () => {
    expect(
      new Linter({ cwd: PROJECT })
        .verify(
          `<button pButton pStyleClass="@next" enterActiveClass="animate-scalein bg-red-500" leaveToClass="hidden"></button><p-select panelClass="bg-red-500" [styleClass]="'rounded-full'"></p-select>`,
          [
            {
              files: ["**/*.html"],
              languageOptions: { parser: ngParser as any },
              plugins: { shadcn: plugin as any },
              rules: {
                "shadcn/no-restyle": [
                  "error",
                  contracts("/^p[A-Z-]/", "hlmBtn"),
                ],
              } as any,
            },
          ],
          { filename: CARD }
        )
        .map((m) => m.message.split('"')[1])
    ).toEqual(["bg-red-500", "rounded-full"])
  })
})

// Only what a template's component imports is read: the entry points it
// names, and what their modules export. What a module imports for its
// own templates is not.
describe("the .d.ts read", () => {
  // Those earlier tests read, and every answer built of them, are
  // forgotten: what is read is this run's.
  beforeEach(() => {
    resetFsMemo()
    resetDeclarationFilesForTests()
  })

  it("are those the template's component reaches", () => {
    findings(
      `<mat-icon matTooltip="Delete" matTooltipClass="bg-pink-500"></mat-icon>`,
      contracts("/^mat-/")
    )
    const read = declarationFilesReadForTests().map((file) =>
      path.relative(LIBRARIES, file)
    )
    expect(read).toEqual(
      expect.arrayContaining([
        "node_modules/@angular/material/tooltip/index.d.ts",
        "node_modules/@angular/material/tooltip-module.d.d.ts",
        "node_modules/@angular/material/icon-module.d.d.ts",
        "node_modules/@angular/cdk/bidi-module.d.d.ts",
      ])
    )
    // MatTooltipModule imports A11yModule and OverlayModule, and exports
    // neither.
    expect(read).not.toContain("node_modules/@angular/cdk/a11y/index.d.ts")
    expect(read).not.toContain("node_modules/@angular/cdk/overlay/index.d.ts")
  })
})

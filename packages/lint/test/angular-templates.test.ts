import * as fs from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import templatePlugin from "@angular-eslint/eslint-plugin-template"
import * as ngParser from "@angular-eslint/template-parser"
import tsParser from "@typescript-eslint/parser"
import { Linter } from "eslint"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { plugin } from "../src/plugin"
import { ownClassesOfCss } from "../src/project/angular-styles"
import { useParser } from "../src/project/parser"
import { resetWarnings, setWarningSink } from "../src/project/warn"
import { angularReader } from "../src/sites/readers/angular"

const PROJECT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures/angular-project"
)
const TEMPLATE = path.join(PROJECT, "src/app/card.component.html")

// The rules a static class or style attribute reaches.
const RULES = {
  "shadcn/no-raw-colors": "error",
  "shadcn/no-arbitrary-values": "error",
  "shadcn/no-unknown-classes": "error",
  "shadcn/no-inline-styles": "error",
}

const PROBE = `<div class="bg-red-500 p-[13px] text-[#123456]" style="color: red">x</div>`

// Runs the plugin the way an Angular project does: ESLint with
// @angular-eslint/template-parser on the component's .html file.
function lint(
  code: string,
  rules: Record<string, unknown> = RULES,
  filename = TEMPLATE
) {
  return new Linter({ cwd: PROJECT }).verify(
    code,
    [
      {
        files: ["**/*.html"],
        languageOptions: { parser: ngParser as any },
        plugins: { shadcn: plugin as any },
        rules: rules as any,
      },
    ],
    { filename }
  )
}

// The same, on a component file whose inline templates angular-eslint's
// processor hands over as files of their own.
function lintInline(code: string, filename: string) {
  return new Linter({ cwd: PROJECT }).verify(
    code,
    [
      {
        files: ["**/*.ts"],
        languageOptions: { parser: tsParser as any },
        processor: templatePlugin.processors["extract-inline-html"] as any,
      },
      {
        files: ["**/*.html"],
        languageOptions: { parser: ngParser as any },
        plugins: { shadcn: plugin as any },
        rules: RULES as any,
      },
    ],
    {
      filename,
      // The ESLint class lints every block a config matches; Linter
      // keeps only .js blocks unless told otherwise.
      filterCodeBlock: () => true,
    }
  )
}

const found = (code: string) =>
  lint(code).map((m) => `${m.ruleId}: ${m.message.split(".")[0]}`)

const located = (messages: Linter.LintMessage[]) =>
  messages.map((m) => [m.ruleId, m.line, m.column, m.endLine, m.endColumn])

// The source text between a finding's start and end.
function spanned(code: string, message: Linter.LintMessage) {
  const lines = code.split(/(?<=\n)/)
  const offset = (line: number, column: number) =>
    lines.slice(0, line - 1).join("").length + column - 1
  return code.slice(
    offset(message.line, message.column),
    offset(message.endLine!, message.endColumn!)
  )
}

describe("Angular templates", () => {
  it("reports the probe from the issue the way a .tsx file does", () => {
    const tsx = new Linter({ cwd: PROJECT }).verify(
      `export const C = () => <div className="bg-red-500 p-[13px] text-[#123456]" style={{ color: "red" }}>x</div>`,
      [
        {
          files: ["**/*.tsx"],
          languageOptions: {
            parser: tsParser as any,
            parserOptions: { ecmaFeatures: { jsx: true } },
          },
          plugins: { shadcn: plugin as any },
          rules: RULES as any,
        },
      ],
      { filename: path.join(PROJECT, "src/app/card.tsx") }
    )
    const html = lint(PROBE)
    const text = (messages: Linter.LintMessage[]) =>
      messages.map((m) => `${m.ruleId}: ${m.message}`)
    expect(html).toHaveLength(4)
    expect(text(html)).toEqual(text(tsx))
  })

  it("places a finding on the value it reads, quotes included", () => {
    const messages = lint(PROBE)
    expect(located(messages)).toEqual([
      ["shadcn/no-raw-colors", 1, 12, 1, 48],
      ["shadcn/no-arbitrary-values", 1, 12, 1, 48],
      ["shadcn/no-arbitrary-values", 1, 12, 1, 48],
      ["shadcn/no-inline-styles", 1, 55, 1, 67],
    ])
    expect(messages.map((m) => spanned(PROBE, m))).toEqual([
      `"bg-red-500 p-[13px] text-[#123456]"`,
      `"bg-red-500 p-[13px] text-[#123456]"`,
      `"bg-red-500 p-[13px] text-[#123456]"`,
      `"color: red"`,
    ])
  })

  it("spans a value written over several lines", () => {
    const code = [
      "<section>",
      "  <div",
      `    class="p-4`,
      `           bg-red-500 text-[#123456]"`,
      `    style="`,
      "      color: red;",
      "      --tone: #fff",
      `    "`,
      "  ></div>",
      "</section>",
    ].join("\n")
    const messages = lint(code)
    expect(located(messages)).toEqual([
      ["shadcn/no-raw-colors", 3, 11, 4, 38],
      ["shadcn/no-arbitrary-values", 3, 11, 4, 38],
      ["shadcn/no-inline-styles", 5, 11, 8, 6],
      ["shadcn/no-inline-styles", 5, 11, 8, 6],
    ])
    expect(spanned(code, messages[0])).toBe(
      `"p-4\n           bg-red-500 text-[#123456]"`
    )
    expect(spanned(code, messages[2])).toBe(
      `"\n      color: red;\n      --tone: #fff\n    "`
    )
  })

  it("starts a value that opens with whitespace at its quote", () => {
    const code = `<div class="  bg-red-500"></div>`
    const messages = lint(code)
    expect(located(messages)).toEqual([["shadcn/no-raw-colors", 1, 12, 1, 26]])
    expect(spanned(code, messages[0])).toBe(`"  bg-red-500"`)
  })

  it("counts lines across CRLF line endings", () => {
    const code = `<p></p>\r\n<div\r\n  class="flex\r\n    p-[13px]"></div>\r\n`
    const messages = lint(code)
    expect(located(messages)).toEqual([
      ["shadcn/no-arbitrary-values", 3, 9, 4, 14],
    ])
    expect(spanned(code, messages[0])).toBe(`"flex\r\n    p-[13px]"`)
  })

  it("places a single-quoted and an unquoted value the same way", () => {
    const code = `<p class='p-[13px]'></p><p class=p-[13px]></p>`
    const messages = lint(code)
    expect(located(messages)).toEqual([
      ["shadcn/no-arbitrary-values", 1, 10, 1, 20],
      ["shadcn/no-arbitrary-values", 1, 34, 1, 42],
    ])
    expect(messages.map((m) => spanned(code, m))).toEqual([
      `'p-[13px]'`,
      "p-[13px]",
    ])
  })

  it("lines up with a disable comment in the template", () => {
    const code = [
      "<!-- eslint-disable-next-line shadcn/no-raw-colors -->",
      `<div class="bg-red-500"></div>`,
      `<div class="bg-red-500"></div>`,
    ].join("\n")
    expect(located(lint(code))).toEqual([
      ["shadcn/no-raw-colors", 3, 12, 3, 24],
    ])
  })

  it("keeps the quotes, or their absence, when a suggestion rewrites a value", () => {
    for (const [before, after] of [
      [`<div class="flex p-[13px]"></div>`, `<div class="flex p-3.25"></div>`],
      [`<div class='flex p-[13px]'></div>`, `<div class='flex p-3.25'></div>`],
      [`<div class=p-[13px]></div>`, `<div class=p-3.25></div>`],
    ]) {
      const [message] = lint(before)
      const [suggestion] = message.suggestions ?? []
      const { range, text } = suggestion.fix
      expect(before.slice(0, range[0]) + text + before.slice(range[1])).toBe(
        after
      )
    }
  })

  it("reports in an inline template without a suggestion that would land elsewhere in the .ts", () => {
    // The processor `ng add angular-eslint` configures lints each inline
    // template as a file of its own and moves findings and fixes back into
    // the .ts, but not suggestions: applied, one would rewrite the top of
    // the file.
    const code = [
      `import { Component } from "@angular/core"`,
      "",
      "@Component({",
      `  selector: "app-card",`,
      '  template: `<div class="flex p-[13px]"></div>`,',
      "})",
      "export class CardComponent {}",
    ].join("\n")
    const messages = lintInline(
      code,
      path.join(PROJECT, "src/app/card.component.ts")
    )
    expect(located(messages)).toEqual([
      ["shadcn/no-arbitrary-values", 5, 25, 5, 40],
    ])
    expect(spanned(code, messages[0])).toBe(`"flex p-[13px]"`)
    expect(messages[0].suggestions).toBeUndefined()
  })

  it("reads what an inline template string writes out around its interpolations", () => {
    const code = [
      `import { Component } from "@angular/core"`,
      "@Component({",
      `  selector: "app-x",`,
      "  template: `<div class=\"p-4 ${a} btn-${size} ${c ? 'p-[13px] x' : ''}glued ${d}${e ? 'q w' : ''} m-2 text-[#123456]\"></div>`,",
      "})",
      "export class X {}",
    ].join("\n")
    const messages = lintInline(code, path.join(PROJECT, "src/app/x.ts"))
    expect(messages.map((m) => [m.ruleId, m.message.split('"')[1]])).toEqual([
      ["shadcn/no-arbitrary-values", "text-[#123456]"],
    ])
  })

  it("offers no rewrite for a class an entity spells", () => {
    const [message] = lint(`<div class="flex&#32;p-[13px]"></div>`)
    expect(message.message).toContain(`"p-[13px]"`)
    expect(message.suggestions).toBeUndefined()
  })

  it("reads each element once, inside blocks and structural directives", () => {
    const code = [
      "@if (open) {",
      `  <ng-container *ngFor="let item of items">`,
      `    <li *ngIf="item" class="bg-red-500"></li>`,
      "  </ng-container>",
      "}",
      `@for (item of items; track item) { <span class="bg-red-500"></span> } @empty { <i class="bg-red-500"></i> }`,
      `<ng-template #row><b class="bg-red-500"></b></ng-template>`,
      `@defer { <u class="bg-red-500"></u> } @placeholder { <s class="bg-red-500"></s> }`,
      `@switch (mode) { @case ("a") { <em class="bg-red-500"></em> } @default { <q class="bg-red-500"></q> } }`,
    ].join("\n")
    expect(lint(code).map((m) => [m.ruleId, m.line, m.column])).toEqual([
      ["shadcn/no-raw-colors", 3, 28],
      ["shadcn/no-raw-colors", 6, 48],
      ["shadcn/no-raw-colors", 6, 89],
      ["shadcn/no-raw-colors", 7, 28],
      ["shadcn/no-raw-colors", 8, 19],
      ["shadcn/no-raw-colors", 8, 63],
      ["shadcn/no-raw-colors", 9, 42],
      ["shadcn/no-raw-colors", 9, 83],
    ])
  })

  it("reads a style and an SVG color once on an element a structural directive wraps", () => {
    const code = [
      `<div *ngIf="open" style="color: red"></div>`,
      `<svg><path *ngFor="let p of paths" fill="#ff0000"></path></svg>`,
      `<ng-template ngFor let-p [ngForOf]="paths"><b style="color: red"></b></ng-template>`,
    ].join("\n")
    expect(lint(code).map((m) => [m.ruleId, m.line, m.column])).toEqual([
      ["shadcn/no-inline-styles", 1, 25],
      ["shadcn/no-raw-colors", 2, 36],
      ["shadcn/no-inline-styles", 3, 53],
    ])
  })

  it("counts columns past non-ASCII text the way ESLint does", () => {
    const code = `<p title="Привет 😀"><i>ё</i></p><b class="p-[13px]"></b>`
    const messages = lint(code)
    expect(located(messages)).toEqual([
      ["shadcn/no-arbitrary-values", 1, 43, 1, 53],
    ])
    expect(spanned(code, messages[0])).toBe(`"p-[13px]"`)
  })

  it("rewrites one class of a value written over several lines", () => {
    const code = `<div\n  class="flex\n    p-[13px]\n    gap-2"\n></div>`
    const [message] = lint(code)
    const { range, text } = message.suggestions![0].fix
    expect(code.slice(0, range[0]) + text + code.slice(range[1])).toBe(
      `<div\n  class="flex\n    p-3.25\n    gap-2"\n></div>`
    )
  })

  it("judges each declaration of a style", () => {
    expect(
      found(`<div style="color: red; --tone: #fff; --gap: 4px"></div>`)
    ).toEqual([
      "shadcn/no-inline-styles: Inline style sets color",
      "shadcn/no-inline-styles: Custom property --tone hardcodes a color",
    ])
  })

  it("asks the project's Tailwind about each class", () => {
    expect(found(`<div class="flex flex-cols"></div>`)).toEqual([
      `shadcn/no-unknown-classes: "flex-cols" is not a class this project's Tailwind knows, so no CSS is generated for it`,
    ])
  })

  it("reads other static class attributes the way JSX reads labelClassName", () => {
    expect(
      found(
        `<p-button styleClass="bg-red-500"></p-button><div ngClass="p-[13px]"></div>`
      )
    ).toEqual([
      `shadcn/no-raw-colors: "bg-red-500" uses the raw Tailwind palette and no declared theme color is close to it`,
      `shadcn/no-arbitrary-values: "p-[13px]" hardcodes an off-token value`,
    ])
  })

  it("does not read the element PrimeNG's pStyleClass targets as classes", () => {
    expect(
      found(
        `<button pStyleClass="@next" enterActiveClass="animate-scalin" leaveToClass="hidden"></button>`
      )
    ).toEqual([
      'shadcn/no-unknown-classes: "animate-scalin" is not a class this project\'s Tailwind knows, so no CSS is generated for it',
    ])
  })

  it("reads the classes routerLinkActive adds", () => {
    // No "class" anywhere in the file, which a file is skipped without.
    const code = `<a routerLink="/" routerLinkActive="font-bold bg-red-500 p-[13px]"></a>`
    expect(found(code)).toEqual([
      `shadcn/no-raw-colors: "bg-red-500" uses the raw Tailwind palette and no declared theme color is close to it`,
      `shadcn/no-arbitrary-values: "p-[13px]" hardcodes an off-token value`,
    ])
    const [, message] = lint(code)
    const { range, text } = message.suggestions![0].fix
    expect(code.slice(0, range[0]) + text + code.slice(range[1])).toBe(
      `<a routerLink="/" routerLinkActive="font-bold bg-red-500 p-3.25"></a>`
    )
  })

  it("reads a color attribute on an SVG element, not on a component", () => {
    expect(
      found(
        `<svg fill="none" stroke="currentColor"><path fill="#ff0000"></path></svg><mat-icon color="red"></mat-icon>`
      )
    ).toEqual([`shadcn/no-raw-colors: fill="#ff0000" hardcodes a color`])
  })

  it("reads the SVG color attributes HTML spells with a hyphen", () => {
    expect(
      found(
        `<svg><stop stop-color="#ff0000"></stop><feFlood flood-color="red"></feFlood><feDiffuseLighting lighting-color="rgb(0 0 0)"></feDiffuseLighting><stop stop-color="currentColor"></stop></svg>`
      )
    ).toEqual([
      `shadcn/no-raw-colors: stop-color="#ff0000" hardcodes a color`,
      `shadcn/no-raw-colors: flood-color="red" hardcodes a color`,
      `shadcn/no-raw-colors: lighting-color="rgb(0 0 0)" hardcodes a color`,
    ])
  })

  it("does not take a tag for a component a .tsx file would import", () => {
    // The React fixture, whose ui directory has a Card.
    const project = path.join(PROJECT, "../project")
    const messages = new Linter({ cwd: project }).verify(
      `<Card class="text-2xl"></Card><card-title class="text-2xl"></card-title>`,
      [
        {
          files: ["**/*.html"],
          languageOptions: { parser: ngParser as any },
          plugins: { shadcn: plugin as any },
          rules: {
            "shadcn/no-restyle": "error",
            "shadcn/require-static-classes": "error",
          },
        },
      ],
      { filename: path.join(project, "app/card.component.html") }
    )
    expect(messages).toEqual([])
  })

  it("leaves bindings unread", () => {
    expect(
      lint(
        `<div [class]="'bg-red-500'" [ngClass]="{ 'bg-red-500': on }" [class.bg-red-500]="on" [style.color]="'red'" [ngStyle]="{ color: 'red' }" class="bg-red-500 {{ tone }}"></div>`
      )
    ).toEqual([])
  })

  it("finds the parent element past ng-container, templates and blocks", () => {
    const parents: string[] = []
    const probe = {
      create: () => ({
        TextAttribute(node: any) {
          const element = angularReader.elementOf(node)
          const parent = angularReader.parentElementOf(element)
          parents.push(angularReader.nameOf(parent)?.text ?? "")
        },
      }),
    }
    new Linter({ cwd: PROJECT }).verify(
      `<ul><ng-container><li class="a"></li></ng-container>@if (x) { <ng-template><li class="b"></li></ng-template> }<svg><path class="c"></path></svg></ul><p class="d"></p>`,
      [
        {
          files: ["**/*.html"],
          languageOptions: { parser: ngParser as any },
          plugins: { probe: { rules: { parents: probe } } as any },
          rules: { "probe/parents": "error" },
        },
      ],
      { filename: TEMPLATE }
    )
    expect(parents).toEqual(["ul", "ul", "svg", ""])
  })

  describe.each(["oxc", "typescript"] as const)(
    "with the component's own styles, read by %s",
    (kind) => {
      let warnings: string[] = []
      beforeEach(() => {
        warnings = []
        resetWarnings()
        setWarningSink((message) => warnings.push(message))
      })
      afterEach(() => setWarningSink((message) => console.warn(message)))

      const unknown = (code: string, file = TEMPLATE) => {
        useParser(kind)
        try {
          return lint(code, RULES, path.join(PROJECT, "src/app", file))
            .filter((m) => m.ruleId === "shadcn/no-unknown-classes")
            .map((m) => m.message.split('"')[1])
        } finally {
          useParser(null)
        }
      }

      it("knows the classes the stylesheet a templateUrl component names declares", () => {
        expect(
          unknown(
            `<div class="card card-header card__body is-open card-title card-footer card-shared badge-success flex-cols card-headr"></div>`,
            "card.component.html"
          )
        ).toEqual(["flex-cols", "card-headr"])
      })

      it("does not take a commented-out selector or a string for a class", () => {
        expect(
          unknown(
            `<div class="card-commented card-blocked card-in-string"></div>`,
            "card.component.html"
          )
        ).toEqual(["card-commented", "card-blocked", "card-in-string"])
      })

      it("reads styleUrls and inline styles, and not another component's", () => {
        expect(
          unknown(
            `<ul class="list-from-css list-inline list-backtick list-own card-header"></ul>`,
            "list.html"
          )
        ).toEqual(["list-own", "card-header"])
      })

      it("stays quiet when the styles are not written out in the decorator", () => {
        expect(
          unknown(
            `<ul class="list-shared list-anything"></ul>`,
            "list-opaque.html"
          )
        ).toEqual([])
      })

      it("reports as before in a template no component names", () => {
        expect(
          unknown(`<div class="card-header"></div>`, "orphan.html")
        ).toEqual(["card-header"])
      })

      describe("when the styles cannot be read", () => {
        it("warns once per component that its template is skipped", () => {
          expect(
            unknown(`<ul class="list-anything"></ul>`, "list-opaque.html")
          ).toEqual([])
          expect(
            unknown(`<ul class="list-other"></ul>`, "list-opaque.html")
          ).toEqual([])
          expect(warnings).toEqual([
            "[@shadcn/lint] The styles of ListOpaque in src/app/list.ts cannot be read: styles holds `shared`, not a string. shadcn/no-unknown-classes is skipped in its template, since any class there may be one they declare.",
          ])
        })

        it("names a stylesheet that does not exist", () => {
          expect(
            unknown(`<div class="missing-anything"></div>`, "missing.html")
          ).toEqual([])
          expect(warnings).toEqual([
            "[@shadcn/lint] The styles of Missing in src/app/missing.ts cannot be read: the stylesheet ./missing.scss does not exist. shadcn/no-unknown-classes is skipped in its template, since any class there may be one they declare.",
          ])
        })

        it("names the selector it cannot read and the file it is in", () => {
          expect(
            unknown(`<div class="tone-red"></div>`, "generated.html")
          ).toEqual([])
          expect(warnings).toEqual([
            "[@shadcn/lint] The styles of Generated in src/app/generated.ts cannot be read: the selector `.#{…}` starts with an interpolation in src/app/generated.scss. shadcn/no-unknown-classes is skipped in its template, since any class there may be one they declare.",
          ])
        })

        it("does not warn when the styles are read", () => {
          unknown(
            `<div class="card-header flex-cols"></div>`,
            "card.component.html"
          )
          unknown(`<div class="card-header"></div>`, "orphan.html")
          expect(warnings).toEqual([])
        })

        it("skips only the inline template whose own decorator cannot be read", () => {
          useParser(kind)
          try {
            const file = path.join(PROJECT, "src/app/inline-pair.ts")
            const messages = lintInline(fs.readFileSync(file, "utf8"), file)
            expect(
              messages
                .filter((m) => m.ruleId === "shadcn/no-unknown-classes")
                .map((m) => m.message.split('"')[1])
            ).toEqual(["pair-unknown"])
            expect(warnings).toEqual([
              "[@shadcn/lint] The styles of InlineSpread in src/app/inline-pair.ts cannot be read: the decorator spreads `...base`. shadcn/no-unknown-classes is skipped in its template, since any class there may be one they declare.",
            ])
          } finally {
            useParser(null)
          }
        })
      })

      it("reads an inline template's styles from its own decorator", () => {
        useParser(kind)
        try {
          const file = path.join(PROJECT, "src/app/list.ts")
          const messages = lintInline(fs.readFileSync(file, "utf8"), file)
          expect(
            messages
              .filter((m) => m.ruleId === "shadcn/no-unknown-classes")
              .map((m) => m.message.split('"')[1])
          ).toEqual(["list-unknown"])
        } finally {
          useParser(null)
        }
      })
    }
  )

  describe("with the project's global styles", () => {
    const FIXTURES = path.dirname(PROJECT)
    let warnings: string[] = []
    beforeEach(() => {
      warnings = []
      resetWarnings()
      setWarningSink((message) => warnings.push(message))
    })
    afterEach(() => setWarningSink((message) => console.warn(message)))

    const unknownIn = (workspace: string, file: string, code: string) => {
      const dir = path.join(FIXTURES, workspace)
      return new Linter({ cwd: dir })
        .verify(
          code,
          [
            {
              files: ["**/*.html"],
              languageOptions: { parser: ngParser as any },
              plugins: { shadcn: plugin as any },
              rules: { "shadcn/no-unknown-classes": "error" },
            },
          ],
          { filename: path.join(dir, file) }
        )
        .map((m) => m.message.split('"')[1])
    }

    it("knows the classes the styles in angular.json declare, through includePaths, packages and load-css", () => {
      expect(
        unknownIn(
          "angular-workspace",
          "src/app/page.component.html",
          `<div class="page-shell page-shell-header from-include fi fi-check pkg-loaded pkg-extra page-own from-component-include page-shel"></div>`
        )
      ).toEqual(["page-shel"])
      expect(warnings).toEqual([])
    })

    it("reads the styles of the project the file is in", () => {
      expect(
        unknownIn(
          "angular-nx",
          "apps/web/src/app/home.html",
          `<div class="web-global admin-global"></div>`
        )
      ).toEqual(["admin-global"])
    })

    it("reads every Angular project's styles for a library that names none", () => {
      expect(
        unknownIn(
          "angular-nx",
          "libs/ui/src/button.html",
          `<div class="web-global admin-global react-global lib-unknown"></div>`
        )
      ).toEqual(["react-global", "lib-unknown"])
    })

    it("warns once and stays quiet in a project whose global styles cannot be read", () => {
      for (const name of ["anything", "else"]) {
        expect(
          unknownIn(
            "angular-workspace",
            "projects/broken/src/broken.html",
            `<div class="${name}"></div>`
          )
        ).toEqual([])
      }
      expect(warnings).toEqual([
        "[@shadcn/lint] The global styles angular.json names cannot be read: the stylesheet projects/broken/missing.scss does not exist. shadcn/no-unknown-classes is skipped in this project, since any class may be one they declare.",
      ])
    })

    it("warns once when Tailwind is imported only from Sass", () => {
      for (const name of ["p-4", "p-5"]) {
        unknownIn(
          "angular-sass-entry",
          "src/app/page.html",
          `<div class="${name}"></div>`
        )
      }
      const where = path.relative(
        process.cwd(),
        path.join(FIXTURES, "angular-sass-entry")
      )
      expect(warnings).toEqual([
        `[@shadcn/lint] src/styles.scss imports Tailwind, but a Sass file is not read as the Tailwind entry and no CSS file under ${where} imports it, so no-unknown-classes reads classes with the grammar bundled with @shadcn/lint, and the project's theme is not read. Set tailwind.css in components.json to a CSS file that imports Tailwind and the same plugins.`,
      ])
    })

    it("warns once when no stylesheet imports Tailwind", () => {
      unknownIn("angular-no-entry", "src/app/page.html", `<div></div>`)
      const where = path.relative(
        process.cwd(),
        path.join(FIXTURES, "angular-no-entry")
      )
      expect(warnings).toEqual([
        `[@shadcn/lint] No stylesheet importing Tailwind was found under ${where}, so no-unknown-classes reads classes with the grammar bundled with @shadcn/lint, and the project's theme is not read. Set tailwind.css in components.json to the stylesheet that imports Tailwind.`,
      ])
    })
  })

  describe("reading a component stylesheet", () => {
    const knows = (
      css: string,
      names: string[],
      file: string | null = null
    ) => {
      const own = ownClassesOfCss(css, file)
      return names.filter((name) => own.has(name))
    }

    it("resolves & against the rule around it", () => {
      expect(
        knows(
          `.a, .b { &-x { } & .c { } .d & { } &:hover, &.e { } :host-context(.dark) & { } }`,
          ["a", "b", "a-x", "b-x", "c", "d", "e", "dark", "x"]
        )
      ).toEqual(["a", "b", "a-x", "b-x", "c", "d", "e", "dark"])
    })

    it("passes the rule through @media, @include and @if blocks", () => {
      expect(
        knows(
          `.a { @media (min-width: 1px) { &-m { } } @include up { &-i { } } @if $x { &-f { } } }`,
          ["a-m", "a-i", "a-f"]
        )
      ).toEqual(["a-m", "a-i", "a-f"])
    })

    it("does not read keyframes, nested properties or values as selectors", () => {
      expect(
        knows(
          `@keyframes spin { from { } 50.5% { } to { } } .a { font: { family: x; } margin: .5rem; background: url(//x.test/a.png); }`,
          ["from", "to", "5rem", "a", "family", "png", "test"]
        )
      ).toEqual(["a"])
    })

    it("settles the prefix an interpolation leaves", () => {
      expect(
        knows(`.btn-#{$size} { } .a { &-#{$tone} { } }`, [
          "btn-sm",
          "a-red",
          "a",
          "bt",
        ])
      ).toEqual(["btn-sm", "a-red", "a"])
    })

    it("settles everything when a selector cannot be read", () => {
      for (const css of [`.#{$name} { }`, `&-x { }`, `@mixin m { &-x { } }`]) {
        expect(knows(css, ["anything"])).toEqual(["anything"])
      }
      expect(knows(`.a\n  &-x\n    gap: 0`, ["anything"], "x.sass")).toEqual([
        "anything",
      ])
      expect(knows(`.a\n  gap: 0`, ["a", "b"], "x.sass")).toEqual(["a"])
    })
  })
})

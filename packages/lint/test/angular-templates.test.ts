import * as fs from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import templatePlugin from "@angular-eslint/eslint-plugin-template"
import * as ngParser from "@angular-eslint/template-parser"
import tsParser from "@typescript-eslint/parser"
import { Linter } from "eslint"
import { describe, expect, it } from "vitest"

import { plugin } from "../src/plugin"
import { ownClassesOfCss } from "../src/project/angular-styles"
import { useParser } from "../src/project/parser"
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

  it("reads a color attribute on an SVG element, not on a component", () => {
    expect(
      found(
        `<svg fill="none" stroke="currentColor"><path fill="#ff0000"></path></svg><mat-icon color="red"></mat-icon>`
      )
    ).toEqual([`shadcn/no-raw-colors: fill="#ff0000" hardcodes a color`])
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

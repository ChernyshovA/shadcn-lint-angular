import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import templatePlugin from "@angular-eslint/eslint-plugin-template"
import * as ngParser from "@angular-eslint/template-parser"
import tsParser from "@typescript-eslint/parser"
import { Linter } from "eslint"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { plugin } from "../src/plugin"
import {
  angularHostClassesOf,
  ownClassesOfCss,
} from "../src/project/angular-styles"
import { resetFsMemo } from "../src/project/fs"
import { useParser } from "../src/project/parser"
import { resetWarnings, setWarningSink } from "../src/project/warn"
import { replaceInLiteral } from "../src/rules/fixes"
import { angularReader } from "../src/sites/readers/angular"
import { angularCompiler } from "../src/sites/readers/angular-compiler"
import { setAngularCompilerForTests } from "./compiler-stub"
import { lintSfc } from "./sfc-helpers"

// vi.mock runs before the imports above, so it imports the stub itself.
vi.mock("../src/sites/readers/angular-compiler", async (importOriginal) =>
  (await import("./compiler-stub")).mockAngularCompiler(importOriginal as any)
)

const PROJECT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures/angular-project"
)
const TEMPLATE = path.join(PROJECT, "src/app/card.component.html")
const FIXTURES_DIR = path.dirname(PROJECT)
// Messages name files with forward slashes on Windows too.
const posix = (file: string) => file.split(path.sep).join("/")

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
    // angular-eslint's inline-template processor moves findings and fixes
    // back into the .ts, but not suggestions.
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

  it("reads no style from a binding that names no property", () => {
    expect(found(`<div [style.]="tone" [style.color]="'red'"></div>`)).toEqual([
      "shadcn/no-inline-styles: Inline style sets color",
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

  // An ICU's cases hold elements the parser keeps only in the i18n
  // message. They are read from the template as any element is, as far
  // as the i18n runtime creates them.
  describe("elements in an ICU", () => {
    const code = [
      `<p>{count, plural,`,
      `  =0 {<span class="flx bg-red-500" style="color: #f00">none</span>}`,
      `  other {<b class="p-[13px] {{ extra }}">{{ count }}</b> {kind, select, svg {<svg><stop stop-color="#00ff00" /></svg>} other {<i class="text-[#123456]">x</i>}}}`,
      `}</p>`,
    ].join("\n")

    it("are read by every rule a static attribute reaches", () => {
      // The same elements outside the ICU, less what the runtime drops:
      // the style attribute and the <svg>.
      const flat = [
        `<p>`,
        `  <span class="flx bg-red-500">none</span>`,
        `  <b class="p-[13px] {{ extra }}">{{ count }}</b> <i class="text-[#123456]">x</i>`,
        `</p>`,
      ].join("\n")
      expect(found(flat)).toHaveLength(4)
      expect(found(code)).toEqual(found(flat))
    })

    // The runtime keeps only the tags and attributes its sanitizer knows
    // (VALID_ELEMENTS, VALID_ATTRS in @angular/core), lowercased as the
    // browser parses them; another element is dropped with all it holds.
    it("are only those the i18n runtime creates, with the attributes it keeps", () => {
      expect(
        found(
          [
            `<p>{n, plural, other {`,
            `<span class="flx" color="#f00" style="color: #f00" fill="#f00" routerLinkActive="p-[1px]" ngClass="p-[2px]" bind-class="p-[3px]" styleClass="p-[4px]">a</span>`,
            `<SPAN CLASS="p-[5px]">b</SPAN>`,
            `<app-x class="p-[6px]"><span class="p-[7px]">c</span></app-x>`,
            `<svg class="p-[8px]"><stop stop-color="#00ff00" /><text class="p-[9px]">d</text></svg>`,
            `<ng-container><i class="p-[10px]">e</i></ng-container>`,
            `<table><tbody><tr><td class="p-[11px]">f</td></tr></tbody></table>`,
            // Outside a <table>, a cell's start tag is dropped, and what it
            // holds is kept.
            `<td class="p-[12px]"><span class="p-[13px]">g</span></td><tr class="p-[14px]"></tr><caption class="p-[15px]"></caption>`,
            `}}</p>`,
          ].join("")
        )
      ).toEqual([
        `shadcn/no-unknown-classes: "flx" is not a class this project's Tailwind knows, so no CSS is generated for it`,
        `shadcn/no-raw-colors: color="#f00" hardcodes a color`,
        `shadcn/no-arbitrary-values: "p-[5px]" hardcodes an off-token value`,
        `shadcn/no-arbitrary-values: "p-[11px]" hardcodes an off-token value`,
        `shadcn/no-arbitrary-values: "p-[13px]" hardcodes an off-token value`,
      ])
    })

    // Where an interpolation ends, as the compiler finds it: at the
    // first `}}` outside a string, or past a `//` comment at the next.
    it("leave out what an interpolation binds, strings in it included", () => {
      const tokens = (value: string) =>
        lint(`<p>{n, plural, other {<b class="${value}">a</b>}}</p>`).map(
          (m) => m.message.split('"')[1]
        )
      expect(tokens(`p-[1px] {{ '}}' }} p-[2px]`)).toEqual([
        "p-[1px]",
        "p-[2px]",
      ])
      expect(tokens(`p-[1px] x{{ a ? '}} {{' : \`}}\` }}y p-[2px]`)).toEqual([
        "p-[1px]",
        "p-[2px]",
      ])
      expect(tokens(`p-[1px] {{ 'it\\'s }}' }} p-[2px]`)).toEqual([
        "p-[1px]",
        "p-[2px]",
      ])
      expect(tokens(`p-[1px] {{ a // '}} p-[2px]`)).toEqual([
        "p-[1px]",
        "p-[2px]",
      ])
      // One that never ends binds nothing: it is text.
      expect(tokens(`p-[1px] {{ '}} p-[2px]`)).toContain("p-[2px]")
      // Offsets count UTF-16 units: what follows a string of emoji is
      // read whole, and rewritten where it is written.
      const value = `{{ '🎉🎉🎉}}' }}x p-[2px]`
      const code = `<p>{n, plural, other {<b class="${value}">a</b>}}</p>`
      const [message] = lint(code)
      expect(message.message).toContain(`"p-[2px]"`)
      const { range, text } = message.suggestions![0].fix
      expect(code.slice(0, range[0]) + text + code.slice(range[1])).toBe(
        code.replace("p-[2px]", "p-0.5")
      )
    })

    it("rewrite a class, not the binding that names it too", () => {
      const applied = (value: string) => {
        const code = `<p>{n, plural, =0 {<span class="${value}">a</span>} other {x}}</p>`
        const message = lint(code).find((m) => m.message.includes(`"flx"`))!
        const fix = message.suggestions?.[0]?.fix
        return fix
          ? code.slice(0, fix.range[0]) + fix.text + code.slice(fix.range[1])
          : null
      }
      expect(applied(`{{ flx }} flx`)).toBe(
        `<p>{n, plural, =0 {<span class="{{ flx }} flex">a</span>} other {x}}</p>`
      )
      expect(applied(`a{{ x }} flx {{ flx }}`)).toBe(
        `<p>{n, plural, =0 {<span class="a{{ x }} flex {{ flx }}">a</span>} other {x}}</p>`
      )
      // An entity moves the value off the source: with a binding blanked
      // too, where the class is written cannot be told.
      expect(applied(`{{ flx }} a&amp;b flx`)).toBeNull()
    })

    // A replacement shorter than the class shares a tail with what
    // precedes it; the rewrite still spans the class alone.
    it("rewrite a class into a shorter one in full", () => {
      const applied = (value: string, token: string) => {
        const code = `<p>{n, plural, =0 {<span class="${value}">a</span>} other {x}}</p>`
        const message = lint(code).find((m) =>
          m.message.includes(`"${token}"`)
        )!
        const fix = message.suggestions![0].fix
        return code.slice(0, fix.range[0]) + fix.text + code.slice(fix.range[1])
      }
      expect(applied(`bg-primaryyy {{ a }} x`, "bg-primaryyy")).toBe(
        `<p>{n, plural, =0 {<span class="bg-primary {{ a }} x">a</span>} other {x}}</p>`
      )
      expect(applied(`flexx {{ a }}`, "flexx")).toBe(
        `<p>{n, plural, =0 {<span class="flex {{ a }}">a</span>} other {x}}</p>`
      )
    })

    it("rewrite only the class, whatever the binding, class and replacement", () => {
      let seed = 0x9e3779b9
      const random = () => {
        seed = (seed + 0x6d2b79f5) | 0
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
      }
      const pick = <T>(list: T[]) => list[Math.floor(random() * list.length)]
      const words = ["p-4", "pp-4", "p-44", "a", "aa", "aXa", "x", "flex"]
      words.push("flexx", "rounded", "roundedd", "bg-primary", "bg-primaryyy")
      // A binding, with what is glued to it, blanked as the reader does.
      const bound = (word: string) =>
        pick([`{{ ${word} }}`, `${pick(words)}{{ ${word} }}`, `{{${word}}}x`])
      let checked = 0
      for (let n = 0; n < 20000; n++) {
        const parts: string[] = []
        const plain: string[] = []
        for (let i = 0, k = 1 + (n % 5); i < k; i++) {
          const word = pick(words)
          const part = random() < 0.3 ? bound(word) : word
          parts.push(part)
          if (part === word) plain.push(word)
        }
        const inner = parts.join(random() < 0.2 ? "  " : " ")
        const value = inner.replace(/\S*\{\{.*?\}\}\S*/g, (m) =>
          " ".repeat(m.length)
        )
        const token = plain.length && random() < 0.9 ? pick(plain) : pick(words)
        const replacement = pick(words)
        const at = value.search(
          new RegExp(`(?<=^|\\s)${token.replace(/[-]/g, "\\-")}(?=\\s|$)`)
        )
        if (token === replacement || at === -1) continue
        const text = replaceInLiteral(
          { type: "AngularLiteral", value, masked: true },
          { sourceCode: { getText: () => `"${inner}"` } },
          token,
          replacement
        )
        const expected =
          inner.slice(0, at) + replacement + inner.slice(at + token.length)
        if (text !== `"${expected}"`) {
          expect({ inner, token, replacement, text }).toEqual({
            inner,
            token,
            replacement,
            text: `"${expected}"`,
          })
        }
        checked++
      }
      expect(checked).toBeGreaterThan(10000)
    })

    it("are placed where they are written, and rewritten there", () => {
      const messages = lint(code)
      const arbitrary = messages.find(
        (m) => m.ruleId === "shadcn/no-arbitrary-values"
      )!
      expect(spanned(code, arbitrary)).toBe(`"p-[13px] {{ extra }}"`)
      const { range, text } = arbitrary.suggestions![0].fix
      expect(code.slice(0, range[0]) + text + code.slice(range[1])).toBe(
        code.replace("p-[13px]", "p-3.25")
      )
    })

    // The i18n runtime creates them as plain elements: no directive
    // matches one.
    it("are no element a contract judges", () => {
      expect(
        lint(
          `{n, plural, other {<button hlmBtn class="bg-red-500">x</button>}}`,
          {
            "shadcn/no-restyle": [
              "error",
              { allow: ["layout"], contracts: [{ pattern: "hlmBtn" }] },
            ],
          }
        )
      ).toEqual([])
    })

    it("are read in an inline template", () => {
      const inline = [
        `import { Component } from "@angular/core"`,
        `@Component({ selector: "x-i", template: \`<p>{n, plural, other {<span class="flx">x</span>}}</p>\` })`,
        `export class InlineComponent {}`,
      ].join("\n")
      const messages = lintInline(
        inline,
        path.join(PROJECT, "src/app/icu-inline.component.ts")
      )
      expect(messages.map((m) => m.message.split('"')[1])).toEqual(["flx"])
      expect(spanned(inline, messages[0])).toBe(`"flx"`)
    })
  })

  describe("bindings", () => {
    const tokens = (code: string, rules: Record<string, unknown> = RULES) =>
      lint(code, rules).map((m) => [m.ruleId, m.message.split('"')[1]])

    it("reads the classes [class], [ngClass], [class.x] and an interpolation write", () => {
      expect(
        tokens(
          `<div [class]="big ? 'p-[13px]' : 'bg-red-500'" [ngClass]="{ 'm-[3px] p-4': on, 'mx-[5px]': off }" [class.text-[#123456]]="on" [attr.class]="'gap-[9px]'" class="pt-[7px] {{ tone }} pb-[7px] x{{ y }}"></div>`
        )
      ).toEqual([
        ["shadcn/no-arbitrary-values", "p-[13px]"],
        ["shadcn/no-raw-colors", "bg-red-500"],
        ["shadcn/no-arbitrary-values", "m-[3px]"],
        ["shadcn/no-arbitrary-values", "mx-[5px]"],
        ["shadcn/no-arbitrary-values", "text-[#123456]"],
        ["shadcn/no-arbitrary-values", "gap-[9px]"],
        ["shadcn/no-arbitrary-values", "pt-[7px]"],
        ["shadcn/no-arbitrary-values", "pb-[7px]"],
      ])
    })

    it("reads arrays, template literals, || and ?? the way JSX does", () => {
      expect(
        tokens(
          `<div [ngClass]="['p-[1px]', on && 'p-[2px]', on ? null : 'p-[3px]']" [class]="\`p-[4px] \${x} p-[5px]\${y}\`" [routerLinkActive]="tone || 'p-[6px]'" [attr.class]="tone ?? 'p-[7px]'"></div>`
        )
      ).toEqual([
        ["shadcn/no-arbitrary-values", "p-[1px]"],
        ["shadcn/no-arbitrary-values", "p-[2px]"],
        ["shadcn/no-arbitrary-values", "p-[3px]"],
        ["shadcn/no-arbitrary-values", "p-[4px]"],
        ["shadcn/no-arbitrary-values", "p-[6px]"],
        ["shadcn/no-arbitrary-values", "p-[7px]"],
      ])
    })

    it("reads the classes bound to a component's *Class input", () => {
      expect(
        tokens(
          [
            `<p-button [styleClass]="'p-[1px]'" [pStyleClass]="'@next'" [enterActiveClass]="on ? 'p-[2px]' : ''"></p-button>`,
            `<mat-select [panelClass]="['p-[3px]', 'm-2']"></mat-select>`,
            `<mat-select [panelClass]="{ 'p-[4px]': on, 'm-2': !on }"></mat-select>`,
            `<p-dialog [contentStyleClass]="cls"></p-dialog>`,
          ].join("\n")
        )
      ).toEqual([
        ["shadcn/no-arbitrary-values", "p-[1px]"],
        ["shadcn/no-arbitrary-values", "p-[2px]"],
        ["shadcn/no-arbitrary-values", "p-[3px]"],
        ["shadcn/no-arbitrary-values", "p-[4px]"],
      ])
    })

    it("judges the style [style], [style.x] and [ngStyle] set", () => {
      expect(
        found(
          `<div [style.color]="tone" [style.width.px]="w" [style.--tone]="'#f00'" [style.--gap]="gap" [ngStyle]="{ margin: m, '--edge': on ? '#fff' : null }" [style]="'padding: 0; --x: 1px'" [attr.style]="'top: 0'"></div>`
        )
      ).toEqual([
        "shadcn/no-inline-styles: Inline style sets color",
        "shadcn/no-inline-styles: Inline style sets width",
        "shadcn/no-inline-styles: Custom property --tone hardcodes a color",
        "shadcn/no-inline-styles: Inline style sets margin",
        "shadcn/no-inline-styles: Custom property --edge hardcodes a color",
        "shadcn/no-inline-styles: Inline style sets padding",
        "shadcn/no-inline-styles: Inline style sets top",
      ])
    })

    it("reads a unit in an [ngStyle] key as NgStyle does, and a [style] key as the property it names", () => {
      const code = `<div [ngStyle]="{ 'width.px': w, 'height.%': on ? h : null, margin: m }" [style.width.px]="w" [style]="{ 'height.px': h }"></div>`
      const said = (allow: string[]) =>
        lint(code, { "shadcn/no-inline-styles": ["error", { allow }] }).map(
          (m) => m.message.split(". ")[0]
        )
      expect(said([])).toEqual([
        "Inline style sets width",
        "Inline style sets height",
        "Inline style sets margin",
        "Inline style sets width",
        "Inline style sets height.px",
      ])
      // `[style]` takes the key whole, a property no browser applies.
      expect(said(["width", "height", "margin"])).toEqual([
        "Inline style sets height.px",
      ])
    })

    it("says a style object it cannot read cannot be checked, and passes an unreadable class value", () => {
      expect(
        found(
          `<div [ngStyle]="styles" [style]="{ ...base }" [class]="classes()" [ngClass]="{ flex: on, gap: off } | keys" class="{{ tone }}"></div>`
        )
      ).toEqual([
        "shadcn/no-inline-styles: Dynamic style object cannot be checked",
        "shadcn/no-inline-styles: Dynamic style object cannot be checked",
      ])
    })

    it("does not read an input or a binding that is not a class or a style", () => {
      expect(
        found(
          `<div [title]="'bg-red-500'" [ngIf]="'bg-red-500'" [attr.aria-label]="'p-[13px]'" (click)="cls = 'bg-red-500'"></div>`
        )
      ).toEqual([])
    })

    it("places each finding on the string, the key or the class name it reads", () => {
      const code = `<p [class]="on ? 'p-[13px]' : 'p-2'" [ngClass]="{ 'm-[3px]': on, flex: off }" [class.gap-[9px]]="on" class="flex {{ x }} pt-[7px]" [style.color]="tone"></p>`
      const messages = lint(code)
      expect(messages.map((m) => spanned(code, m))).toEqual([
        `'p-[13px]'`,
        `'m-[3px]'`,
        `gap-[9px]`,
        ` pt-[7px]`,
        `tone`,
      ])
    })

    it("places a binding on a later line, past non-ASCII text", () => {
      const code = `<p title="Привет 😀"></p>\n<b\n  [class]="'p-[13px]'"></b>`
      const messages = lint(code)
      expect(located(messages)).toEqual([
        ["shadcn/no-arbitrary-values", 3, 12, 3, 22],
      ])
      expect(spanned(code, messages[0])).toBe(`'p-[13px]'`)
    })

    it("rewrites the string or the key, quotes kept, and leaves what it cannot place", () => {
      for (const [before, after] of [
        [
          `<div [class]="'flex p-[13px]'"></div>`,
          `<div [class]="'flex p-3.25'"></div>`,
        ],
        [
          `<div [ngClass]="{ 'p-[13px]': on }"></div>`,
          `<div [ngClass]="{ 'p-3.25': on }"></div>`,
        ],
        [
          `<div [ngClass]='{ "p-[13px]": on }'></div>`,
          `<div [ngClass]='{ "p-3.25": on }'></div>`,
        ],
        [
          `<div [class.p-[13px]]="on"></div>`,
          `<div [class.p-3.25]="on"></div>`,
        ],
      ]) {
        const [message] = lint(before)
        const [suggestion] = message.suggestions ?? []
        const { range, text } = suggestion.fix
        expect(before.slice(0, range[0]) + text + before.slice(range[1])).toBe(
          after
        )
      }
      // An escape moves the class between the source and the value.
      const [escaped] = lint(`<div [class]="'it\\'s p-[13px]'"></div>`)
      expect(escaped.message).toContain(`"p-[13px]"`)
      expect(escaped.suggestions).toBeUndefined()
    })

    it("reads a binding once on an element a structural directive wraps", () => {
      const code = [
        `<li *ngIf="item" [class]="'bg-red-500'" [style.color]="c"></li>`,
        `<ng-template [ngIf]="x"><b [ngClass]="{ 'bg-red-500': on }"></b></ng-template>`,
        `<i *ngFor="let p of ps" [attr.fill]="'#ff0000'"></i>`,
      ].join("\n")
      expect(lint(code).map((m) => [m.ruleId, m.line, m.column])).toEqual([
        ["shadcn/no-raw-colors", 1, 27],
        ["shadcn/no-inline-styles", 1, 56],
        ["shadcn/no-raw-colors", 2, 41],
        ["shadcn/no-raw-colors", 3, 25],
      ])
    })

    it("knows the element a structural directive's binding sits on", () => {
      const names: string[] = []
      const probe = {
        create: () => ({
          BoundAttribute(node: any) {
            const element = angularReader.elementOf(node)
            names.push(
              `${angularReader.attributeName(node)}:${angularReader.nameOf(element)?.text ?? "-"}`
            )
          },
        }),
      }
      new Linter({ cwd: PROJECT }).verify(
        `<li *ngIf="ok" [class]="a"></li><ng-template [ngIf]="ok" [class]="b"></ng-template>`,
        [
          {
            files: ["**/*.html"],
            languageOptions: { parser: ngParser as any },
            plugins: { probe: { rules: { names: probe } } as any },
            rules: { "probe/names": "error" },
          },
        ],
        { filename: TEMPLATE }
      )
      // The probe is no plugin rule, so it meets the copied input twice.
      expect(names).toEqual([
        "ngIf:-",
        "class:li",
        "class:li",
        "ngIf:-",
        "class:-",
      ])
    })

    // A class one slip from one its CSS declares is that one misspelled,
    // not a utility to declare.
    it("suggests the class the component's styles declare that one slip misspells", () => {
      const code = `<div class="card-footr card-heder"></div>`
      const messages = lint(code, { "shadcn/no-unknown-classes": "error" })
      expect(messages.map((m) => m.message)).toEqual([
        `"card-footr" is not a class this project's Tailwind knows or its CSS declares, so no CSS is generated for it. Did you mean "card-footer", which its CSS declares?`,
        `"card-heder" is not a class this project's Tailwind knows or its CSS declares, so no CSS is generated for it. Did you mean "card-header", which its CSS declares?`,
      ])
      const { range, text } = messages[0].suggestions![0].fix
      expect(code.slice(0, range[0]) + text + code.slice(range[1])).toBe(
        code.replace("card-footr", "card-footer")
      )
    })

    it("knows a class the component's stylesheet declares", () => {
      expect(
        tokens(
          `<div [ngClass]="{ 'card-header': on, 'card-heder': off }"></div>`,
          {
            "shadcn/no-unknown-classes": "error",
          }
        )
      ).toEqual([["shadcn/no-unknown-classes", "card-heder"]])
    })

    // The parser decodes entities before it parses a binding, so its
    // offsets count the decoded text, not the file.
    const applied = (code: string, message: Linter.LintMessage) => {
      const fix = message.suggestions?.[0]?.fix
      return fix
        ? code.slice(0, fix.range[0]) + fix.text + code.slice(fix.range[1])
        : null
    }

    const ARBITRARY = { "shadcn/no-arbitrary-values": "error" }

    it("places a binding past entities where the file spells it", () => {
      for (const [code, spans, after] of [
        [
          `<div [class]="c[&quot;&quot;] ? x['p-[13px]']  : 'p-[13px]'"></div>`,
          [`'p-[13px]'`],
          `<div [class]="c[&quot;&quot;] ? x['p-[13px]']  : 'p-3.25'"></div>`,
        ],
        [
          `<div [class]="n &gt; 3 ? 'p-[13px]' : 'm-[3px]'"></div>`,
          [`'p-[13px]'`, `'m-[3px]'`],
          `<div [class]="n &gt; 3 ? 'p-3.25' : 'm-[3px]'"></div>`,
        ],
        [
          `<div [ngClass]="{ 'p-[13px]': n &gt; 3, 'm-[3px]': a &amp;&amp; b }"></div>`,
          [`'p-[13px]'`, `'m-[3px]'`],
          `<div [ngClass]="{ 'p-3.25': n &gt; 3, 'm-[3px]': a &amp;&amp; b }"></div>`,
        ],
        [
          `<div\r\n  [class]="c\r\n    ? x['p-[13px]']\r\n    : 'p-[13px]'"></div>`,
          [`'p-[13px]'`],
          `<div\r\n  [class]="c\r\n    ? x['p-[13px]']\r\n    : 'p-3.25'"></div>`,
        ],
      ] as const) {
        const messages = lint(code)
        expect(messages.map((m) => spanned(code, m))).toEqual(spans)
        expect(applied(code, messages[0])).toBe(after)
      }
    })

    it("places the text around an interpolation past entities, and an expression on its braces without a suggestion", () => {
      const code = `<div class="a&amp;b {{ x }} p-[13px] {{ on ? 'm-[3px]' : '' }} f&lt;x"></div>`
      const messages = lint(code, ARBITRARY)
      expect(messages.map((m) => spanned(code, m))).toEqual([
        ` p-[13px] `,
        `{{ on ? 'm-[3px]' : '' }}`,
      ])
      expect(messages.map((m) => m.suggestions)).toEqual([undefined, undefined])
      const crlf = `<div class="a&amp;b\r\n  {{ x }} p-[13px]\r\n  f&lt;x"></div>`
      expect(lint(crlf, ARBITRARY).map((m) => spanned(crlf, m))).toEqual([
        ` p-[13px]\r\n  f&lt;x`,
      ])
    })

    it("finds the braces the parser does, past a quote an entity spells", () => {
      // Decoded, the quotes hold the `}}`; in the file they do not.
      const code = `<div class="x {{ on ? &apos;}}&apos; : 'p-[13px]' }}"></div>`
      const messages = lint(code, ARBITRARY)
      expect(messages.map((m) => spanned(code, m))).toEqual([
        `{{ on ? &apos;}}&apos; : 'p-[13px]' }}`,
      ])
      expect(messages[0].suggestions).toBeUndefined()
    })

    it("reports a binding in an inline template where it is written, without a suggestion", () => {
      const code = [
        `import { Component } from "@angular/core"`,
        "@Component({",
        `  selector: "app-card",`,
        "  template: `<div [ngClass]=\"{ 'p-[13px]': on, 'btn-${size}': on }\" [class]=\"'m-[3px] p-${pad}'\"></div>`,",
        "})",
        "export class CardComponent {}",
      ].join("\n")
      const messages = lintInline(
        code,
        path.join(PROJECT, "src/app/card.component.ts")
      )
      expect(messages.map((m) => spanned(code, m))).toEqual([
        `'p-[13px]'`,
        `'m-[3px] p-\${pad}'`,
      ])
      expect(messages.map((m) => m.suggestions)).toEqual([undefined, undefined])
    })
  })

  describe("host bindings", () => {
    const COMPONENT = path.join(PROJECT, "src/app/host.component.ts")

    // A component file linted on its own, with the plugin on .ts files.
    const lintTs = (
      code: string,
      filename = COMPONENT,
      rules: Record<string, unknown> = RULES
    ) =>
      new Linter({ cwd: PROJECT }).verify(
        code,
        [
          {
            files: ["**/*.ts"],
            languageOptions: { parser: tsParser as any },
            plugins: { shadcn: plugin as any },
            rules: rules as any,
          },
        ],
        { filename }
      )

    const component = (host: string[], decorator = "Component") =>
      [
        `import { ${decorator} } from "@angular/core"`,
        `@${decorator}({`,
        `  selector: "app-host",`,
        "  host: {",
        ...host.map((line) => `    ${line},`),
        "  },",
        "})",
        "export class HostComponent {}",
      ].join("\n")

    it("reads static class and style, and class and style bindings", () => {
      const code = component([
        `class: "flex p-[13px] bg-red-500"`,
        `style: "color: red; --tone: #fff"`,
        `"[class]": "big ? 'm-[3px]' : { 'mx-[5px]': on }"`,
        `"[class.gap-[9px]]": "on"`,
        `"[style.width.px]": "w"`,
        `"[style]": "{ margin: m, '--edge': '#000' }"`,
        `"[attr.class]": \`on && 'pt-[7px]'\``,
      ])
      expect(
        lintTs(code).map((m) => `${m.ruleId}: ${spanned(code, m)}`)
      ).toEqual([
        `shadcn/no-raw-colors: "flex p-[13px] bg-red-500"`,
        `shadcn/no-arbitrary-values: "flex p-[13px] bg-red-500"`,
        `shadcn/no-inline-styles: "color: red; --tone: #fff"`,
        `shadcn/no-inline-styles: "color: red; --tone: #fff"`,
        `shadcn/no-arbitrary-values: 'm-[3px]'`,
        `shadcn/no-arbitrary-values: 'mx-[5px]'`,
        `shadcn/no-arbitrary-values: gap-[9px]`,
        `shadcn/no-inline-styles: w`,
        `shadcn/no-inline-styles: m`,
        `shadcn/no-inline-styles: '#000'`,
        `shadcn/no-arbitrary-values: 'pt-[7px]'`,
      ])
    })

    it("rewrites the class where the .ts spells it", () => {
      for (const [before, after] of [
        [`class: "flex p-[13px]"`, `class: "flex p-3.25"`],
        [
          `"[class]": "on ? 'p-[13px]' : ''"`,
          `"[class]": "on ? 'p-3.25' : ''"`,
        ],
        [`"[class.p-[13px]]": "on"`, `"[class.p-3.25]": "on"`],
        [
          `"[class]": "on ? \\"p-[13px]\\" : ''"`,
          `"[class]": "on ? \\"p-[13px]\\" : ''"`,
        ],
      ]) {
        const code = component([before])
        const [message] = lintTs(code)
        expect(message.message).toContain(`"p-[13px]"`)
        const fix = message.suggestions?.[0]?.fix
        const fixed = fix
          ? code.slice(0, fix.range[0]) + fix.text + code.slice(fix.range[1])
          : code
        expect(fixed).toBe(component([after]))
      }
    })

    it("places a class past escapes and line continuations in the string", () => {
      const code = component([
        `"[class]": "on \\\n ? '\\u0070x-[13px]' : \\"flex\\" || 'm-[3px]'"`,
      ])
      const messages = lintTs(code)
      expect(messages.map((m) => spanned(code, m))).toEqual([
        `'\\u0070x-[13px]'`,
        `'m-[3px]'`,
      ])
      expect(messages[0].message).toContain(`"px-[13px]"`)
    })

    it("places a class in a template literal written over CRLF lines", () => {
      // The literal's text keeps each CRLF; the string it spells has LF.
      const code = component([
        "\"[class]\": `on\n      ? x['p-[13px]']\n      : 'p-[13px]'`",
      ]).replace(/\n/g, "\r\n")
      const messages = lintTs(code)
      expect(messages.map((m) => spanned(code, m))).toEqual([`'p-[13px]'`])
      const fix = messages[0].suggestions![0].fix
      expect(
        code.slice(0, fix.range[0]) + fix.text + code.slice(fix.range[1])
      ).toBe(code.replace(`: 'p-[13px]'`, `: 'p-3.25'`))
    })

    it("reports a host binding once when every string is scanned", () => {
      const code = component([
        `class: "bg-red-500 p-[13px]"`,
        `"[class]": "on ? 'bg-red-500 p-[14px]' : ''"`,
        `"[class.bg-blue-500]": "on"`,
      ])
      const messages = lintTs(code, COMPONENT, {
        "shadcn/no-raw-colors": ["error", { scanAllStrings: true }],
        "shadcn/no-arbitrary-values": ["error", { scanAllStrings: true }],
      })
      expect(
        messages.map((m) => `${m.message.split('"')[1]} ${spanned(code, m)}`)
      ).toEqual([
        `bg-red-500 "bg-red-500 p-[13px]"`,
        `p-[13px] "bg-red-500 p-[13px]"`,
        `bg-red-500 'bg-red-500 p-[14px]'`,
        `p-[14px] 'bg-red-500 p-[14px]'`,
        `bg-blue-500 bg-blue-500`,
      ])
    })

    it("reads what spartan's classes() helper returns, named in mergeFunctions", () => {
      const code = [
        `import { Directive } from "@angular/core"`,
        `import { classes, hlm } from "@spartan-ng/helm/utils"`,
        `@Directive({ selector: "[hlmBadge]" })`,
        "export class HlmBadge {",
        `  constructor() { classes(() => "inline-flex p-[13px]") }`,
        `  readonly x = classes(() => { return hlm("m-[3px]", this.y) })`,
        "}",
      ].join("\n")
      const messages = new Linter({ cwd: PROJECT }).verify(
        code,
        [
          {
            files: ["**/*.ts"],
            languageOptions: { parser: tsParser as any },
            plugins: { shadcn: plugin as any },
            settings: { shadcn: { mergeFunctions: ["hlm", "classes"] } },
            rules: { "shadcn/no-arbitrary-values": "error" },
          },
        ],
        { filename: COMPONENT }
      )
      expect(messages.map((m) => spanned(code, m))).toEqual([
        `"inline-flex p-[13px]"`,
        `"m-[3px]"`,
      ])
    })

    // What `host` holds that is not written out may bind any class.
    describe("a host that cannot be read", () => {
      let warnings: string[] = []
      beforeEach(() => {
        warnings = []
        resetWarnings()
        setWarningSink((message) => warnings.push(message))
      })
      afterEach(() => setWarningSink((message) => console.warn(message)))

      const where = posix(path.relative(process.cwd(), COMPONENT))
      const warned = (reason: string) =>
        `[shadcn-lint-angular] The host of HostComponent in ${where} cannot be read: ${reason}. The classes and styles it binds there are not checked.`

      it("says so once for a host that is not an object written out", () => {
        const code = [
          `import { Component } from "@angular/core"`,
          `const HOST = { "[class]": "'p-[13px]'" }`,
          `@Component({ selector: "app-host", host: HOST })`,
          "export class HostComponent {}",
        ].join("\n")
        lintTs(code)
        expect(warnings).toEqual([warned("host is `HOST`, not an object")])
      })

      it("says so for a spread, a computed key, or a binding that is no string", () => {
        for (const [line, reason] of [
          ["...BASE", "it spreads `...BASE`"],
          ["[KEY]: 'p-4'", "a key is computed"],
          [
            "\"[class]\": `on ? ${A} : 'p-2'`",
            "`[class]` holds an expression, not a string",
          ],
          [
            '"[style.color]": TONE',
            "`[style.color]` holds `TONE`, not a string",
          ],
        ]) {
          warnings = []
          resetWarnings()
          lintTs(component([`class: "p-[13px]"`, line]))
          expect(warnings).toEqual([warned(reason)])
        }
      })

      it("says nothing of a host it reads", () => {
        lintTs(
          component([
            `class: "p-4"`,
            `"[class]": "on ? 'p-4' : 'p-2'"`,
            `"[class.p-4]": ON`,
            `"[style.color]": \`tone\``,
            `"(click)": HANDLER`,
            `"[attr.title]": TITLE`,
          ])
        )
        expect(warnings).toEqual([])
      })
    })

    describe("with another compiler", () => {
      let warnings: string[] = []
      beforeEach(() => {
        warnings = []
        resetWarnings()
        setWarningSink((message) => warnings.push(message))
      })
      afterEach(() => {
        setAngularCompilerForTests(undefined)
        setWarningSink((message) => console.warn(message))
      })

      it("reads a key's class and style without the compiler, and says once that values are not checked", () => {
        setAngularCompilerForTests(null)
        const code = component([
          `"[class.p-[13px]]": "on"`,
          `"[style.color]": "tone"`,
          `"[class]": "'m-[3px]'"`,
          `"[style]": "{ margin: m }"`,
        ])
        expect(
          lintTs(code).map((m) => `${m.ruleId}: ${spanned(code, m)}`)
        ).toEqual([
          "shadcn/no-arbitrary-values: p-[13px]",
          `shadcn/no-inline-styles: "tone"`,
        ])
        expect(warnings).toEqual([
          "[shadcn-lint-angular] Host binding values such as `[class]` and `[style.color]` in @Component and @Directive are read with @angular-eslint/bundled-angular-compiler, which angular-eslint installs. It could not be loaded, so they are not checked; the class or style property a key names, as in `[class.active]`, still is. Install angular-eslint.",
        ])
      })

      it("reports on the whole object, without a suggestion, when the compiler does not place keys", () => {
        // Compilers before 21 give a LiteralMap's keys no span.
        const current = angularCompiler(COMPONENT)
        const unplaced = (node: any): void => {
          if (!node || typeof node !== "object") return
          if (Array.isArray(node.keys)) {
            node.keys = node.keys.map(
              ({ kind: _kind, span: _span, sourceSpan: _at, ...key }: any) =>
                key
            )
          }
          for (const value of Object.values(node)) unplaced(value)
        }
        setAngularCompilerForTests({
          ...current,
          makeBindingParser: () => {
            const parser = current.makeBindingParser()
            return {
              createBoundHostProperties(properties: any, span: any) {
                const out = parser.createBoundHostProperties(properties, span)
                for (const property of out ?? []) unplaced(property.expression)
                return out
              },
            }
          },
        })
        const code = component([`"[class]": "{ 'p-[13px]': on, flex: off }"`])
        const messages = lintTs(code)
        expect(messages.map((m) => spanned(code, m))).toEqual([
          `{ 'p-[13px]': on, flex: off }`,
        ])
        expect(messages[0].suggestions).toBeUndefined()
      })

      it("takes the compiler of the linted file's project", () => {
        const own = path.join(FIXTURES_DIR, "angular-own-compiler/src/x.ts")
        expect(angularCompiler(own)?.own).toBe(true)
        expect(angularCompiler(COMPONENT)?.own).toBeUndefined()
      })
    })

    it("follows a constant the compiler evaluates, and reads a directive's host", () => {
      const code = [
        `import { Directive } from "@angular/core"`,
        `const base = "p-[2px]"`,
        `@Directive({ selector: "[appX]", host: { class: base } })`,
        "export class X {}",
      ].join("\n")
      expect(lintTs(code).map((m) => spanned(code, m))).toEqual([`"p-[2px]"`])
    })

    it("reads only the host of a component or a directive", () => {
      const code = [
        `import { Component, Injectable } from "@angular/core"`,
        `@Injectable({ host: { class: "p-[1px]" } } as any)`,
        "export class S {}",
        `const config = { host: { class: "p-[2px]" } }`,
        `@Component({ selector: "x", host: { role: "p-[3px]", "(click)": "c = 'p-[4px]'", "[title]": "'p-[5px]'", "[ngClass]": "'p-[6px]'", ["class"]: "p-[7px]" } })`,
        "export class X {}",
      ].join("\n")
      expect(lintTs(code)).toEqual([])
    })

    it("says a host style object it cannot read cannot be checked", () => {
      expect(
        lintTs(
          component([`"[style]": "styles()"`, `"[class]": "classes()"`])
        ).map((m) => m.message.split(".")[0])
      ).toEqual(["Dynamic style object cannot be checked"])
    })

    it("knows the classes the component's own styles select", () => {
      const file = path.join(PROJECT, "src/app/badge.component.ts")
      expect(
        lintTs(fs.readFileSync(file, "utf8"), file, {
          "shadcn/no-unknown-classes": "error",
        }).map((m) => m.message.split('"')[1])
      ).toEqual(["badge-actve"])
    })

    it("says a host class a parent's stylesheet styles goes in allow", () => {
      const code = component([`class: "connections flxe"`])
      expect(
        lintTs(code, COMPONENT, { "shadcn/no-unknown-classes": "error" }).map(
          (m) => m.message
        )
      ).toEqual([
        `"connections" is not a class this project's Tailwind knows, so no CSS is generated for it. Fix the spelling, or declare it with @utility in src/styles.css. If the stylesheet of a component that renders this host styles it, add it to allow.`,
        `"flxe" is not a class this project's Tailwind knows, so no CSS is generated for it. Did you mean "flex"? If the stylesheet of a component that renders this host styles it, add it to allow.`,
      ])
      // A template's class keeps the message every other site has.
      const [template] = lint(`<div class="connections"></div>`, {
        "shadcn/no-unknown-classes": "error",
      })
      expect(template.message).toBe(
        `"connections" is not a class this project's Tailwind knows, so no CSS is generated for it. Fix the spelling, or declare it with @utility in src/styles.css.`
      )
    })

    it("reports a host binding once beside the inline template the processor hands over", () => {
      const code = [
        `import { Component } from "@angular/core"`,
        "@Component({",
        `  selector: "app-card",`,
        '  template: `<div class="p-[1px]"></div>`,',
        `  host: { class: "p-[2px]" },`,
        "})",
        "export class CardComponent {}",
      ].join("\n")
      const messages = new Linter({ cwd: PROJECT }).verify(
        code,
        [
          {
            files: ["**/*.ts"],
            languageOptions: { parser: tsParser as any },
            processor: templatePlugin.processors["extract-inline-html"] as any,
            plugins: { shadcn: plugin as any },
            rules: RULES as any,
          },
          {
            files: ["**/*.html"],
            languageOptions: { parser: ngParser as any },
            plugins: { shadcn: plugin as any },
            rules: RULES as any,
          },
        ],
        { filename: COMPONENT, filterCodeBlock: () => true }
      )
      // The processor puts the .ts's own findings first.
      expect(messages.map((m) => spanned(code, m))).toEqual([
        `"p-[2px]"`,
        `"p-[1px]"`,
      ])
      // The host is in the .ts itself, so its suggestion lands there.
      expect(messages.map((m) => m.suggestions?.length ?? 0)).toEqual([1, 0])
    })
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

      it("reads a <style> in the template, as Angular's compiler does", () => {
        const file = path.join(PROJECT, "src/app/welcome.component.html")
        expect(
          unknown(fs.readFileSync(file, "utf8"), "welcome.component.html")
        ).toEqual(["pill-x", "ghost"])
        const host = angularHostClassesOf(
          path.join(PROJECT, "src/app/welcome.component.ts"),
          "WelcomeComponent"
        )
        expect(["compact", "main"].filter((name) => host?.has(name))).toEqual([
          "compact",
        ])
      })

      it("reads a <style> in an inline template", () => {
        const file = path.join(PROJECT, "src/app/inline-style.ts")
        expect(
          lintInline(fs.readFileSync(file, "utf8"), file)
            .filter((m) => m.ruleId === "shadcn/no-unknown-classes")
            .map((m) => m.message.split('"')[1])
        ).toEqual(["inline-not"])
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
            "[shadcn-lint-angular] The styles of ListOpaque in src/app/list.ts cannot be read: styles holds `shared`, not a string. shadcn/no-unknown-classes is skipped in its template and in the classes of its element in others, since any class there may be one they declare.",
          ])
        })

        it("names a stylesheet that does not exist", () => {
          expect(
            unknown(`<div class="missing-anything"></div>`, "missing.html")
          ).toEqual([])
          expect(warnings).toEqual([
            "[shadcn-lint-angular] The styles of Missing in src/app/missing.ts cannot be read: the stylesheet ./missing.scss does not exist. shadcn/no-unknown-classes is skipped in its template and in the classes of its element in others, since any class there may be one they declare.",
          ])
        })

        it("names the selector it cannot read and the file it is in", () => {
          expect(
            unknown(`<div class="tone-red"></div>`, "generated.html")
          ).toEqual([])
          expect(warnings).toEqual([
            "[shadcn-lint-angular] The styles of Generated in src/app/generated.ts cannot be read: the selector `.#{…}` starts with an interpolation in src/app/generated.scss. shadcn/no-unknown-classes is skipped in its template and in the classes of its element in others, since any class there may be one they declare.",
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
              "[shadcn-lint-angular] The styles of InlineSpread in src/app/inline-pair.ts cannot be read: the decorator spreads `...base`. shadcn/no-unknown-classes is skipped in its template and in the classes of its element in others, since any class there may be one they declare.",
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

      it("numbers inline templates the way angular-eslint's processor does", () => {
        useParser(kind)
        try {
          const file = path.join(PROJECT, "src/app/inline-numbering.ts")
          const messages = lintInline(fs.readFileSync(file, "utf8"), file)
          expect(
            messages
              .filter((m) => m.ruleId === "shadcn/no-unknown-classes")
              .map((m) => m.message.split('"')[1])
          ).toEqual(["nested-unknown", "last-unknown"])
        } finally {
          useParser(null)
        }
      })

      // `:host(.x)` in a component's styles compiles to `.x[_nghost-…]`:
      // it styles the component's element where another template uses
      // it. The component is found among what the template's component
      // imports, by its selector.
      describe("on the element of a component the template uses", () => {
        const PARENT = "host/parent.component.html"

        it("knows the classes its styles select on :host", () => {
          expect(
            unknown(
              `<app-form-row class="row-align-end row-fill row-align-start row-dense row-nested theme-dark row-dark row-wide row-cell row-inner row-typo"></app-form-row>`,
              PARENT
            )
          ).toEqual(["row-cell", "row-inner", "row-typo"])
        })

        it("in the bindings that put classes on the element", () => {
          expect(
            unknown(
              `<app-form-row [class.row-fill]="on" [ngClass]="{ 'row-dense': on }" [class]="on ? 'row-wide' : 'row-typo'"></app-form-row>`,
              PARENT
            )
          ).toEqual(["row-typo"])
        })

        it("not on another element, nor in an input that hands its classes on", () => {
          expect(
            unknown(
              `<div class="row-align-end"></div><app-form-row panelClass="row-fill"></app-form-row>`,
              PARENT
            )
          ).toEqual(["row-align-end", "row-fill"])
        })

        it("settles every class on the element when its styles cannot be read, and says so", () => {
          expect(
            unknown(
              `<app-opaque class="opaque-x opaque-y"></app-opaque><div class="opaque-y"></div>`,
              PARENT
            )
          ).toEqual(["opaque-y"])
          expect(warnings).toEqual([
            "[shadcn-lint-angular] The styles of OpaqueComponent in src/app/host/opaque.component.ts cannot be read: styles holds `shared`, not a string. shadcn/no-unknown-classes is skipped in its template and in the classes of its element in others, since any class there may be one they declare.",
          ])
        })

        it("reports as before without the compiler", () => {
          setAngularCompilerForTests(null)
          try {
            expect(
              unknown(
                `<app-form-row class="row-align-end"></app-form-row>`,
                PARENT
              )
            ).toEqual(["row-align-end"])
          } finally {
            setAngularCompilerForTests(undefined)
          }
        })
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

    // A package's stylesheet, an icon font's, names hundreds of classes a
    // word is a slip from; only the project's own are suggested.
    it("suggests a class the project's global stylesheets write, not a package's", () => {
      const dir = path.join(FIXTURES, "angular-workspace")
      const messages = new Linter({ cwd: dir })
        .verify(
          `<div class="page-shel fi-chek"></div>`,
          [
            {
              files: ["**/*.html"],
              languageOptions: { parser: ngParser as any },
              plugins: { shadcn: plugin as any },
              rules: { "shadcn/no-unknown-classes": "error" },
            },
          ],
          { filename: path.join(dir, "src/app/page.component.html") }
        )
        .map((m) => m.message)
      expect(messages).toEqual([
        expect.stringContaining(
          `Did you mean "page-shell", which its CSS declares?`
        ),
        expect.not.stringContaining("Did you mean"),
      ])
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
        "[shadcn-lint-angular] The global styles angular.json names cannot be read: the stylesheet projects/broken/missing.scss does not exist. shadcn/no-unknown-classes is skipped in this project, since any class may be one they declare.",
      ])
    })

    // A workspace file is the user's to get wrong: linting goes on past it.
    it("skips the fields of a workspace config it cannot read, and says so once", () => {
      const lintIn = (dir: string, file: string) =>
        new Linter({ cwd: dir })
          .verify(
            `<div class="good-global zz-unknown"></div>`,
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
      const workspace = (config: string) => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shadcn-ng-config-"))
        fs.mkdirSync(path.join(dir, "src/app"), { recursive: true })
        fs.writeFileSync(path.join(dir, "src/global.css"), ".good-global {}")
        fs.writeFileSync(path.join(dir, "angular.json"), config)
        return dir
      }
      const good = {
        root: "",
        architect: {
          build: {
            options: {
              styles: ["src/global.css", 7, { input: 8 }],
              stylePreprocessorOptions: { includePaths: [9] },
            },
          },
        },
      }
      const fields = workspace(
        JSON.stringify({
          projects: {
            bad: { root: 5, architect: { build: { options: { styles: 6 } } } },
            odd: { root: "odd", architect: "build" },
            list: {
              root: "list",
              architect: { build: { options: { styles: "x.css" } } },
            },
            nil: null,
            good,
          },
        })
      )
      // A config that cannot be read at all is no workspace.
      const broken = workspace(`{ "projects": `)
      // In an Nx workspace, a project.json that cannot be read.
      const nx = fs.mkdtempSync(path.join(os.tmpdir(), "shadcn-ng-nx-"))
      fs.writeFileSync(path.join(nx, "nx.json"), "{}")
      fs.mkdirSync(path.join(nx, "apps/a/src"), { recursive: true })
      fs.mkdirSync(path.join(nx, "apps/b/src"), { recursive: true })
      fs.writeFileSync(path.join(nx, "apps/a/project.json"), "[]")
      fs.writeFileSync(
        path.join(nx, "apps/b/src/global.css"),
        ".good-global {}"
      )
      fs.writeFileSync(
        path.join(nx, "apps/b/project.json"),
        JSON.stringify({
          targets: {
            build: {
              executor: "@nx/angular:application",
              options: { styles: ["apps/b/src/global.css"] },
            },
            test: { executor: 5 },
          },
        })
      )
      try {
        expect(lintIn(nx, "apps/b/src/page.html")).toEqual(["zz-unknown"])
        expect(lintIn(nx, "apps/a/src/page.html")).toEqual(["zz-unknown"])
        expect(lintIn(fields, "src/app/page.html")).toEqual(["zz-unknown"])
        expect(lintIn(fields, "src/app/other.html")).toEqual(["zz-unknown"])
        expect(lintIn(broken, "src/app/page.html")).toEqual([
          "good-global",
          "zz-unknown",
        ])
        expect(
          warnings.filter(
            (w) => w.includes("nx.json") || w.includes("project.json")
          )
        ).toEqual([
          `[shadcn-lint-angular] ${posix(path.join(nx, "nx.json"))} has fields that are not read, since they are not what Angular takes there: apps/a/project.json (not a JSON object).`,
        ])
        expect(warnings.filter((w) => w.includes("angular.json"))).toEqual([
          `[shadcn-lint-angular] ${posix(path.join(fields, "angular.json"))} has fields that are not read, since they are not what Angular takes there: projects.bad.root (not a string), projects.odd.architect (not an object), projects.list.architect.build.options.styles (not a list), projects.nil (not an object), projects.good.architect.build.options.styles[1] (not a path or { input }), projects.good.architect.build.options.styles[2] (not a path or { input }), projects.good.architect.build.options.stylePreprocessorOptions.includePaths[0] (not a string).`,
          `[shadcn-lint-angular] ${posix(path.join(broken, "angular.json"))} cannot be read: it is not a JSON object. The global styles it names are not read.`,
        ])
      } finally {
        for (const dir of [fields, broken, nx])
          fs.rmSync(dir, { recursive: true, force: true })
      }
    })

    // What Angular builds a project with is what its templates see.
    describe("the global styles of a workspace", () => {
      let dir = ""
      beforeEach(() => {
        dir = fs.realpathSync.native(
          fs.mkdtempSync(path.join(os.tmpdir(), "shadcn-ng-global-"))
        )
      })
      afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))
      const write = (files: Record<string, string>) => {
        for (const [file, text] of Object.entries(files)) {
          fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true })
          fs.writeFileSync(path.join(dir, file), text)
        }
      }
      const unknown = (file: string, classes: string) =>
        new Linter({ cwd: dir })
          .verify(
            `<div class="${classes}"></div>`,
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
      const angularJson = (architect: object) =>
        JSON.stringify({ projects: { app: { root: "", architect } } })

      // `"styles": ["tailwindcss"]`, `["kit"]`: a package's stylesheet, as
      // Angular's stylesheet bundler resolves one, never its JavaScript.
      it("reads a package a style names as a stylesheet", () => {
        write({
          "angular.json": angularJson({
            build: {
              builder: "@angular/build:application",
              options: { styles: ["kit", "twlike"] },
            },
          }),
          "node_modules/kit/package.json": JSON.stringify({
            name: "kit",
            main: "index.js",
            style: "dist/kit.css",
          }),
          "node_modules/kit/index.js": "value.length; [].map(f).filter(g)",
          "node_modules/kit/dist/kit.css": ".kit-css { }",
          "node_modules/twlike/package.json": JSON.stringify({
            name: "twlike",
            exports: {
              ".": { style: "./index.css", import: "./lib.mjs" },
            },
          }),
          "node_modules/twlike/lib.mjs": "export const value = x.length",
          "node_modules/twlike/index.css": ".tw-css { }",
        })
        expect(
          unknown("src/app/page.html", "kit-css tw-css length map value zz")
        ).toEqual(["length", "map", "value", "zz"])
      })

      it("reads the styles of the targets that build, not those of tests", () => {
        write({
          "angular.json": angularJson({
            build: {
              builder: "@angular/build:application",
              options: { styles: ["src/global.css"] },
            },
            test: { options: { styles: ["src/test.scss"] } },
            spec: {
              builder: "@angular/build:karma",
              options: { styles: ["src/test.scss"] },
            },
          }),
          "src/global.css": ".good-global { }",
          "src/test.scss": `@import "~unresolved"; .test-only { }`,
        })
        warnings.length = 0
        expect(unknown("src/app/page.html", "good-global test-only")).toEqual([
          "test-only",
        ])
        expect(warnings).toEqual([])
      })

      it("reads each project's styles as its own", () => {
        const app = (name: string) => ({
          [`apps/${name}/project.json`]: JSON.stringify({
            targets: {
              build: {
                executor: "@nx/angular:application",
                options: { styles: ["libs/shared/missing.css"] },
              },
            },
          }),
        })
        write({ "nx.json": "{}", ...app("a"), ...app("b") })
        warnings.length = 0
        expect(unknown("apps/a/src/page.html", "zz")).toEqual([])
        expect(unknown("apps/b/src/page.html", "zz")).toEqual([])
        expect(warnings).toEqual(
          ["a", "b"].map(
            (name) =>
              `[shadcn-lint-angular] The global styles apps/${name}/project.json names cannot be read: the stylesheet libs/shared/missing.css does not exist. shadcn/no-unknown-classes is skipped in this project, since any class may be one they declare.`
          )
        )
      })

      // Worded as for settings.shadcn.entryPoint.
      it.each([
        ["", `an empty path names no stylesheet`],
        ["src/app", `src/app is a directory, not a stylesheet`],
        ["src/missing.css", `the stylesheet src/missing.css does not exist`],
      ])("names what the style %j is", (style, reason) => {
        write({
          "angular.json": angularJson({
            build: {
              builder: "@angular/build:application",
              options: { styles: [style] },
            },
          }),
          "src/app/page.html": "",
        })
        warnings.length = 0
        expect(unknown("src/app/page.html", "zz")).toEqual([])
        expect(warnings.filter((w) => w.includes("global styles"))).toEqual([
          `[shadcn-lint-angular] The global styles angular.json names cannot be read: ${reason}. shadcn/no-unknown-classes is skipped in this project, since any class may be one they declare.`,
        ])
      })

      it("names a component's stylesheet that is a directory", () => {
        write({
          "src/app/page.component.ts": [
            `import { Component } from "@angular/core"`,
            `@Component({ selector: "app-page", templateUrl: "./page.component.html", styleUrls: ["./styles", ""] })`,
            `export class PageComponent {}`,
          ].join("\n"),
          "src/app/styles/a.css": ".a { }",
          "src/app/page.component.html": "",
        })
        warnings.length = 0
        expect(unknown("src/app/page.component.html", "zz")).toEqual([])
        expect(warnings.filter((w) => w.includes("The styles of"))).toEqual([
          "[shadcn-lint-angular] The styles of PageComponent in src/app/page.component.ts cannot be read: ./styles is a directory, not a stylesheet. shadcn/no-unknown-classes is skipped in its template and in the classes of its element in others, since any class there may be one they declare.",
        ])
      })

      it("reads a workspace config that starts with a byte order mark", () => {
        write({
          "angular.json":
            "﻿" +
            angularJson({
              build: {
                builder: "@angular/build:application",
                options: { styles: ["src/global.css"] },
              },
            }),
          "src/global.css": ".good-global { }",
        })
        warnings.length = 0
        expect(unknown("src/app/page.html", "good-global zz")).toEqual(["zz"])
        expect(warnings).toEqual([])
      })

      it("says when a project lies past where an Nx workspace is scanned", () => {
        const project = JSON.stringify({
          targets: {
            build: {
              executor: "@nx/angular:application",
              options: { styles: ["global.css"] },
            },
          },
        })
        write({
          "nx.json": "{}",
          "global.css": ".good-global { }",
          "libs/a/b/c/d/e/f/project.json": project,
        })
        warnings.length = 0
        unknown("libs/a/b/c/d/e/f/src/page.html", "zz")
        unknown("libs/a/b/c/d/e/f/src/other.html", "zz")
        expect(warnings).toEqual([
          `[shadcn-lint-angular] ${posix(path.join(dir, "libs/a/b/c/d/e/f/project.json"))} is more than 5 directories below ${posix(path.join(dir, "nx.json"))}, past where an Nx workspace is read, so the global styles its project names are not read.`,
        ])
        // A deep directory with no project.json in it says nothing.
        warnings.length = 0
        write({ "apps/web/project.json": project })
        unknown("apps/web/src/app/a/b/c/d/e/page.html", "zz")
        expect(warnings).toEqual([])
      })

      it("says when an Nx workspace holds more project.json files than are read", () => {
        const files: Record<string, string> = { "nx.json": "{}" }
        for (let i = 0; i < 501; i++) {
          files[`libs/p${String(i).padStart(3, "0")}/project.json`] = "{}"
        }
        write(files)
        warnings.length = 0
        unknown("libs/p000/src/page.html", "zz")
        expect(warnings).toEqual([
          `[shadcn-lint-angular] ${posix(path.join(dir, "nx.json"))} is an Nx workspace with more than 500 project.json files. Those past the first 500 are not read, nor the global styles their projects name.`,
        ])
      })
    })

    // `ng add tailwindcss` writes src/tailwind.css with Tailwind alone;
    // spartan's CLI writes the Tailwind imports, its preset and the theme
    // into src/styles.scss. Angular's build hands each to Tailwind on its
    // own, so the app's classes are those of the second.
    describe("the Tailwind entry among the global styles", () => {
      let dir = ""
      beforeEach(() => {
        dir = fs.realpathSync.native(
          fs.mkdtempSync(path.join(os.tmpdir(), "shadcn-ng-entry-"))
        )
        fs.symlinkSync(
          path.resolve(PROJECT, "../../../node_modules"),
          path.join(dir, "node_modules")
        )
      })
      afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))
      const SPLIT = [
        `@layer theme, base, components, utilities;`,
        `@import "tailwindcss/theme.css" layer(theme);`,
        `@import "tailwindcss/utilities.css";`,
      ].join("\n")
      const THEME = `@theme { --color-brand: oklch(0.55 0.2 250); }`
      const workspace = (styles: string, settings: object = {}) => {
        const files: Record<string, string> = {
          "package.json": `{ "name": "app", "private": true }`,
          "angular.json": JSON.stringify({
            projects: {
              app: {
                root: "",
                architect: {
                  build: {
                    options: {
                      styles: ["src/tailwind.css", "src/styles.scss"],
                    },
                  },
                },
              },
            },
          }),
          "src/tailwind.css": `@import "tailwindcss";`,
          "src/styles.scss": styles,
          // Partials Sass finds and Tailwind's compiler does not.
          "src/_variables.scss": `$gap: 4px;`,
          "src/_tokens.scss": `@theme { --color-sea: blue; }`,
          "src/_theme.scss": `$brand: red;`,
        }
        for (const [file, text] of Object.entries(files)) {
          fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true })
          fs.writeFileSync(path.join(dir, file), text)
        }
        return (code: string, file = "src/app/page.html") =>
          new Linter({ cwd: dir })
            .verify(
              code,
              [
                {
                  files: ["**/*.html", "**/*.tsx", "**/*.ts"],
                  languageOptions: {
                    parser: (file.endsWith(".html")
                      ? ngParser
                      : tsParser) as any,
                    parserOptions: { ecmaFeatures: { jsx: true } },
                  },
                  plugins: { shadcn: plugin as any },
                  settings: { shadcn: settings },
                  rules: {
                    "shadcn/no-raw-colors": "error",
                    "shadcn/no-unknown-classes": "error",
                  },
                },
              ],
              { filename: path.join(dir, file) }
            )
            .map((m) => m.message)
      }
      const PAGE = `<div class="text-brandd bg-red-500 flex"></div>`

      it("is the one that imports Tailwind with the theme, Sass included", () => {
        const lint = workspace(
          [
            SPLIT,
            THEME,
            `@use "sass:math";`,
            `$gap: 4px;`,
            `.page { &-header { margin: math.div($gap, 2); } }`,
          ].join("\n")
        )
        expect(lint(PAGE)).toEqual([
          expect.stringContaining(
            `"text-brandd" is not a declared theme color. Did you mean "text-brand"?`
          ),
          expect.stringContaining(
            `declare --color-<name> in src/styles.scss for a new color`
          ),
        ])
        expect(warnings).toEqual([])
      })

      // Sass passes a custom property's value through as written but for
      // an interpolation: a `//` there is no comment, to Sass or to CSS.
      it("is one whose custom property holds a //, which Sass passes through", () => {
        const lint = workspace(
          [
            SPLIT,
            `:root { --logo: url(https://cdn.test/a.svg); --docs: https://docs.test/x; --grid: 1fr//2; }`,
            `.page { --gap: { a: b; }; color: red; }`,
            THEME,
          ].join("\n")
        )
        expect(lint(PAGE)).toContainEqual(
          expect.stringContaining(`Did you mean "text-brand"?`)
        )
        expect(warnings).toEqual([])
        warnings.length = 0
        resetWarnings()
        resetFsMemo()
        workspace(
          [
            SPLIT,
            `:root { --docs: https://docs.test/x; } // Brand.`,
            THEME,
          ].join("\n")
        )(PAGE)
        expect(warnings).toEqual([
          expect.stringContaining(
            "line 4 has a // comment, which only Sass skips"
          ),
        ])
        warnings.length = 0
        resetWarnings()
        resetFsMemo()
        workspace([SPLIT, `:root { --x: #{$a}; }`, THEME].join("\n"))(PAGE)
        expect(warnings).toEqual([
          expect.stringContaining("line 4 has a Sass interpolation, #{…}"),
        ])
      })

      // A React file's theme is found as upstream finds it.
      it("is not the theme of a React file in the workspace", () => {
        const lint = workspace([SPLIT, THEME].join("\n"))
        expect(
          lint(
            `export const A = () => <div className="zz-box" />`,
            "src/react/a.tsx"
          )
        ).toEqual([
          expect.stringContaining(
            `declare it with @utility in src/tailwind.css`
          ),
        ])
        expect(lint(`<div class="zz-box"></div>`)).toEqual([
          expect.stringContaining(
            `declare it with @utility in src/styles.scss`
          ),
        ])
        expect(warnings).toEqual([])
      })

      // A helper of the app imports nothing from Angular: under the root
      // of an Angular project it is the app's. Outside one, a package's
      // dependency on Angular does not make it so.
      it("is the theme of the app's other scripts", () => {
        const lint = workspace([SPLIT, THEME].join("\n"))
        const helper = `export const box = cn("zz-box")`
        expect(lint(helper, "src/app/box.ts")).toEqual([
          expect.stringContaining(
            `declare it with @utility in src/styles.scss`
          ),
        ])
        // A component file of another framework there finds its own.
        expect(
          lint(`export const A = () => <div className="zz-box" />`, "src/a.tsx")
        ).toEqual([
          expect.stringContaining(
            `declare it with @utility in src/tailwind.css`
          ),
        ])
        const json = JSON.parse(
          fs.readFileSync(path.join(dir, "angular.json"), "utf8")
        )
        json.projects.app.root = "src"
        fs.writeFileSync(path.join(dir, "angular.json"), JSON.stringify(json))
        fs.writeFileSync(
          path.join(dir, "package.json"),
          `{ "name": "app", "dependencies": { "@angular/core": "^22.0.0" } }`
        )
        resetFsMemo()
        expect(lint(helper, "tools/box.ts")).toEqual([
          expect.stringContaining(
            `declare it with @utility in src/tailwind.css`
          ),
        ])
        expect(lint(helper, "src/app/box.ts")).toEqual([
          expect.stringContaining(
            `declare it with @utility in src/styles.scss`
          ),
        ])
      })

      it.each([
        [
          `// The app's theme.\n${SPLIT}\n${THEME}`,
          "line 1 has a // comment, which only Sass skips",
        ],
        [
          `@use "tailwindcss";\n${THEME}`,
          "line 1 loads Tailwind with @use, which only Sass follows",
        ],
        [
          `${SPLIT}\n$size: 2;\n.gap-#{$size} { gap: 1px; }\n${THEME}`,
          "line 5 has a Sass interpolation, #{…}",
        ],
        [
          `${SPLIT}\n@import "variables";\n${THEME}`,
          `line 4 imports "variables", which names no stylesheet Tailwind can load, such as a Sass partial`,
        ],
        // Tailwind keeps a Sass module rule as written: the tokens of the
        // partial it names are not read.
        [
          `@use "sass:math";\n@use './tokens';\n${SPLIT}\n${THEME}`,
          `line 2 loads "./tokens" with @use, which only Sass follows`,
        ],
        [
          `${SPLIT}\n@forward "theme" show $brand;\n${THEME}`,
          `line 4 loads "theme" with @forward, which only Sass follows`,
        ],
        [
          `@use "sass:meta";\n${SPLIT}\n@include meta.load-css("./tokens");\n${THEME}`,
          `line 5 loads "./tokens" with meta.load-css, which only Sass follows`,
        ],
        // What reads as CSS but Tailwind's compiler stops at.
        [
          `${SPLIT}\n${THEME}\n.page { color: red;`,
          `building it stops with "Missing closing } at .page"`,
        ],
      ])(
        "falls back where the stylesheet reads otherwise in Sass: %#",
        (styles, reason) => {
          const lint = workspace(styles)
          // The classes are those of the CSS entry found as before, not
          // the grammar's.
          expect(lint(`<div class="flx"></div>`)).toEqual([
            expect.stringContaining(`Did you mean "flex"?`),
          ])
          lint(PAGE)
          lint(`<div></div>`, "src/app/other.html")
          expect(warnings).toEqual([
            `[shadcn-lint-angular] src/styles.scss imports Tailwind and holds the theme, but Tailwind's compiler cannot read it as written: ${reason}. The theme is read from src/tailwind.css instead. Import Tailwind and the theme from a CSS file among the styles of angular.json, or set settings.shadcn.entryPoint to one.`,
          ])
        }
      )

      // Of two that import Tailwind with a theme, the classes come from one.
      it("takes the one that declares the most tokens of several, and says so", () => {
        const lint = workspace(
          `${SPLIT}\n@theme { --color-brand: oklch(0.55 0.2 250); --color-ink: #000; }`
        )
        fs.writeFileSync(
          path.join(dir, "src/tailwind.css"),
          `@import "tailwindcss";\n@theme { --color-sea: blue; }`
        )
        expect(lint(PAGE)).toContainEqual(
          expect.stringContaining(`Did you mean "text-brand"?`)
        )
        lint(`<div></div>`, "src/app/other.html")
        expect(warnings).toEqual([
          "[shadcn-lint-angular] src/tailwind.css and src/styles.scss among the styles of angular.json each import Tailwind with a theme, and Tailwind builds each on its own. The theme is read from src/styles.scss, which declares the most tokens. Set settings.shadcn.entryPoint to the one the app's classes come from.",
        ])
        warnings.length = 0
        resetWarnings()
        workspace(
          `${SPLIT}\n@theme { --color-brand: oklch(0.55 0.2 250); --color-ink: #000; }`,
          { entryPoint: "src/tailwind.css" }
        )(PAGE)
        expect(warnings).toEqual([])
      })

      it("says when the theme is read from a stylesheet that holds none while a global one does", () => {
        const lint = workspace([SPLIT, THEME].join("\n"), {
          entryPoint: "src/tailwind.css",
        })
        lint(PAGE)
        expect(warnings).toEqual([
          "[shadcn-lint-angular] The theme is read from src/tailwind.css, which holds no @theme, @plugin, @utility or @custom-variant, while src/styles.scss among the styles of angular.json does. Tailwind builds each global stylesheet on its own, so the app's classes come from the one that imports Tailwind with the theme: set settings.shadcn.entryPoint to src/styles.scss.",
        ])
      })

      // A project that names no styles of its own: a library, styled by
      // the apps that use it, or an app whose builder lists none, such as
      // Analog's, which imports its own stylesheet.
      const nx = (files: Record<string, string>) => {
        for (const [file, text] of Object.entries({
          "package.json": `{ "name": "ws", "private": true }`,
          "nx.json": "{}",
          "apps/shop/project.json": JSON.stringify({
            targets: {
              build: {
                executor: "@nx/angular:application",
                options: {
                  styles: [
                    "apps/shop/src/tailwind.css",
                    "apps/shop/src/styles.scss",
                  ],
                },
              },
            },
          }),
          "apps/shop/src/tailwind.css": `@import "tailwindcss";`,
          "apps/shop/src/styles.scss": `${SPLIT}\n${THEME}`,
          ...files,
        })) {
          fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true })
          fs.writeFileSync(path.join(dir, file), text)
        }
        return (file: string) =>
          new Linter({ cwd: dir })
            .verify(
              `<div class="zz-box"></div>`,
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
            .map((m) => m.message)
      }

      it("is the apps' for a library, when what is found under it holds no theme", () => {
        const lint = nx({ "libs/ui/project.json": `{ "targets": {} }` })
        expect(lint("libs/ui/src/button.html")).toEqual([
          expect.stringContaining("@utility in apps/shop/src/styles.scss"),
        ])
        expect(warnings).toEqual([])
      })

      // Of several apps, which one a library is built for is not written
      // anywhere the linter reads.
      it("is one of the apps' for a library, said when several hold a theme", () => {
        const lint = nx({
          "libs/ui/project.json": `{ "targets": {} }`,
          "apps/admin/project.json": JSON.stringify({
            targets: {
              build: {
                executor: "@nx/angular:application",
                options: { styles: ["apps/admin/src/styles.css"] },
              },
            },
          }),
          "apps/admin/src/styles.css": `@import "tailwindcss";\n@theme { --color-a: #000; --color-b: #111; }`,
        })
        expect(lint("libs/ui/src/button.html")).toEqual([
          expect.stringContaining("@utility in apps/admin/src/styles.css"),
        ])
        lint("libs/ui/src/card.html")
        expect(warnings).toEqual([
          "[shadcn-lint-angular] A project that names no global styles of its own, as a library styled by the apps that use it, takes those of every project in the workspace, and apps/admin/src/styles.css and apps/shop/src/styles.scss among them each import Tailwind with a theme. The theme of its files is read from apps/admin/src/styles.css. Set settings.shadcn.entryPoint to the entry of the app it is built for.",
        ])
        // An app is said nothing of: its own styles hold one theme.
        warnings.length = 0
        resetWarnings()
        lint("apps/shop/src/app/page.html")
        expect(warnings).toEqual([])
      })

      it("is the app's own for one whose builder lists no styles, when that holds the theme", () => {
        const lint = nx({
          "apps/site/project.json": JSON.stringify({
            targets: { build: { executor: "@analogjs/platform:vite" } },
          }),
          "apps/site/src/styles.css": `@import "tailwindcss";\n@theme { --color-brand: #123456; --color-ink: #000; }`,
        })
        expect(lint("apps/site/src/app/page.html")).toEqual([
          expect.stringContaining("@utility in apps/site/src/styles.css"),
        ])
        expect(warnings).toEqual([])
      })

      it("says when a named Sass entry cannot be read as written", () => {
        const lint = workspace(`${SPLIT}\n// Brand.\n${THEME}`, {
          entryPoint: "src/styles.scss",
        })
        lint(PAGE)
        expect(warnings).toEqual([
          "[shadcn-lint-angular] src/styles.scss, the Tailwind entry the settings or components.json name, is read as Tailwind's compiler reads it, as CSS, and it cannot be read so as written: line 4 has a // comment, which only Sass skips. What follows there is misread. Import Tailwind and the theme from a CSS file, and name that instead.",
        ])
      })

      it("leaves a named entry alone, though a Sass one cannot be read", () => {
        const lint = workspace(`@use "tailwindcss";\n${THEME}`, {
          entryPoint: "src/theme-entry.css",
        })
        fs.writeFileSync(
          path.join(dir, "src/theme-entry.css"),
          `@import "tailwindcss";\n${THEME}`
        )
        expect(lint(PAGE)).toContainEqual(
          expect.stringContaining(`Did you mean "text-brand"?`)
        )
        expect(warnings).toEqual([])
      })
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
        `[shadcn-lint-angular] src/styles.scss imports Tailwind, but no CSS file under ${where} does, and a Sass file is read as the Tailwind entry only among the global styles of angular.json or project.json, so no-unknown-classes reads classes with the grammar bundled with shadcn-lint-angular, and the project's theme is not read. Set settings.shadcn.entryPoint to a stylesheet written as CSS that imports Tailwind with the theme.`,
      ])
    })

    // spartan's theme imports Tailwind's stylesheets one by one.
    it("takes Tailwind's own stylesheets, imported one by one from Sass, for importing Tailwind", () => {
      const dir = fs.realpathSync.native(
        fs.mkdtempSync(path.join(os.tmpdir(), "shadcn-ng-split-"))
      )
      try {
        fs.mkdirSync(path.join(dir, "src/app"), { recursive: true })
        fs.writeFileSync(path.join(dir, "package.json"), `{ "name": "split" }`)
        fs.writeFileSync(
          path.join(dir, "src/styles.scss"),
          `@import 'tailwindcss/theme.css' layer(theme);\n@import 'tailwindcss/utilities.css';`
        )
        new Linter({ cwd: dir }).verify(
          `<div class="p-4"></div>`,
          [
            {
              files: ["**/*.html"],
              languageOptions: { parser: ngParser as any },
              plugins: { shadcn: plugin as any },
              rules: { "shadcn/no-unknown-classes": "error" },
            },
          ],
          { filename: path.join(dir, "src/app/page.html") }
        )
        expect(warnings).toEqual([
          expect.stringContaining(
            "src/styles.scss imports Tailwind, but no CSS file under"
          ),
        ])
      } finally {
        fs.rmSync(dir, { recursive: true, force: true })
      }
    })

    it("warns once when no stylesheet imports Tailwind", () => {
      unknownIn("angular-no-entry", "src/app/page.html", `<div></div>`)
      const where = path.relative(
        process.cwd(),
        path.join(FIXTURES, "angular-no-entry")
      )
      expect(warnings).toEqual([
        `[shadcn-lint-angular] No stylesheet importing Tailwind was found under ${where}, so no-unknown-classes reads classes with the grammar bundled with shadcn-lint-angular, and the project's theme is not read. Set settings.shadcn.entryPoint to the stylesheet that imports Tailwind.`,
      ])
    })

    // A project whose Tailwind entry sits outside it, where nothing finds
    // it but the setting.
    const unknownWith = (entryPoint: unknown, code: string) => {
      const dir = path.join(FIXTURES, "angular-entry-point")
      return new Linter({ cwd: dir })
        .verify(
          code,
          [
            {
              files: ["**/*.html"],
              languageOptions: { parser: ngParser as any },
              plugins: { shadcn: plugin as any },
              settings: { shadcn: { entryPoint } },
              rules: { "shadcn/no-unknown-classes": "error" },
            },
          ],
          { filename: path.join(dir, "app/src/app/page.html") }
        )
        .map((m) => m.message.split('"')[1])
    }

    it("reads the classes Tailwind knows from settings.shadcn.entryPoint, without components.json", () => {
      expect(
        unknownWith(
          "styles/tailwind.css",
          `<div class="flex brand-box brand-bx"></div>`
        )
      ).toEqual(["brand-bx"])
      expect(warnings).toEqual([])
    })

    it("says once that settings.shadcn.entryPoint names no file, and falls back", () => {
      for (const code of [`<div class="brand-box"></div>`, `<div></div>`]) {
        unknownWith("styles/missing.css", code)
      }
      unknownWith(3, `<div></div>`)
      expect(warnings).toEqual([
        "[shadcn-lint-angular] settings.shadcn.entryPoint is styles/missing.css, which does not exist. No stylesheet importing Tailwind was found under the project, so no-unknown-classes reads classes with the grammar bundled with shadcn-lint-angular until the path is fixed.",
        "[shadcn-lint-angular] settings.shadcn.entryPoint must be a string; it is ignored.",
        // Ignored, the setting leaves the project with its Sass entry.
        expect.stringContaining("src/styles.scss imports Tailwind"),
      ])
    })

    it("says an empty settings.shadcn.entryPoint names no stylesheet", () => {
      unknownWith("", `<div></div>`)
      expect(warnings[0]).toBe(
        "[shadcn-lint-angular] settings.shadcn.entryPoint is empty, and an empty path names no stylesheet; it is ignored."
      )
    })

    it("says a directory set as settings.shadcn.entryPoint is one", () => {
      unknownWith("styles", `<div></div>`)
      expect(warnings).toEqual([
        "[shadcn-lint-angular] settings.shadcn.entryPoint is styles, which is a directory, not a stylesheet. No stylesheet importing Tailwind was found under the project, so no-unknown-classes reads classes with the grammar bundled with shadcn-lint-angular until the path is fixed.",
      ])
    })

    const REACT = `export const A = () => <div className="flex p-4" />`
    const ANGULAR = `import { Component } from "@angular/core"
      @Component({ selector: "x-a", template: "" })
      export class A { classes = "flex p-4" }`
    const scriptIn = (workspace: string, file: string, code = ANGULAR) => {
      const dir = path.join(FIXTURES, workspace)
      return new Linter({ cwd: dir }).verify(
        code,
        [
          {
            files: ["**/*.tsx", "**/*.ts"],
            languageOptions: {
              parser: tsParser as any,
              parserOptions: { ecmaFeatures: { jsx: true } },
            },
            plugins: { shadcn: plugin as any },
            rules: { "shadcn/no-unknown-classes": "error" },
          },
        ],
        { filename: path.join(dir, file) }
      )
    }

    it("warns once per workspace, from an Angular script", () => {
      scriptIn("entryless-workspace", "packages/a/src/a.ts")
      scriptIn("entryless-workspace", "packages/b/src/b.ts")
      const where = path.relative(
        process.cwd(),
        path.join(FIXTURES, "entryless-workspace/packages/a")
      )
      expect(warnings).toEqual([
        `[shadcn-lint-angular] No stylesheet importing Tailwind was found under ${where}, so no-unknown-classes reads classes with the grammar bundled with shadcn-lint-angular, and the project's theme is not read. Set settings.shadcn.entryPoint to the stylesheet that imports Tailwind.`,
      ])
    })

    // Upstream says nothing there, and neither does this.
    it("does not warn from a React, Vue or Svelte file", () => {
      scriptIn("entryless-workspace", "packages/a/src/a.tsx", REACT)
      scriptIn("entryless-workspace", "packages/b/src/b.tsx", REACT)
      const rules = { "shadcn/no-unknown-classes": "error" }
      const sfc = path.join(FIXTURES, "entryless-workspace/packages/a/src")
      lintSfc(
        `<template><div class="flex p-4"></div></template>`,
        path.join(sfc, "A.vue"),
        rules
      )
      lintSfc(`<div class="flex p-4"></div>`, path.join(sfc, "A.svelte"), rules)
      expect(warnings).toEqual([])
    })

    it("does not warn in a Tailwind v3 project, which has no CSS entry to find", () => {
      scriptIn("tailwind3-css", "src/app.ts")
      scriptIn("tailwind3-installed", "src/app.ts")
      expect(warnings).toEqual([])
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

    // An import this cannot read may declare any class, as an unreadable
    // selector may.
    describe("its imports", () => {
      let dir = ""
      beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), "shadcn-ng-imports-"))
      })
      afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))
      const read = (css: string) =>
        ownClassesOfCss(css, path.join(dir, "a.scss"))

      it("reads nothing from Sass's own modules or a stylesheet a URL names", () => {
        const own = read(
          `@use "sass:math"; @import "https://fonts.test/a.css"; @import url("//cdn.test/b.css"); .a { }`
        )
        expect(own.unread).toBe(null)
        expect(["a", "b"].filter((name) => own.has(name))).toEqual(["a"])
      })

      it("settles everything past an import it cannot resolve", () => {
        for (const [css, reason] of [
          [
            `@import "~pkg/theme"; .a { }`,
            'the import "~pkg/theme" uses `~`, which is not resolved',
          ],
          [
            `@use "./missing"; .a { }`,
            'the import "./missing" does not resolve to a stylesheet',
          ],
          [
            `@use "no-such-package/x"; .a { }`,
            'the import "no-such-package/x" does not resolve to a stylesheet',
          ],
        ]) {
          const own = read(css)
          expect(own.has("anything")).toBe(true)
          expect(own.unread).toEqual({
            reason,
            where: path.join(dir, "a.scss"),
          })
        }
      })

      it("reads a package's stylesheet its exports give under style", () => {
        const pkg = path.join(dir, "node_modules/animate-kit")
        fs.mkdirSync(path.join(pkg, "dist"), { recursive: true })
        fs.writeFileSync(
          path.join(pkg, "package.json"),
          JSON.stringify({
            name: "animate-kit",
            exports: {
              ".": { style: "./dist/kit.css", default: "./dist/index.js" },
            },
          })
        )
        fs.writeFileSync(path.join(pkg, "dist/kit.css"), ".kit-in { }")
        fs.writeFileSync(path.join(pkg, "dist/index.js"), "export {}")
        const own = read(`@import "animate-kit"; .a { }`)
        expect(own.unread).toBe(null)
        expect(["a", "kit-in", "b"].filter((name) => own.has(name))).toEqual([
          "a",
          "kit-in",
        ])
      })

      it("reads only the URL an @use, @forward or @import names", () => {
        fs.writeFileSync(path.join(dir, "_vars.scss"), `.from-vars { }`)
        fs.writeFileSync(path.join(dir, "_list.scss"), `.from-list { }`)
        fs.writeFileSync(path.join(dir, "one.css"), `.from-one { }`)
        fs.writeFileSync(path.join(dir, "two.css"), `.from-two { }`)
        const own = read(
          [
            `@use "./vars" with ($font: "Roboto", $alt: 'Arial');`,
            `@use "vars" as v;`,
            `@forward "list" hide reset, $gap;`,
            `@forward "list" show "x";`,
            `@import "one.css", url(two.css) screen;`,
            `.a { content: "@import 'nope'"; }`,
          ].join("\n")
        )
        expect(own.unread).toBe(null)
        expect(
          ["from-vars", "from-list", "from-one", "from-two", "a", "b"].filter(
            (name) => own.has(name)
          )
        ).toEqual(["from-vars", "from-list", "from-one", "from-two", "a"])
      })

      it("reads an import written without quotes or a closing semicolon", () => {
        fs.writeFileSync(path.join(dir, "bare.css"), `.from-bare { }`)
        fs.writeFileSync(path.join(dir, "_last.scss"), `.from-last { }`)
        fs.writeFileSync(path.join(dir, "_inner.scss"), `.from-inner { }`)
        const own = read(
          `@import url(bare.css);\n.x { @import "inner" }\n.y { }\n@import "last"`
        )
        expect(own.unread).toBe(null)
        expect(
          ["from-bare", "from-inner", "from-last", "x", "y"].filter((name) =>
            own.has(name)
          )
        ).toEqual(["from-bare", "from-inner", "from-last", "x", "y"])
      })

      it("leaves a comment marker inside a string alone", () => {
        const own = read(
          `.a::after { content: " // not a comment"; }\n.b { }\n.c::before { content: "/* nor this */"; }\n.d { }`
        )
        expect(["a", "b", "c", "d"].filter((name) => own.has(name))).toEqual([
          "a",
          "b",
          "c",
          "d",
        ])
      })

      it("settles everything past as many stylesheets as it reads", () => {
        const names = Array.from({ length: 70 }, (_, i) => `p${i}`)
        for (const name of names) {
          fs.writeFileSync(path.join(dir, `_${name}.scss`), `.${name} { }`)
        }
        const own = read(names.map((name) => `@use "${name}";`).join("\n"))
        expect(own.has("anything")).toBe(true)
        expect(own.unread?.reason).toBe(
          "it imports more than 64 stylesheets, and the rest are not read"
        )
        const few = read(
          names
            .slice(0, 10)
            .map((name) => `@use "${name}";`)
            .join("\n")
        )
        expect(few.unread).toBe(null)
        expect(few.has("p9")).toBe(true)
        expect(few.has("p10")).toBe(false)
      })
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

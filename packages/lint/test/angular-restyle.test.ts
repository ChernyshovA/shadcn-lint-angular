// no-restyle in Angular templates. A template imports nothing a tag
// could be resolved through, so a contract's pattern names the element
// by its tag and its attributes, the way angular-eslint's options name
// directives: `hlmBtn` is that name, `/^hlm/` a regex.

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
import { cachedDeclarationForTests } from "../src/project/angular-directives"
import { variantDefinitionsOf } from "../src/project/variants"
import { setAngularCompilerForTests } from "./compiler-stub"

// vi.mock runs before the imports above, so it imports the stub itself.
vi.mock("../src/sites/readers/angular-compiler", async (importOriginal) =>
  (await import("./compiler-stub")).mockAngularCompiler(importOriginal as any)
)

const PROJECT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures/angular-project"
)
const TEMPLATE = path.join(PROJECT, "src/app/card.component.html")

function lint(
  code: string,
  options?: unknown,
  filename = TEMPLATE,
  cwd = PROJECT
) {
  return new Linter({ cwd }).verify(
    code,
    [
      {
        files: ["**/*.html"],
        languageOptions: { parser: ngParser as any },
        plugins: { shadcn: plugin as any },
        rules: {
          "shadcn/no-restyle": options ? ["error", options] : "error",
        } as any,
      },
    ],
    { filename }
  )
}

const messages = (code: string, options?: unknown) =>
  lint(code, options).map((m) => m.message)

// The class each finding names.
const reported = (code: string, options?: unknown) =>
  lint(code, options).map((m) => m.message.split('"')[1])

describe("no-restyle in Angular templates", () => {
  it("checks no element until a contract names one", () => {
    const code = `<button hlmBtn class="bg-red-500 p-4"></button><p-button class="bg-red-500"></p-button><app-card class="rounded-full"></app-card>`
    expect(lint(code)).toEqual([])
    expect(lint(code, { allow: ["layout"] })).toEqual([])
    expect(
      lint(code, { allow: ["layout"], contracts: [{ pattern: "hlmCard" }] })
    ).toEqual([])
  })

  it("names an element by an attribute, the tag, or a binding", () => {
    const options = {
      allow: ["layout"],
      contracts: [{ pattern: "hlmBtn" }, { pattern: "p-button" }],
    }
    expect(
      messages(
        `<button hlmBtn class="mt-4 bg-red-500"></button><p-button class="rounded-full"></p-button><a [hlmBtn]="tone" [class]="'text-pink-500'"></a>`,
        options
      )
    ).toEqual([
      '"bg-red-500" is not allowed on <button hlmBtn>: <button hlmBtn> owns its color. Use one of its variants. Add a new variant only if the design explicitly calls for a treatment none of them provides.',
      '"rounded-full" is not allowed on <p-button>: <p-button> owns its shape. Use one of its variants. Add a new variant only if the design explicitly calls for a treatment none of them provides.',
      '"text-pink-500" is not allowed on <a hlmBtn>: <a hlmBtn> owns its color. Use one of its variants. Add a new variant only if the design explicitly calls for a treatment none of them provides.',
    ])
  })

  // An input such as styleClass hands its classes to the directive that
  // takes it, which puts them where it likes: inside its component, or on
  // the element PrimeNG's StyleClass targets. The element's contracts
  // judge what lands on the element itself; an input, the contract of
  // the directive that takes it (angular-input-owners.test.ts).
  describe("the classes an element wears", () => {
    const options = {
      allow: ["layout"],
      contracts: [{ pattern: "/^p[A-Z-]/" }, { pattern: "hlmBtn" }],
    }

    it("checks class, its bindings, and the classes NgClass and routerLinkActive add", () => {
      expect(
        reported(
          `<a hlmBtn class="bg-red-500" [class.rounded-full]="on" [ngClass]="{ 'border-red-500': on }" routerLinkActive="bg-blue-500"></a><a hlmBtn [class]="'text-red-500'"></a><a hlmBtn [attr.class]="'shadow-lg'"></a><a hlmBtn ngClass="ring-red-500"></a>`,
          options
        )
      ).toEqual([
        "bg-red-500",
        "rounded-full",
        "border-red-500",
        "bg-blue-500",
        "text-red-500",
        "shadow-lg",
        "ring-red-500",
      ])
    })

    // It renders no element, so its class lands nowhere.
    it("an ng-container wears none", () => {
      expect(
        reported(
          `<ng-container hlmBtn class="bg-red-500"></ng-container><ng-container *ngIf="on" pFocusTrap [ngClass]="{ 'bg-red-500': on }"></ng-container>`,
          options
        )
      ).toEqual([])
    })

    it("leaves an input no contract judges to the other rules", () => {
      const found = new Linter({ cwd: PROJECT }).verify(
        `<button pButton enterActiveClass="bg-red-500"></button>`,
        [
          {
            files: ["**/*.html"],
            languageOptions: { parser: ngParser as any },
            plugins: { shadcn: plugin as any },
            rules: {
              "shadcn/no-restyle": ["error", options],
              "shadcn/no-raw-colors": "error",
            } as any,
          },
        ],
        { filename: TEMPLATE }
      )
      expect(found.map((m) => m.ruleId)).toEqual(["shadcn/no-raw-colors"])
    })
  })

  it("matches a plain pattern as the whole name, a slashed one as a regex", () => {
    const code = `<button hlmBtn class="bg-red-500"></button><div hlmBtnGroup class="bg-red-500"></div><div HLMCard class="bg-red-500"></div>`
    const tags = (pattern: string) =>
      lint(code, { allow: ["layout"], contracts: [{ pattern }] }).map(
        (m) => /<([^>]+)>/.exec(m.message)![1]
      )
    expect(tags("hlmBtn")).toEqual(["button hlmBtn"])
    expect(tags("^hlmBtn$")).toEqual([])
    expect(tags("/^hlm/")).toEqual(["button hlmBtn", "div hlmBtnGroup"])
    expect(tags("/^hlm/i")).toEqual([
      "button hlmBtn",
      "div hlmBtnGroup",
      "div HLMCard",
    ])
    // A stateful flag would skip every other name.
    expect(tags("/^hlm/gi")).toEqual(tags("/^hlm/i"))
  })

  it("leaves out class and style, and bindings no directive is matched by", () => {
    const options = {
      allow: ["layout"],
      contracts: [{ pattern: "/^(class|style|on|role|color|fade)$/" }],
    }
    expect(
      lint(
        `<div class="bg-red-500" style="color: red" [class.on]="a" [attr.role]="r" [style.color]="c" [@fade]="s"></div>`,
        options
      )
    ).toEqual([])
    // An event is a name, as Angular matches selectors against it.
    expect(
      reported(`<div (fade)="go()" class="bg-red-500"></div>`, options)
    ).toEqual(["bg-red-500"])
  })

  // A reference, a structural directive's template, i18n's markers, an
  // <ng-template>, an animation's events and an event the element does
  // not fire are written on it, but name nothing it is.
  it("leaves out what is written on an element but does not name it", () => {
    const options = {
      allow: ["layout"],
      contracts: [{ pattern: "/^(hlm|i18n|animate)/" }],
    }
    expect(
      lint(
        [
          `<div #hlmRef class="bg-red-500"></div>`,
          `<div *hlmIf="on" class="bg-red-500"></div>`,
          `<div i18n-title title="x" i18n="@@hlm" class="bg-red-500"></div>`,
          `<ng-template hlmTemplate class="bg-red-500"></ng-template>`,
          `<div (@hlmFade.done)="done()" (animate.leave)="go()" class="bg-red-500"></div>`,
          `<div (window:hlmResize)="fit()" (document:keydown.hlm)="key()" class="bg-red-500"></div>`,
        ].join(""),
        options
      )
    ).toEqual([])
  })

  it("says a class the component's or the global styles declare is declared, not misspelled", () => {
    const options = { allow: ["layout"], contracts: [{ pattern: "hlmCard" }] }
    const declared = (className: string) =>
      `"${className}" is not allowed on <div hlmCard>: your CSS declares it, and the grammar cannot tell what it changes. Use a variant, or put it on a parent element.`
    expect(
      messages(`<div hlmCard class="card-title made-up"></div>`, options)
    ).toEqual([
      declared("card-title"),
      '"made-up" is not allowed on <div hlmCard>: the grammar does not recognize it. Fix the spelling, or use a class Tailwind generates.',
    ])
    // From angular.json: a stylesheet of the project's and a package's.
    const workspace = path.resolve(PROJECT, "../angular-workspace")
    expect(
      lint(
        `<div hlmCard class="page-shell-header fi-check"></div>`,
        options,
        path.join(workspace, "src/app/page.component.html"),
        workspace
      ).map((m) => m.message)
    ).toEqual([declared("page-shell-header"), declared("fi-check")])
    // A class the styles of the component on the element select on its
    // host, `:host(.row-fill)`.
    expect(
      lint(
        `<app-form-row class="row-fill made-up"></app-form-row>`,
        { allow: ["layout"], contracts: [{ pattern: "app-form-row" }] },
        path.join(PROJECT, "src/app/host/parent.component.html")
      ).map((m) => m.message)
    ).toEqual([
      '"row-fill" is not allowed on <app-form-row>: your CSS declares it, and the grammar cannot tell what it changes. Use a variant, or put it on a parent element.',
      '"made-up" is not allowed on <app-form-row>: the grammar does not recognize it. Fix the spelling, or use a class Tailwind generates.',
    ])
  })

  // What a class of the component's own styles changes is what their
  // rules set, as an @utility's body says: `.orders-card { max-width }` is
  // layout. Anything else in a rule it is in, on it or on what it holds,
  // and the grammar still cannot tell.
  describe("a class the component's own styles declare", () => {
    let dir = ""
    beforeEach(() => {
      dir = fs.realpathSync.native(
        fs.mkdtempSync(path.join(os.tmpdir(), "shadcn-ng-own-layout-"))
      )
      fs.mkdirSync(path.join(dir, "src/app"), { recursive: true })
      fs.writeFileSync(path.join(dir, "package.json"), `{ "name": "own" }`)
      fs.writeFileSync(
        path.join(dir, "src/app/orders.component.ts"),
        `import { Component } from "@angular/core"
@Component({ selector: "app-orders", templateUrl: "./orders.component.html", styleUrl: "./orders.component.scss" })
export class OrdersComponent {}`
      )
    })
    afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))
    const judged = (scss: string, classes: string, allow = ["layout"]) => {
      fs.writeFileSync(path.join(dir, "src/app/orders.component.scss"), scss)
      return lint(
        `<mat-card class="${classes}"></mat-card><section hlmCard class="${classes}"></section>`,
        { allow, contracts: [{ pattern: "mat-card" }, { pattern: "hlmCard" }] },
        path.join(dir, "src/app/orders.component.html"),
        dir
      ).map((m) => m.message)
    }
    const declared = (className: string, on: string) =>
      `"${className}" is not allowed on <${on}>: your CSS declares it, and the grammar cannot tell what it changes. Use a variant, or put it on a parent element.`

    it("is layout when every rule it is in sets layout alone", () => {
      expect(
        judged(
          [
            `.orders-card { max-width: 40rem; margin: 0 auto; }`,
            `.profile-card { scroll-margin-top: 4rem; }`,
            `@media (min-width: 640px) { .orders-card { grid-column: span 2; align-self: start; } }`,
            `.wide { width: 100%; position: relative; inset: 0; z-index: 1; order: 2; flex: 1 1 0; }`,
          ].join("\n"),
          "orders-card profile-card wide"
        )
      ).toEqual([])
    })

    // What Tailwind's layout utilities set, text-center's text-align and
    // whitespace-nowrap's white-space among them, past a vendor prefix.
    it("is layout by the properties layout utilities set", () => {
      expect(
        judged(
          [
            `.a { text-align: center; white-space: nowrap; -webkit-transform: none; transform-origin: top; }`,
            `.b { -webkit-user-select: none; overflow-wrap: anywhere; aspect-ratio: 1; flex-flow: row wrap; }`,
          ].join("\n"),
          "a b"
        )
      ).toEqual([])
    })

    // A property no layout utility sets: what paints, or one the grammar
    // has in an appearance category.
    it("is not, where a rule it is in sets a property no layout utility sets", () => {
      const properties = [
        "background-image: url(a.png)",
        "background-size: cover",
        "border-image: url(a.png) 30",
        "mask-image: url(a.svg)",
        "-webkit-mask-image: url(a.svg)",
        "clip-path: circle(50%)",
        "text-overflow: ellipsis",
        "stroke-width: 2",
        "border-spacing: 2px",
        "-moz-osx-font-smoothing: grayscale",
        "-webkit-box-orient: vertical",
      ]
      for (const property of properties) {
        const scss = `.a { width: 1px; ${property}; }`
        expect(judged(scss, "a"), scss).toEqual([
          declared("a", "mat-card"),
          declared("a", "section hlmCard"),
        ])
      }
    })

    it("is not, where a rule it is in sets more, or what cannot be read", () => {
      const cases: [string, string][] = [
        [`.a { max-width: 1px; color: red; }`, "a"],
        [`.a { width: 1px; .title { font-weight: 600; } }`, "a"],
        [`.a { width: 1px; &:hover { opacity: 0.5; } }`, "a"],
        [`.a { --mat-card-container-color: red; }`, "a"],
        [`.a { @include elevated; }`, "a"],
        [`@mixin m { color: red; } .a { width: 1px; @extend .b; }`, "a"],
        [`.a { all: unset; }`, "a"],
        [`.a { margin-#{$side}: 0; }`, "a"],
        [`.a { padding: 4px; }`, "a"],
      ]
      for (const [scss, name] of cases) {
        expect(judged(scss, name), scss).toEqual([
          declared(name, "mat-card"),
          declared(name, "section hlmCard"),
        ])
      }
    })

    it("is judged as layout by a contract that allows none", () => {
      expect(judged(`.a { max-width: 1px; }`, "a", [])).toEqual([
        expect.stringContaining(`"a" is not allowed on <mat-card>`),
        expect.stringContaining(`"a" is not allowed on <section hlmCard>`),
      ])
      expect(judged(`.a { max-width: 1px; }`, "a", [])).not.toContain(
        declared("a", "mat-card")
      )
    })

    it("is read only as it is written, without a variant", () => {
      expect(judged(`.a { max-width: 1px; }`, "md:a")).toEqual([
        expect.stringContaining(`"md:a" is not allowed on <mat-card>`),
        expect.stringContaining(`"md:a" is not allowed on <section hlmCard>`),
      ])
    })
  })

  it("an invalid regex is a configuration error", () => {
    expect(
      messages(`<div x class="p-4"></div>`, { contracts: [{ pattern: "/(/" }] })
    ).toEqual(['Contract pattern "/(/" is not a valid regular expression.'])
  })

  it("a name takes the last contract that matches it", () => {
    const options = {
      allow: ["layout"],
      contracts: [
        { pattern: "/^hlm/" },
        { pattern: "hlmBtn", allow: ["layout", "spacing"] },
      ],
    }
    expect(
      reported(
        `<button hlmBtn class="p-4"></button><div hlmCard class="p-4"></div>`,
        options
      )
    ).toEqual(["p-4"])
  })

  describe("an element several contracts match", () => {
    const code = `<button hlmBtn hlmTooltipTrigger class="mt-4 p-4 bg-red-500"></button>`
    const contracts = [
      { pattern: "hlmTooltipTrigger" },
      { pattern: "hlmBtn", allow: ["layout", "spacing"] },
    ]

    it("takes a class any of them allows by default", () => {
      expect(messages(code, { allow: ["layout"], contracts })).toEqual([
        '"bg-red-500" is not allowed on <button hlmBtn>: <button hlmBtn> owns its color. Use one of its variants. Add a new variant only if the design explicitly calls for a treatment none of them provides.',
      ])
      expect(
        messages(code, {
          allow: ["layout"],
          contracts,
          multipleContracts: "any",
        })
      ).toHaveLength(1)
    })

    it("with all, only a class every one allows, naming the one that refused", () => {
      expect(
        messages(code, {
          allow: ["layout"],
          contracts,
          multipleContracts: "all",
        })
      ).toEqual([
        '"p-4" is not allowed on <button hlmTooltipTrigger>: <button hlmTooltipTrigger> owns its spacing. For space around it, use margin here or gap on the parent.',
        '"bg-red-500" is not allowed on <button hlmBtn>: <button hlmBtn> owns its color. Use one of its variants. Add a new variant only if the design explicitly calls for a treatment none of them provides.',
      ])
    })

    it("a denial in one is overruled by an allowance in another only with any", () => {
      const denying = [
        { pattern: "hlmTooltipTrigger", allow: ["*"], deny: ["mt-*"] },
        { pattern: "hlmBtn", allow: ["layout"] },
      ]
      expect(reported(code, { contracts: denying })).toEqual([])
      expect(
        reported(code, { contracts: denying, multipleContracts: "all" })
      ).toEqual(["mt-4", "p-4", "bg-red-500"])
    })
  })

  describe("space around an element", () => {
    const contracts = [
      { pattern: "hlmBtn" },
      { pattern: "hlmTooltipTrigger" },
      { pattern: "hlmCardContent", allow: ["layout", "spacing"] },
      { pattern: "hlmCard", allow: [] },
    ]
    const around = (code: string, multipleContracts = "any") =>
      lint(code, { allow: ["layout"], contracts, multipleContracts }).map((m) =>
        /use (.*) for space around it|For space around it, use (.*)\./
          .exec(m.message)!
          .slice(1)
          .find(Boolean)
      )

    it("goes on an element around it whose contracts take the class", () => {
      expect(
        around(`<div hlmCardContent><button hlmBtn class="p-4"></button></div>`)
      ).toEqual(["margin here or spacing on <div hlmCardContent>"])
      expect(
        around(
          `<div hlmCardContent><section><button hlmBtn class="p-4"></button></section></div>`
        )
      ).toEqual([
        "margin here, gap on the parent, or spacing on <div hlmCardContent>",
      ])
    })

    it("names the name on it whose contract takes the class", () => {
      const code = `<div hlmTooltipTrigger hlmCardContent><button hlmBtn class="p-4"></button></div>`
      expect(around(code)).toEqual([
        "margin here or spacing on <div hlmCardContent>",
      ])
      // With all, an element takes it only when every contract does.
      expect(around(code, "all")).toEqual([
        "margin here or gap on a plain wrapper around it",
      ])
      expect(
        around(
          `<div hlmCardContent><button hlmBtn class="p-4"></button></div>`,
          "all"
        )
      ).toEqual(["margin here or spacing on <div hlmCardContent>"])
    })

    it("never on a parent whose contracts refuse it", () => {
      expect(
        around(`<div hlmCard><button hlmBtn class="p-4"></button></div>`)
      ).toEqual(["margin here or gap on a plain wrapper around it"])
    })

    it("past an ng-container, which renders nothing", () => {
      expect(
        around(
          `<div hlmCardContent><ng-container><button hlmBtn class="p-4"></button></ng-container></div>`
        )
      ).toEqual(["margin here or spacing on <div hlmCardContent>"])
    })
  })

  it("reads an inline template the processor hands over", () => {
    const file = path.join(PROJECT, "src/app/inline-restyle.component.ts")
    const code = [
      `import { Component } from "@angular/core"`,
      `@Component({ selector: "app-x", template: \`<button hlmBtn class="bg-red-500"></button>\` })`,
      `export class X {}`,
    ].join("\n")
    const found = new Linter({ cwd: PROJECT }).verify(
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
          rules: {
            "shadcn/no-restyle": [
              "error",
              { allow: ["layout"], contracts: [{ pattern: "hlmBtn" }] },
            ],
          } as any,
        },
      ],
      { filename: file, filterCodeBlock: () => true }
    )
    expect(found.map((m) => [m.message.split('"')[1], m.line])).toEqual([
      ["bg-red-500", 2],
    ])
  })
})

// The directive a matched name stands for is found the way the compiler
// finds it: the template's component, its standalone imports followed
// through tsconfig paths and barrels, the selector each declares.
describe("variants of the directive a name stands for", () => {
  const DIRECTIVES = path.resolve(PROJECT, "../angular-directives")
  const PAGE = path.join(DIRECTIVES, "src/app/page.component.html")
  const options = {
    allow: ["layout"],
    contracts: [{ pattern: "/^(ui|app)/" }, { pattern: "ui-card" }],
  }
  const lintAt = (
    code: string,
    filename = PAGE,
    settings = options,
    shared: Record<string, unknown> = {}
  ) =>
    new Linter({ cwd: DIRECTIVES })
      .verify(
        code,
        [
          {
            files: ["**/*.html"],
            languageOptions: { parser: ngParser as any },
            plugins: { shadcn: plugin as any },
            settings: { shadcn: shared },
            rules: { "shadcn/no-restyle": ["error", settings] } as any,
          },
        ],
        { filename }
      )
      .map((m) => m.message)

  const fallback = (tag: string) =>
    `"bg-pink-500" is not allowed on <${tag}>: <${tag}> owns its color. Use one of its variants. Add a new variant only if the design explicitly calls for a treatment none of them provides.`

  it("lists the variants of a directive imported through an array a library exports", () => {
    expect(
      lintAt(`<button uiBtn class="bg-pink-500 px-8">Save</button>`)
    ).toEqual([
      '"bg-pink-500" is not allowed on <button uiBtn>: <button uiBtn> owns its color. Use a variant: default, outline, ghost. Add a new variant in libs/ui/button/src/lib/ui-button.ts only if the design explicitly calls for a treatment none of these provides.',
      '"px-8" is not allowed on <button uiBtn>: <button uiBtn> owns its spacing. Use a size (default, sm, lg), or margin here or gap on the parent for space around it. Add a size in libs/ui/button/src/lib/ui-button.ts only if the design explicitly calls for one.',
    ])
  })

  it("tells a component by its tag and a directive by its attribute", () => {
    expect(
      lintAt(
        `<ui-card class="rounded-none"><div uiCardContent class="p-8"></div></ui-card>`
      )
    ).toEqual([
      '"rounded-none" is not allowed on <ui-card>: <ui-card> owns its shape. Use a variant: default, outline. Add a new variant in libs/ui/card/src/lib/ui-card.ts only if the design explicitly calls for a treatment none of these provides.',
      // <ui-card> is checked too, and takes no spacing.
      '"p-8" is not allowed on <div uiCardContent>: <div uiCardContent> owns its spacing. Use a size (default, sm), or margin here or gap on a plain wrapper around it for space around it. Add a size in libs/ui/card/src/lib/ui-card.ts only if the design explicitly calls for one.',
    ])
  })

  it("follows a relative import, and a binding the selector matches", () => {
    expect(
      lintAt(
        `<span appBadge class="bg-pink-500"></span><a [uiBtn]="on" class="bg-pink-500"></a>`
      )
    ).toEqual([
      '"bg-pink-500" is not allowed on <span appBadge>: <span appBadge> owns its color. Use a variant: default, muted. Add a new variant in src/app/badge.directive.ts only if the design explicitly calls for a treatment none of these provides.',
      '"bg-pink-500" is not allowed on <a uiBtn>: <a uiBtn> owns its color. Use a variant: default, outline, ghost. Add a new variant in libs/ui/button/src/lib/ui-button.ts only if the design explicitly calls for a treatment none of these provides.',
    ])
  })

  it("names the directive, not an input written before it that a pattern also matches", () => {
    expect(
      lintAt(`<button [uiBtnTone]="tone" uiBtn class="bg-pink-500"></button>`)
    ).toEqual([
      '"bg-pink-500" is not allowed on <button uiBtn>: <button uiBtn> owns its color. Use a variant: default, outline, ghost. Add a new variant in libs/ui/button/src/lib/ui-button.ts only if the design explicitly calls for a treatment none of these provides.',
    ])
  })

  it("names the directive that styles the element, not a trigger beside it", () => {
    expect(
      lintAt(
        `<button uiPopoverTrigger uiBtn class="bg-pink-500"></button><button uiPopoverTrigger class="bg-pink-500"></button>`
      )
    ).toEqual([
      '"bg-pink-500" is not allowed on <button uiBtn>: <button uiBtn> owns its color. Use a variant: default, outline, ghost. Add a new variant in libs/ui/button/src/lib/ui-button.ts only if the design explicitly calls for a treatment none of these provides.',
    ])
  })

  // spartan's HlmDropdownMenuTrigger hosts the CDK's CdkMenuTrigger, whose
  // host labels the element cdk-menu-trigger: it styles the element too,
  // and has no variants to offer. hlmBtn's cva has.
  it("names the directive whose cva gives variants, before another that styles the element", () => {
    expect(
      lintAt(
        `<button [uiDropdownMenuTrigger]="menu" uiBtn class="bg-red-500"></button><button [uiDropdownMenuTrigger]="menu" class="bg-red-500"></button>`
      )
    ).toEqual([
      '"bg-red-500" is not allowed on <button uiBtn>: <button uiBtn> owns its color. Use a variant: default, outline, ghost. Add a new variant in libs/ui/button/src/lib/ui-button.ts only if the design explicitly calls for a treatment none of these provides.',
      '"bg-red-500" is not allowed on <button uiDropdownMenuTrigger>: <button uiDropdownMenuTrigger> owns its color. Add a variant to <button uiDropdownMenuTrigger> only if the design explicitly calls for this treatment.',
    ])
  })

  // spartan's HlmTooltip has a cva in its file, which places the arrow of
  // the tooltip it opens: no variant or size of the element it is on.
  it("takes no cva that gives the element no variant or size for one that does", () => {
    expect(
      lintAt(`<input uiInput class="bg-pink-500" [uiTooltip]="tip" />`)
    ).toEqual([
      '"bg-pink-500" is not allowed on <input uiInput>: <input uiInput> owns its color. Add a variant to <input uiInput> only if the design explicitly calls for this treatment.',
    ])
  })

  // Material's MatMenu takes its element's class into panelClass, under
  // the public name class, and puts it on its panel; spartan's brain
  // overlays take it into className. A host that exposes such an input
  // takes the class too; one that hosts it unexposed does not.
  it("an input whose public name is class makes a directive one that styles", () => {
    const tags = (code: string) =>
      lintAt(code).map((message) => /<([^>]+)>/.exec(message)![1])
    expect(
      tags(
        [
          `<ui-menu class="bg-pink-500"></ui-menu>`,
          `<ui-sheet class="bg-pink-500"></ui-sheet>`,
          `<ui-toast class="bg-pink-500"></ui-toast>`,
          `<ui-dialog class="bg-pink-500"></ui-dialog>`,
          `<ui-drawer class="bg-pink-500"></ui-drawer>`,
        ].join("")
      )
    ).toEqual(["ui-menu", "ui-sheet", "ui-toast", "ui-dialog"])
    // An input whose public name cannot be read may be class.
    expect(tags(`<ui-opaque class="bg-pink-500"></ui-opaque>`)).toEqual([
      "ui-opaque",
    ])
  })

  it("takes any cva in a file that declares no other directive", () => {
    expect(lintAt(`<button uiToggle class="bg-pink-500"></button>`)).toEqual([
      '"bg-pink-500" is not allowed on <button uiToggle>: <button uiToggle> owns its color. Use a variant: default, outline. Add a new variant in libs/ui/toggle/src/lib/ui-toggle.ts only if the design explicitly calls for a treatment none of these provides.',
    ])
  })

  it("a call to a mergeFunctions helper makes a directive one that styles", () => {
    const named = (shared: Record<string, unknown>) =>
      lintAt(
        `<button uiPopoverTrigger uiChip class="bg-pink-500"></button>`,
        PAGE,
        options,
        shared
      ).map((message) => /<([^>]+)>/.exec(message)![1])
    expect(named({ mergeFunctions: ["hlm"] })).toEqual(["button uiChip"])
    expect(named({})).not.toEqual(["button uiChip"])
  })

  // spartan's HlmTooltip calls hlm in its providers and at module level,
  // for the tooltip it opens. Only its class body styles its element: the
  // constructor, a field's initializer, a method.
  it("counts a mergeFunctions call in the directive's class body, not in its decorator or module", () => {
    const tags = (code: string, shared: Record<string, unknown>) =>
      lintAt(code, PAGE, options, shared).map(
        (message) => /<([^>]+)>/.exec(message)![1]
      )
    const hlm = { mergeFunctions: ["hlm"] }
    expect(
      tags(`<button uiTooltip class="bg-pink-500"></button>`, hlm)
    ).toEqual([])
    expect(
      tags(
        `<div uiAlert class="bg-pink-500"></div><div uiBanner class="bg-pink-500"></div>`,
        hlm
      )
    ).toEqual(["div uiAlert", "div uiBanner"])
    // classes() styles the element whatever the helpers.
    expect(
      tags(
        `<div uiAlert class="bg-pink-500"></div><div uiBanner class="bg-pink-500"></div>`,
        {}
      )
    ).toEqual(["div uiAlert"])
  })

  // A broad pattern, /^ui/, also matches directives that only behave: a
  // trigger, a tooltip. Their element is no design-system component.
  it("leaves alone an element only directives that style nothing name", () => {
    expect(
      lintAt(
        `<button uiPopoverTrigger class="bg-pink-500"></button><button uiPopoverTrigger uiChip class="bg-pink-500"></button>`
      )
    ).toEqual([])
    // A name no imported directive stands for may be one that styles.
    expect(
      lintAt(`<div uiPopoverTrigger appCard class="bg-pink-500"></div>`)
    ).toEqual([
      '"bg-pink-500" is not allowed on <div uiPopoverTrigger>: <div uiPopoverTrigger> owns its color. Add a variant to <div uiPopoverTrigger> only if the design explicitly calls for this treatment.',
    ])
    // A directive added to a tag, ui-select[multiple], is not the
    // component the tag stands for.
    expect(
      lintAt(`<ui-select multiple class="bg-pink-500"></ui-select>`)
    ).toEqual([fallback("ui-select")])
    // Nor is such an element a closed parent for space around another.
    expect(
      lintAt(`<div uiPopoverTrigger><button uiBtn class="px-8"></button></div>`)
    ).toEqual([
      '"px-8" is not allowed on <button uiBtn>: <button uiBtn> owns its spacing. Use a size (default, sm, lg), or margin here or gap on the parent for space around it. Add a size in libs/ui/button/src/lib/ui-button.ts only if the design explicitly calls for one.',
    ])
  })

  // A component draws itself in its template, the way <Card className>
  // renders its own markup in React: it is judged whether or not it puts
  // classes on its element.
  it("judges a component that styles nothing on its element", () => {
    expect(
      lintAt(
        `<ui-panel class="bg-pink-500"></ui-panel><button uiFab class="bg-pink-500"></button><button uiFab uiPopoverTrigger class="bg-pink-500"></button>`
      )
    ).toEqual([
      '"bg-pink-500" is not allowed on <ui-panel>: <ui-panel> owns its color. Add a variant to <ui-panel> only if the design explicitly calls for this treatment.',
      '"bg-pink-500" is not allowed on <button uiFab>: <button uiFab> owns its color. Add a variant to <button uiFab> only if the design explicitly calls for this treatment.',
      '"bg-pink-500" is not allowed on <button uiFab>: <button uiFab> owns its color. Add a variant to <button uiFab> only if the design explicitly calls for this treatment.',
    ])
    // Nor is it a plain parent for space around an element inside it.
    expect(
      lintAt(`<ui-panel><button uiBtn class="px-8"></button></ui-panel>`)
    ).toEqual([
      '"px-8" is not allowed on <button uiBtn>: <button uiBtn> owns its spacing. Use a size (default, sm, lg), or margin here or gap on a plain wrapper around it for space around it. Add a size in libs/ui/button/src/lib/ui-button.ts only if the design explicitly calls for one.',
    ])
  })

  it("names no file that holds no cva", () => {
    expect(lintAt(`<input uiInput class="bg-pink-500" />`)).toEqual([
      '"bg-pink-500" is not allowed on <input uiInput>: <input uiInput> owns its color. Add a variant to <input uiInput> only if the design explicitly calls for this treatment.',
    ])
  })

  // spartan's HlmInputGroupButton takes its variant from the HlmButton
  // it hosts, and keeps its own sizes.
  it("reads the variants of the directives a directive hosts", () => {
    expect(
      lintAt(
        `<button uiInputGroupButton class="bg-pink-500 px-8"></button><button uiInputGroupAction class="bg-pink-500 px-8"></button>`
      )
    ).toEqual([
      '"bg-pink-500" is not allowed on <button uiInputGroupButton>: <button uiInputGroupButton> owns its color. Use a variant: default, outline, ghost. Add a new variant in libs/ui/button/src/lib/ui-button.ts only if the design explicitly calls for a treatment none of these provides.',
      '"px-8" is not allowed on <button uiInputGroupButton>: <button uiInputGroupButton> owns its spacing. Use a size (xs, sm), or margin here or gap on the parent for space around it. Add a size in libs/ui/input-group/src/lib/ui-input-group-button.ts only if the design explicitly calls for one.',
      '"bg-pink-500" is not allowed on <button uiInputGroupAction>: <button uiInputGroupAction> owns its color. Use a variant: default, outline, ghost. Add a new variant in libs/ui/button/src/lib/ui-button.ts only if the design explicitly calls for a treatment none of these provides.',
      '"px-8" is not allowed on <button uiInputGroupAction>: <button uiInputGroupAction> owns its spacing. Use a size (default, sm, lg), or margin here or gap on the parent for space around it. Add a size in libs/ui/button/src/lib/ui-button.ts only if the design explicitly calls for one.',
    ])
  })

  it("reads an inline template's own component", () => {
    const file = path.join(DIRECTIVES, "src/app/inline.component.ts")
    const code = fs.readFileSync(file, "utf8")
    const found = new Linter({ cwd: DIRECTIVES }).verify(
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
          rules: { "shadcn/no-restyle": ["error", options] } as any,
        },
      ],
      { filename: file, filterCodeBlock: () => true }
    )
    expect(found.map((m) => m.message)).toEqual([
      '"bg-pink-500" is not allowed on <button uiBtn>: <button uiBtn> owns its color. Use a variant: default, outline, ghost. Add a new variant in libs/ui/button/src/lib/ui-button.ts only if the design explicitly calls for a treatment none of these provides.',
    ])
  })

  it("falls back to the message without variants when no imported selector matches", () => {
    // uiBtn selects a button or a link, and the page imports no appCard.
    expect(
      lintAt(
        `<div uiBtn class="bg-pink-500"></div><div appCard class="bg-pink-500"></div>`
      )
    ).toEqual([fallback("div uiBtn"), fallback("div appCard")])
  })

  it("falls back for a component an NgModule declares", () => {
    expect(
      lintAt(
        `<button uiBtn class="bg-pink-500"></button>`,
        path.join(DIRECTIVES, "src/app/legacy.component.html")
      )
    ).toEqual([fallback("button uiBtn")])
  })

  it("falls back without the compiler", () => {
    setAngularCompilerForTests(null)
    try {
      expect(lintAt(`<button uiBtn class="bg-pink-500"></button>`)).toEqual([
        fallback("button uiBtn"),
      ])
    } finally {
      setAngularCompilerForTests(undefined)
    }
  })

  it("a contract's words read the directive's variants", () => {
    expect(
      lintAt(`<button uiBtn class="px-8 bg-pink-500"></button>`, PAGE, {
        ...options,
        message: {
          spacing: "Use a {{component}} size: {{sizes|none defined}}.",
          default: "Use a {{component}} variant: {{variants|none defined}}.",
        },
      } as any)
    ).toEqual([
      "Use a button uiBtn size: default, sm, lg.",
      "Use a button uiBtn variant: default, outline, ghost.",
    ])
  })
})

// Nx keeps the workspace's paths in a root tsconfig.base.json, with no
// tsconfig.json beside it: an import through them is followed, so a
// directive that styles nothing is known for one.
describe("a directive imported through an Nx tsconfig.base.json", () => {
  let root: string
  function write(name: string, source: string) {
    const file = path.join(root, name)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, source)
    return file
  }
  beforeEach(() => {
    root = fs.realpathSync.native(
      fs.mkdtempSync(path.join(os.tmpdir(), "shadcn-lint-nx-angular-"))
    )
    write("package.json", "{}")
    write(
      "tsconfig.base.json",
      JSON.stringify({
        compilerOptions: {
          baseUrl: ".",
          paths: { "@acme/ui/tooltip": ["libs/ui/tooltip/src/index.ts"] },
        },
      })
    )
    write("libs/ui/tooltip/src/index.ts", `export * from "./lib/ui-tooltip"\n`)
    write(
      "libs/ui/tooltip/src/lib/ui-tooltip.ts",
      [
        `import { Directive, input } from "@angular/core"`,
        `@Directive({ selector: "[uiTooltip]" })`,
        `export class UiTooltip {`,
        `  readonly uiTooltip = input("")`,
        `}`,
      ].join("\n")
    )
    write(
      "apps/web/src/app/page.component.ts",
      [
        `import { Component } from "@angular/core"`,
        `import { UiTooltip } from "@acme/ui/tooltip"`,
        `@Component({ selector: "app-page", templateUrl: "./page.component.html", imports: [UiTooltip] })`,
        `export class PageComponent {}`,
      ].join("\n")
    )
  })
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

  // `nx run-many -t lint` runs ESLint in the app's directory, and the
  // directive's file lies past it.
  it("names a file of another project from the workspace's root", () => {
    write("nx.json", "{}")
    write(
      "tsconfig.base.json",
      JSON.stringify({
        compilerOptions: {
          baseUrl: ".",
          paths: { "@acme/ui/badge": ["libs/ui/badge/src/index.ts"] },
        },
      })
    )
    write("libs/ui/badge/src/index.ts", `export * from "./lib/ui-badge"\n`)
    write(
      "libs/ui/badge/src/lib/ui-badge.ts",
      [
        `import { Directive } from "@angular/core"`,
        `import { cva } from "class-variance-authority"`,
        `const badgeVariants = cva("px-2", { variants: { variant: { default: "bg-primary", outline: "border" } } })`,
        `@Directive({ selector: "[uiBadge]", host: { "[class]": "classes" } })`,
        `export class UiBadge { classes = badgeVariants() }`,
      ].join("\n")
    )
    write(
      "apps/web/src/app/badge.component.ts",
      [
        `import { Component } from "@angular/core"`,
        `import { UiBadge } from "@acme/ui/badge"`,
        `@Component({ selector: "app-badge", templateUrl: "./badge.component.html", imports: [UiBadge] })`,
        `export class BadgeComponent {}`,
      ].join("\n")
    )
    expect(
      lint(
        `<span uiBadge class="bg-red-500"></span>`,
        { allow: ["layout"], contracts: [{ pattern: "/^ui/" }] },
        path.join(root, "apps/web/src/app/badge.component.html"),
        path.join(root, "apps/web")
      ).map((m) => m.message)
    ).toEqual([
      '"bg-red-500" is not allowed on <span uiBadge>: <span uiBadge> owns its color. Use a variant: default, outline. Add a new variant in libs/ui/badge/src/lib/ui-badge.ts only if the design explicitly calls for a treatment none of these provides.',
    ])
  })

  it("leaves an element only a directive that styles nothing names alone", () => {
    const code = `<div uiTooltip="Hi" class="bg-red-500"></div>`
    expect(
      lint(
        code,
        { allow: ["layout"], contracts: [{ pattern: "/^ui/" }] },
        path.join(root, "apps/web/src/app/page.component.html"),
        root
      )
    ).toEqual([])
  })
})

// An editor's ESLint server lives as long as the session, so the sources a
// template's scope reaches are kept as what is read of them, not as trees.
describe("what is kept of a directive's source", () => {
  it("keeps decorators, members' keys and calls, and what the body calls", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shadcn-ng-kept-"))
    const file = path.join(dir, "ui-thing.ts")
    fs.writeFileSync(
      file,
      [
        `import { Directive, input } from "@angular/core"`,
        `import { cva } from "class-variance-authority"`,
        `export const variants = cva("p-4", { variants: { size: { sm: "p-2" } } })`,
        `export const IMPORTS = [UiThing] as const`,
        `export const SELECTOR = "[uiThing]"`,
        `@Directive({ selector: SELECTOR })`,
        `export class UiThing {`,
        `  readonly size = input("sm", { alias: "uiSize" })`,
        `  constructor() { classes(() => hlm(variants())) }`,
        `  update() { if (this.size()) { console.log(new HostAttributeToken(name)) } }`,
        `}`,
      ].join("\n")
    )
    try {
      const kept = cachedDeclarationForTests(file, "UiThing")
      expect(kept.decorators).toHaveLength(1)
      expect([...kept.styling.calls].sort()).toEqual([
        "classes",
        "console.log",
        "hlm",
        "input",
        "variants",
      ])
      expect(kept.styling.tokens).toEqual([null])
      // Members keep no bodies, and of the call a field is initialized
      // with only its callee and what an alias is read from.
      for (const member of kept.body.body)
        expect(member.value?.body).toBe(undefined)
      expect(kept.body.body[0].value.arguments.map((a: any) => a.type)).toEqual(
        ["Literal", "ObjectExpression"]
      )
      expect(cachedDeclarationForTests(file, "variants")).toEqual({
        type: "CallExpression",
      })
      expect(cachedDeclarationForTests(file, "IMPORTS").type).toBe(
        "TSAsExpression"
      )
      expect(cachedDeclarationForTests(file, "SELECTOR").value).toBe(
        "[uiThing]"
      )
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})

// hostDirectives that meet again, or come back, are read once each.
describe("hostDirectives that branch and loop", () => {
  let root: string
  const write = (name: string, source: string) => {
    const file = path.join(root, name)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, source)
  }
  // d0 hosts d1 three times, d1 hosts d2 so, …, and the last hosts d0:
  // 3^14 paths through 15 directives, within the depth hosts are read to.
  const ladder = (dir: string, lastHost: string) => {
    const lines = [`import { Directive } from "@angular/core"`]
    const n = 14
    lines.push(
      `@Directive({ selector: "[d${n}]", hostDirectives: [D0]${lastHost} })`,
      `export class D${n} {}`
    )
    for (let i = n - 1; i >= 0; i--) {
      lines.push(
        `@Directive({ selector: "[d${i}]", hostDirectives: [D${i + 1}, { directive: D${i + 1} }, D${i + 1}] })`,
        `export class D${i} {}`
      )
    }
    write(`${dir}/ladder.ts`, lines.join("\n"))
    write(
      `${dir}/page.component.ts`,
      [
        `import { Component } from "@angular/core"`,
        `import { D0 } from "./ladder"`,
        `@Component({ selector: "app-page", templateUrl: "./page.component.html", imports: [D0] })`,
        `export class PageComponent {}`,
      ].join("\n")
    )
  }
  beforeEach(() => {
    root = fs.realpathSync.native(
      fs.mkdtempSync(path.join(os.tmpdir(), "shadcn-lint-ladder-"))
    )
    write("package.json", "{}")
  })
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

  const judged = (dir: string) => {
    const started = performance.now()
    const messages = lint(
      `<div d0 class="bg-red-500"></div>`,
      { allow: ["layout"], contracts: [{ pattern: "d0" }] },
      path.join(root, dir, "page.component.html"),
      root
    ).map((m) => m.message.split('"')[1])
    return { messages, ms: performance.now() - started }
  }

  it("reads each once, whether or not one styles the element", () => {
    ladder("plain", "")
    ladder("styled", `, host: { class: "d-styled" }`)
    const plain = judged("plain")
    expect(plain.messages).toEqual([])
    expect(plain.ms).toBeLessThan(1500)
    const styled = judged("styled")
    expect(styled.messages).toEqual(["bg-red-500"])
    expect(styled.ms).toBeLessThan(1500)
  })
})

// A directive styles its element by what lands on the element's class:
// `class`, `[class]`, `[class.x]`, `[attr.class]` and `[className]`, the
// ones a template's element takes, in its own host or one it inherits.
describe("what makes a directive one that styles its element", () => {
  let root = ""
  const write = (file: string, text: string) => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
    fs.writeFileSync(path.join(root, file), text)
  }
  beforeEach(() => {
    root = fs.realpathSync.native(
      fs.mkdtempSync(path.join(os.tmpdir(), "shadcn-lint-styles-host-"))
    )
    write("package.json", "{}")
    write(
      "node_modules/kit/package.json",
      JSON.stringify({
        name: "kit",
        version: "1.0.0",
        exports: { ".": { types: "./index.d.ts", default: "./index.mjs" } },
      })
    )
    const dts = (name: string, selector: string, base = "") =>
      `export declare class ${name}${base} { static ɵdir: i0.ɵɵDirectiveDeclaration<${name}, ${selector}, never, {}, {}, never, never, true, never>; }`
    write(
      "node_modules/kit/index.d.ts",
      [
        `import * as i0 from "@angular/core";`,
        dts("KitStyled", `never`),
        dts("KitPlain", `never`),
        dts("KitAttrClass", `"[kitAttrClass]"`),
        dts("KitClassName", `"[kitClassName]"`),
        dts("KitPlainSub", `"[kitPlainSub]"`, " extends KitPlain"),
        // Classes Angular does not declare: a helper, an @Injectable such
        // as NgRx's ComponentStore, and those that extend a directive.
        `export declare class KitHelper { destroy(): void; static ɵprov: i0.ɵɵInjectableDeclaration<KitHelper>; }`,
        `export declare abstract class KitAbstractPlain<T> { value: T }`,
        `export declare class KitHelperOverStyled extends KitStyled { }`,
        `export declare class KitHelperOverPlain extends KitPlain { }`,
        // A declaration this cannot read, and a base it cannot follow.
        `export declare class KitUnread { static ɵdir: i0.ɵɵDirectiveDeclaration<KitUnread>; }`,
        `declare const KitMixedBase: typeof KitPlain;`,
        `export declare class KitMixed extends KitMixedBase { }`,
      ].join("\n")
    )
    const mjs = (name: string, extra: string) =>
      `export class ${name} { static ɵdir = i0.ɵɵngDeclareDirective({ minVersion: "14.0.0", version: "20.0.0", type: ${name}, isStandalone: true${extra}, ngImport: i0 }) }`
    write(
      "node_modules/kit/index.mjs",
      [
        `import * as i0 from "@angular/core";`,
        mjs("KitStyled", `, host: { classAttribute: "kit" }`),
        mjs("KitPlain", ""),
        mjs(
          "KitAttrClass",
          `, selector: "[kitAttrClass]", host: { properties: { "attr.class": "c" } }`
        ),
        mjs(
          "KitClassName",
          `, selector: "[kitClassName]", host: { properties: { "className": "c" } }`
        ),
        mjs(
          "KitPlainSub",
          `, selector: "[kitPlainSub]", usesInheritance: true`
        ),
        `export class KitHelper { destroy() {} }`,
        `export class KitAbstractPlain {}`,
        `export class KitHelperOverStyled extends KitStyled {}`,
        `export class KitHelperOverPlain extends KitPlain {}`,
      ].join("\n")
    )
    write(
      "src/app/dirs.ts",
      [
        `import { Directive, HostBinding } from "@angular/core"`,
        `import { KitStyled, KitPlain } from "kit"`,
        `@Directive({})`,
        `export abstract class StyledBase { @HostBinding("class") cls = "inline-flex" }`,
        `@Directive({})`,
        `export abstract class PlainBase {}`,
        `@Directive({ selector: "[hlmSub]" })`,
        `export class HlmSub extends StyledBase {}`,
        `@Directive({ selector: "[hlmDeepSub]" })`,
        `export class HlmDeepSub extends HlmSub {}`,
        `@Directive({ selector: "[hlmPlainSub]" })`,
        `export class HlmPlainSub extends PlainBase {}`,
        `@Directive({ selector: "[hlmKitSub]" })`,
        `export class HlmKitSub extends KitStyled {}`,
        `@Directive({ selector: "[hlmKitPlainSub]" })`,
        `export class HlmKitPlainSub extends KitPlain {}`,
        `@Directive({ selector: "[hlmAttrClass]", host: { "[attr.class]": "c" } })`,
        `export class HlmAttrClass { c = "x" }`,
        `@Directive({ selector: "[hlmClassName]", host: { "[className]": "c" } })`,
        `export class HlmClassName { c = "x" }`,
        `@Directive({ selector: "[hlmBoundClassName]" })`,
        `export class HlmBoundClassName { @HostBinding("className") c = "x" }`,
        `@Directive({ selector: "[hlmBoundAttrClass]" })`,
        `export class HlmBoundAttrClass { @HostBinding("attr.class") c = "x" }`,
        `@Directive({ selector: "[hlmBoundTitle]" })`,
        `export class HlmBoundTitle { @HostBinding("attr.title") c = "x" }`,
      ].join("\n")
    )
    write(
      "src/app/lib-bases.ts",
      [
        `import { Directive } from "@angular/core"`,
        `import { KitHelper, KitAbstractPlain, KitHelperOverStyled, KitHelperOverPlain, KitUnread, KitMixed } from "kit"`,
        `export class LocalHelper extends KitHelper {}`,
        `@Directive({ selector: "[hlmLibHelper]" })`,
        `export class HlmLibHelper extends KitHelper {}`,
        `@Directive({ selector: "[hlmLibAbstract]" })`,
        `export class HlmLibAbstract extends KitAbstractPlain<string> {}`,
        `@Directive({ selector: "[hlmLocalHelper]" })`,
        `export class HlmLocalHelper extends LocalHelper {}`,
        `@Directive({ selector: "[hlmOverStyled]" })`,
        `export class HlmOverStyled extends KitHelperOverStyled {}`,
        `@Directive({ selector: "[hlmOverPlain]" })`,
        `export class HlmOverPlain extends KitHelperOverPlain {}`,
        `@Directive({ selector: "[hlmUnread]" })`,
        `export class HlmUnread extends KitUnread {}`,
        `@Directive({ selector: "[hlmMixed]" })`,
        `export class HlmMixed extends KitMixed {}`,
      ].join("\n")
    )
    write(
      "src/app/page.component.ts",
      [
        `import { Component } from "@angular/core"`,
        `import { KitAttrClass, KitClassName, KitPlainSub } from "kit"`,
        `import { HlmSub, HlmDeepSub, HlmPlainSub, HlmKitSub, HlmKitPlainSub, HlmAttrClass, HlmClassName, HlmBoundClassName, HlmBoundAttrClass, HlmBoundTitle } from "./dirs"`,
        `import { HlmLibHelper, HlmLibAbstract, HlmLocalHelper, HlmOverStyled, HlmOverPlain, HlmUnread, HlmMixed } from "./lib-bases"`,
        `@Component({ selector: "app-page", templateUrl: "./page.component.html", imports: [HlmSub, HlmDeepSub, HlmPlainSub, HlmKitSub, HlmKitPlainSub, HlmAttrClass, HlmClassName, HlmBoundClassName, HlmBoundAttrClass, HlmBoundTitle, KitAttrClass, KitClassName, KitPlainSub, HlmLibHelper, HlmLibAbstract, HlmLocalHelper, HlmOverStyled, HlmOverPlain, HlmUnread, HlmMixed] })`,
        `export class PageComponent {}`,
      ].join("\n")
    )
  })
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

  const judged = (names: string[]) =>
    lint(
      names.map((name) => `<div ${name} class="p-4"></div>`).join("\n"),
      { allow: ["layout"], contracts: [{ pattern: "/^(hlm|kit)/" }] },
      path.join(root, "src/app/page.component.html"),
      root
    ).map((m) => /<div (\w+)>/.exec(m.message)![1])

  it("is one whose class, or a class up its chain, puts a class on it", () => {
    expect(
      judged([
        "hlmSub",
        "hlmDeepSub",
        "hlmPlainSub",
        "hlmKitSub",
        "hlmKitPlainSub",
        "kitPlainSub",
      ])
    ).toEqual(["hlmSub", "hlmDeepSub", "hlmKitSub"])
  })

  // A host compiles into a component's or a directive's declaration, and
  // Angular's inheritance walks past the classes without one: a library's
  // helper, or an @Injectable such as NgRx's ComponentStore, adds nothing.
  it("passes a library's class Angular does not declare, to the class it extends", () => {
    expect(
      judged([
        "hlmLibHelper",
        "hlmLibAbstract",
        "hlmLocalHelper",
        "hlmOverStyled",
        "hlmOverPlain",
        "hlmUnread",
        "hlmMixed",
      ])
    ).toEqual(["hlmOverStyled", "hlmUnread", "hlmMixed"])
  })

  // In a template too: `[className]` sets the element's class, as
  // `[attr.class]` does.
  it("judges what a template binds to className on the element", () => {
    expect(
      lint(
        `<div hlmSub [className]="'bg-red-500'" [attr.class]="'rounded-full'" className="text-pink-500"></div>`,
        { allow: ["layout"], contracts: [{ pattern: "/^hlm/" }] },
        path.join(root, "src/app/page.component.html"),
        root
      ).map((m) => m.message.split('"')[1])
    ).toEqual(["bg-red-500", "rounded-full"])
  })

  it("is one that binds the element's class attribute or className", () => {
    expect(
      judged([
        "hlmAttrClass",
        "hlmClassName",
        "hlmBoundClassName",
        "hlmBoundAttrClass",
        "hlmBoundTitle",
        "kitAttrClass",
        "kitClassName",
      ])
    ).toEqual([
      "hlmAttrClass",
      "hlmClassName",
      "hlmBoundClassName",
      "hlmBoundAttrClass",
      "kitAttrClass",
      "kitClassName",
    ])
  })
})

// A cva axis written with a type on it, as angular-love writes
// `variant: <Record<AlButtonVariant, string>>{ … }`. In a React file it is
// read as upstream reads it.
describe("a cva axis with a type assertion", () => {
  const cva = (axis: (object: string) => string) =>
    [
      `const buttonVariants = cva("", { variants: {`,
      `  variant: ${axis(`{ solid: "", ghost: "" }`)},`,
      `  size: ${axis(`{ sm: "", lg: "" }`)},`,
      `} })`,
    ].join("\n")
  const wrappers: [string, (object: string) => string][] = [
    ["angle brackets", (object) => `<Record<string, string>>${object}`],
    ["as", (object) => `${object} as Record<string, string>`],
    ["satisfies", (object) => `${object} satisfies Record<string, string>`],
    ["parentheses and as const", (object) => `(${object} as const)`],
  ]
  let dir: string
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "shadcn-lint-cva-cast-"))
  })
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

  const axes = (file: string, source: string) => {
    fs.writeFileSync(path.join(dir, file), source)
    return variantDefinitionsOf(path.join(dir, file)).map((d) => d.axes)
  }

  for (const [name, wrap] of wrappers) {
    it(`is read through ${name} in an Angular file`, () => {
      expect(
        axes(
          `${name.replaceAll(" ", "-")}.ts`,
          `import { Directive } from "@angular/core"\n${cva(wrap)}`
        )
      ).toEqual([{ variant: ["solid", "ghost"], size: ["sm", "lg"] }])
    })
  }

  it("is read as upstream reads it in a React file", () => {
    expect(
      axes(
        "react.tsx",
        `import * as React from "react"\n${cva(wrappers[1][1])}`
      )
    ).toEqual([])
  })
})

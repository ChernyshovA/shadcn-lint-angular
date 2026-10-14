// no-restyle in Angular templates. A template imports nothing a tag
// could be resolved through, so a contract's pattern names the element
// by its tag and its attributes, the way angular-eslint's options name
// directives: `hlmBtn` is that name, `/^hlm/` a regex.

import * as fs from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import templatePlugin from "@angular-eslint/eslint-plugin-template"
import * as ngParser from "@angular-eslint/template-parser"
import tsParser from "@typescript-eslint/parser"
import { Linter } from "eslint"
import { describe, expect, it } from "vitest"

import { plugin } from "../src/plugin"
import { setAngularCompilerForTests } from "../src/sites/readers/angular-compiler"

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
      messages(`<div hlmCard class="card-header made-up"></div>`, options)
    ).toEqual([
      declared("card-header"),
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

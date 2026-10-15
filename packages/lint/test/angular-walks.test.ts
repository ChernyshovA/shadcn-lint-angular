// Every walk through Angular code meets each thing once, so it ends in
// time on the worst input it can be given: re-exports that loop back,
// constants that hold each other, host directives and classes that meet
// again. Its depth limit is only a guard.

import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import * as ngParser from "@angular-eslint/template-parser"
import { Linter } from "eslint"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { plugin } from "../src/plugin"
import { ownClassesOfCss } from "../src/project/angular-styles"
import { memoSizeForTests, TTL } from "../src/project/fs"
import { resetWarnings, setWarningSink } from "../src/project/warn"

// The longest a walk may take on its worst input, cold.
const LIMIT = 3000

let root = ""
beforeEach(() => {
  root = fs.realpathSync.native(
    fs.mkdtempSync(path.join(os.tmpdir(), "shadcn-lint-walks-"))
  )
})
afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

const write = (files: Record<string, string>) => {
  for (const [file, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
    fs.writeFileSync(path.join(root, file), text)
  }
}

const page = (imports: string, head: string[] = [], options = "") =>
  [
    `import { Component, Directive, NgModule } from "@angular/core"`,
    ...head,
    `@Component({ selector: "app-page", templateUrl: "./page.component.html"${imports ? `, imports: ${imports}` : ""}${options} })`,
    `export class PageComponent {}`,
  ].join("\n")

const restyled = (html: string) => {
  const filename = path.join(root, "src/app/page.component.html")
  fs.writeFileSync(filename, html)
  const started = performance.now()
  const messages = new Linter({ cwd: root }).verify(
    html,
    [
      {
        files: ["**/*.html"],
        languageOptions: { parser: ngParser as any },
        plugins: { shadcn: plugin as any },
        rules: {
          "shadcn/no-restyle": [
            "error",
            { allow: ["layout"], contracts: [{ pattern: "/^hlm/" }] },
          ],
        } as any,
      },
    ],
    { filename }
  )
  return {
    classes: messages.map((m) => m.message.split('"')[1]),
    ms: performance.now() - started,
  }
}

const STYLED = `@Directive({ selector: "[hlmStyled]", host: { class: "inline-flex" } })\nexport class HlmStyled {}`
const PLAIN = `@Directive({ selector: "[hlmPlain]" })\nexport class HlmPlain {}`

// An installed library: its .d.ts declares each directive, its bundle
// what each puts on its element.
const library = (name: string, files: Record<string, string>) => {
  write({
    [`node_modules/${name}/package.json`]: JSON.stringify({
      name,
      version: "1.0.0",
      exports: { ".": { types: "./index.d.ts", default: "./index.mjs" } },
    }),
    ...Object.fromEntries(
      Object.entries(files).map(([file, text]) => [
        `node_modules/${name}/${file}`,
        text,
      ])
    ),
  })
}

const dtsDirective = (name: string, selector: string) =>
  `import * as i0 from "@angular/core";\nexport declare class ${name} { static ɵdir: i0.ɵɵDirectiveDeclaration<${name}, "${selector}", never, {}, {}, never, never, true, never>; }\n`

const mjsDirective = (name: string, selector: string, extra = "") =>
  `export class ${name} { static ɵdir = i0.ɵɵngDeclareDirective({ minVersion: "14.0.0", version: "20.0.0", type: ${name}, isStandalone: true, selector: "${selector}"${extra}, ngImport: i0 }) }\n`

// Three files that each re-export all three.
const starLoop = (ext: string) =>
  Object.fromEntries(
    ["a", "b", "c"].map((name) => [
      `${name}${ext}`,
      ["a", "b", "c"]
        .map((to) => `export * from "./${to}${ext === ".mjs" ? ".mjs" : ""}";`)
        .join("\n"),
    ])
  )

describe("a library's re-exports", () => {
  it("are followed once each where `export *` loops, in its .d.ts and its bundle", () => {
    library("cyc", {
      ...starLoop(".d.ts"),
      ...starLoop(".mjs"),
      "index.d.ts": `export * from "./a";\nexport * from "./d";\n`,
      "index.mjs": `export * from "./a.mjs";\nexport * from "./d.mjs";\n`,
      "d.d.ts":
        dtsDirective("CycStyled", "[hlmCycStyled]") +
        dtsDirective("CycPlain", "[hlmCycPlain]").replace(/^import.*\n/, ""),
      "d.mjs":
        `import * as i0 from "@angular/core";\n` +
        mjsDirective(
          "CycStyled",
          "[hlmCycStyled]",
          `, host: { classAttribute: "cyc" }`
        ) +
        mjsDirective("CycPlain", "[hlmCycPlain]"),
    })
    write({
      "src/app/page.component.ts": page("[CycStyled, CycPlain, CycMissing]", [
        `import { CycStyled, CycPlain, CycMissing } from "cyc"`,
      ]),
    })
    const { classes, ms } = restyled(
      `<div hlmCycStyled class="p-4"></div><div hlmCycPlain class="p-2"></div>`
    )
    expect(classes).toEqual(["p-4"])
    expect(ms).toBeLessThan(LIMIT)
  })
})

describe("a component's scope", () => {
  it("reads each constant list once where lists hold each other", () => {
    write({
      "src/app/page.component.ts": page("[A, HlmStyled]", [
        STYLED,
        `const A: any[] = [B, B, B]`,
        `const B: any[] = [A, A, A]`,
      ]),
    })
    const { classes, ms } = restyled(`<div hlmStyled class="p-4"></div>`)
    expect(classes).toEqual(["p-4"])
    expect(ms).toBeLessThan(LIMIT)
  })

  it("reads each tuple a library's .d.ts declares once where they hold each other", () => {
    library("tup", {
      "index.d.ts":
        `export declare const A: readonly [typeof B, typeof B, typeof B];\n` +
        `export declare const B: readonly [typeof A, typeof A, typeof A];\n`,
      "index.mjs": "",
    })
    write({
      "src/app/page.component.ts": page("[A, HlmStyled]", [
        `import { A } from "tup"`,
        STYLED,
      ]),
    })
    const { classes, ms } = restyled(`<div hlmStyled class="p-4"></div>`)
    expect(classes).toEqual(["p-4"])
    expect(ms).toBeLessThan(LIMIT)
  })

  it("finds the module that declares the component past lists that hold each other", () => {
    write({
      "src/app/hlm.ts": `import { Directive } from "@angular/core"\n${STYLED}`,
      "src/app/page.component.ts": page("", [], `, standalone: false`),
      "src/app/page.module.ts": [
        `import { NgModule } from "@angular/core"`,
        `import { PageComponent } from "./page.component"`,
        `import { HlmStyled } from "./hlm"`,
        `const A: any[] = [B, B, B]`,
        `const B: any[] = [A, A, A]`,
        `@NgModule({ declarations: [A, PageComponent], imports: [HlmStyled] })`,
        `export class PageModule {}`,
      ].join("\n"),
    })
    const { classes, ms } = restyled(`<div hlmStyled class="p-4"></div>`)
    expect(classes).toEqual(["p-4"])
    expect(ms).toBeLessThan(LIMIT)
  })

  it("reads a selector built of constants once each, and none built of itself", () => {
    // Eight names, each of the next written sixteen times: "" in the end.
    const names = Array.from({ length: 8 }, (_, i) => `W${i}`)
    const head = names.map((name, i) =>
      i === names.length - 1
        ? `const ${name} = ""`
        : `const ${name} = \`${("${" + names[i + 1] + "}").repeat(16)}\``
    )
    write({
      "src/app/page.component.ts": page("[HlmWide, HlmSelf]", [
        ...head,
        `const S1 = \`[hlmSelf\${S2}\${S2}]\``,
        `const S2 = \`\${S1}\${S1}\``,
        `@Directive({ selector: \`[hlm\${W0}Wide]\`, host: { class: "inline-flex" } })`,
        `export class HlmWide {}`,
        `@Directive({ selector: S1 })`,
        `export class HlmSelf {}`,
      ]),
    })
    const { classes, ms } = restyled(
      `<div hlmWide class="p-4"></div><div hlmSelf class="p-2"></div>`
    )
    // A selector built of itself is not read: any element may be its.
    expect(classes).toEqual(["p-4", "p-2"])
    expect(ms).toBeLessThan(LIMIT)
  })
})

describe("a directive's host directives", () => {
  it("spread from lists that double at each level are read once each", () => {
    // L0 spreads L1 three times, L1 spreads L2 three times, and so on:
    // one host directive, reached 3^14 ways.
    const levels = Array.from({ length: 14 }, (_, i) =>
      i === 13
        ? `const L13 = [HlmPlain, HlmPlain, HlmPlain]`
        : `const L${i} = [...L${i + 1}, ...L${i + 1}, ...L${i + 1}]`
    )
    write({
      "src/app/page.component.ts": page("[HlmTower, HlmLoop]", [
        PLAIN,
        ...levels.reverse(),
        `@Directive({ selector: "[hlmTower]", hostDirectives: [...L0] })`,
        `export class HlmTower {}`,
        `const C1: any[] = [...C2, ...C2]`,
        `const C2: any[] = [...C1, ...C1]`,
        `@Directive({ selector: "[hlmLoop]", hostDirectives: C1 })`,
        `export class HlmLoop {}`,
      ]),
    })
    const { classes, ms } = restyled(
      `<div hlmTower class="p-4"></div><div hlmLoop class="p-2"></div>`
    )
    // A list that spreads itself is no list a build evaluates: what it
    // hosts is not known, and the element may be styled.
    expect(classes).toEqual(["p-2"])
    expect(ms).toBeLessThan(LIMIT)
  })

  it("a library's bundle declares are read once each where they meet", () => {
    // D0 hosts D1 three times, D1 hosts D2 three times, …
    const depth = 15
    const mjs = Array.from({ length: depth + 1 }, (_, i) =>
      mjsDirective(
        `D${i}`,
        `[hlmD${i}]`,
        i === depth
          ? ""
          : `, hostDirectives: [{ directive: D${i + 1} }, { directive: D${i + 1} }, { directive: D${i + 1} }]`
      )
    ).reverse()
    library("deep", {
      "index.d.ts": dtsDirective("D0", "[hlmDeep]"),
      "index.mjs":
        `import * as i0 from "@angular/core";\n` +
        mjs.join("").replace(`selector: "[hlmD0]"`, `selector: "[hlmDeep]"`),
    })
    write({
      "src/app/page.component.ts": page("[D0]", [`import { D0 } from "deep"`]),
    })
    const { classes, ms } = restyled(`<div hlmDeep class="p-4"></div>`)
    expect(classes).toEqual([])
    expect(ms).toBeLessThan(LIMIT)
  })
})

describe("the classes a directive extends", () => {
  it("end where they loop, in the project and in a library", () => {
    library("loop", {
      "index.d.ts":
        `import * as i0 from "@angular/core";\n` +
        `export declare class LibA extends LibB { static ɵdir: i0.ɵɵDirectiveDeclaration<LibA, "[hlmLibA]", never, { "x": { "alias": "x"; "required": false; }; }, {}, never, never, true, never>; }\n` +
        `export declare class LibB extends LibA { static ɵdir: i0.ɵɵDirectiveDeclaration<LibB, never, never, {}, {}, never, never, true, never>; }\n`,
      "index.mjs":
        `import * as i0 from "@angular/core";\n` +
        `export class LibA extends LibB { static ɵdir = i0.ɵɵngDeclareDirective({ minVersion: "14.0.0", version: "20.0.0", type: LibA, isStandalone: true, selector: "[hlmLibA]", usesInheritance: true, ngImport: i0 }) }\n` +
        `export class LibB extends LibA { static ɵdir = i0.ɵɵngDeclareDirective({ minVersion: "14.0.0", version: "20.0.0", type: LibB, isStandalone: true, usesInheritance: true, ngImport: i0 }) }\n`,
    })
    write({
      "src/app/page.component.ts": page("[HlmA, LibA]", [
        `import { LibA } from "loop"`,
        `@Directive({ selector: "[hlmA]" })`,
        `export class HlmA extends HlmB {}`,
        `@Directive({})`,
        `export class HlmB extends HlmA {}`,
      ]),
    })
    const { classes, ms } = restyled(
      `<div hlmA class="p-4" styleClass="m-4"></div><div hlmLibA class="px-2" styleClass="m-4"></div>`
    )
    expect(ms).toBeLessThan(LIMIT)
    // A chain that loops back is no class a build compiles: the inputs it
    // takes are not known, so either may take the element's class, and its
    // contract judges it. A styleClass is no class of the element's.
    expect(classes).toEqual(["p-4", "px-2"])
  })
})

describe("a stylesheet's nesting", () => {
  it("is read without multiplying out every selector it nests", () => {
    const started = performance.now()
    const own = ownClassesOfCss(
      ".a, .b {".repeat(22) + "&-tail { }" + "}".repeat(22) + ".own { }",
      path.join(root, "a.scss")
    )
    expect(performance.now() - started).toBeLessThan(LIMIT)
    expect(own.unread).toBe(null)
    expect(["a", "b", "a-tail", "b-tail", "own", "c"].filter(own.has)).toEqual([
      "a",
      "b",
      "a-tail",
      "b-tail",
      "own",
    ])
    // `&` in two compounds keeps to the first and the last.
    const siblings = ownClassesOfCss(
      `.a { ${"& + & {".repeat(24)} &-end { } ${"}".repeat(24)} }`,
      path.join(root, "a.scss")
    )
    expect(performance.now() - started).toBeLessThan(LIMIT)
    expect(siblings.unread).toBe(null)
    expect(["a", "a-end", "b"].filter(siblings.has)).toEqual(["a", "a-end"])
  })

  // A stylesheet of 2 MB, a line comment on every line, as a generated
  // theme writes one.
  it("has its comments taken out in time, however large", () => {
    let css = ""
    for (let i = 0; i < 20000; i++) {
      css += `// rule ${i} of a generated theme\n.c${i} { color: red; // trailing ${i}\n  background: url(//cdn.test/x${i}.png); }\n`
    }
    const started = performance.now()
    const own = ownClassesOfCss(css, path.join(root, "a.scss"))
    expect(performance.now() - started).toBeLessThan(LIMIT)
    expect(own.unread).toBe(null)
    expect(["c0", "c19999", "rule", "trailing", "x0"].filter(own.has)).toEqual([
      "c0",
      "c19999",
    ])
  })

  // `&` twice in one compound doubles the selector at each level, and
  // `&-x, &-y` doubles how many there are: what that comes to past a
  // bound is not read, as any selector this cannot read is not.
  it.each(["&:not(&)", ":is(&, &)", "&&", "&-x, &-y"])(
    "leaves unread what %s nested in itself multiplies out to",
    (rule) => {
      const started = performance.now()
      const own = ownClassesOfCss(
        `.a { ${`${rule} {`.repeat(24)} color: red; ${"}".repeat(24)} }`,
        path.join(root, "a.scss")
      )
      expect(performance.now() - started).toBeLessThan(LIMIT)
      expect(own.unread?.reason).toBe(
        `the selectors of its rules, nested in the rules around them, grow by more than 1000000 characters, at \`${rule}\``
      )
      expect(own.has("anything")).toBe(true)
    }
  )

  it("bounds what all the rules nested in a stylesheet come to", () => {
    const started = performance.now()
    let siblings = ""
    for (let i = 0; i < 4000; i++) siblings += `&.x${i} { color: red; }\n`
    const own = ownClassesOfCss(
      `.a { ${"&:not(&) {".repeat(13)} ${siblings} ${"}".repeat(13)} }`,
      path.join(root, "a.scss")
    )
    expect(performance.now() - started).toBeLessThan(LIMIT)
    expect(own.unread?.reason).toMatch(
      /^the selectors of its rules, nested in the rules around them, grow by more than 1000000 characters, at `&\.x\d+`$/
    )
  })

  // A vendor stylesheet of 2.9 MB, its rules side by side: none is
  // nested in another, so they grow by nothing however many there are.
  it("reads a large stylesheet of rules nested in none", () => {
    let css = ""
    for (let i = 0; css.length < 2_900_000; i++) {
      css += `.vendor-widget-${i} .vendor-widget-${i}__body, .vendor-widget-${i}--open > .vendor-row { display: block; }\n`
    }
    const started = performance.now()
    const own = ownClassesOfCss(css, path.join(root, "big.css"))
    expect(performance.now() - started).toBeLessThan(LIMIT)
    expect(own.unread).toBe(null)
    expect(["vendor-widget-0", "vendor-row", "zz"].filter(own.has)).toEqual([
      "vendor-widget-0",
      "vendor-row",
    ])
  })

  // Nested in one another, each `:host(` is part of the one around it.
  it("reads a selector of :host nested in itself in time", () => {
    const started = performance.now()
    const own = ownClassesOfCss(
      `${":host(".repeat(16000)}.a${")".repeat(16000)} .b { color: red }`,
      path.join(root, "a.scss")
    )
    expect(performance.now() - started).toBeLessThan(LIMIT)
    expect(own.unread).toBe(null)
    expect(["a", "b", "c"].filter(own.has)).toEqual(["a", "b"])
  })

  it("says once that a component's styles past the bound are not read", () => {
    const warnings: string[] = []
    resetWarnings()
    setWarningSink((message) => warnings.push(message))
    try {
      write({
        "package.json": "{}",
        "src/app/page.component.scss": `.a { ${"&:not(&) {".repeat(24)} } ${"}".repeat(23)} }`,
        "src/app/page.component.ts": page(
          "",
          [],
          `, styleUrl: "./page.component.scss"`
        ),
      })
      const filename = path.join(root, "src/app/page.component.html")
      const html = `<div class="a zz-unknown"></div>`
      fs.writeFileSync(filename, html)
      const started = performance.now()
      const messages = new Linter({ cwd: root }).verify(
        html,
        [
          {
            files: ["**/*.html"],
            languageOptions: { parser: ngParser as any },
            plugins: { shadcn: plugin as any },
            rules: { "shadcn/no-unknown-classes": "error" } as any,
          },
        ],
        { filename }
      )
      expect(performance.now() - started).toBeLessThan(LIMIT)
      expect(messages).toEqual([])
      expect(warnings.filter((w) => w.includes("The styles of"))).toEqual([
        "[shadcn-lint-angular] The styles of PageComponent in src/app/page.component.ts cannot be read: the selectors of its rules, nested in the rules around them, grow by more than 1000000 characters, at `&:not(&)` in src/app/page.component.scss. shadcn/no-unknown-classes is skipped in its template and in the classes of its element in others, since any class there may be one they declare.",
      ])
    } finally {
      setWarningSink((message) => console.warn(message))
    }
  })

  it("still glues & to the rule it is in, however deep", () => {
    const own = ownClassesOfCss(
      `.card { .body > .row { &-cell { } .x& { } @at-root .lifted { &-end { } } } }`,
      path.join(root, "a.scss")
    )
    const names = [
      "card",
      "body",
      "row",
      "row-cell",
      "x",
      "lifted",
      "lifted-end",
    ]
    expect(names.filter(own.has)).toEqual(names)
    expect(own.has("card-cell")).toBe(false)
  })
})

// An editor's ESLint server lints a file each time it is saved, for as
// long as the editor is open.
describe("a component saved again and again", () => {
  afterEach(() => vi.useRealTimers())

  it("keeps one answer for each of its files", () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    const files = (round: number) => ({
      "src/app/page.component.ts": page(
        "[HlmStyled]",
        [STYLED, `// save ${round}`],
        `, styleUrl: "./page.component.scss"`
      ),
      "src/app/page.component.scss": `.own-${round} { }`,
    })
    const lintOnce = (round: number) => {
      write(files(round))
      const at = new Date(Date.now())
      for (const file of Object.keys(files(round))) {
        fs.utimesSync(path.join(root, file), at, at)
      }
      fs.utimesSync(path.join(root, "src/app"), at, at)
      const filename = path.join(root, "src/app/page.component.html")
      fs.writeFileSync(filename, `<div hlmStyled class="own-${round}"></div>`)
      new Linter({ cwd: root }).verify(
        fs.readFileSync(filename, "utf8"),
        [
          {
            files: ["**/*.html"],
            languageOptions: { parser: ngParser as any },
            plugins: { shadcn: plugin as any },
            rules: {
              "shadcn/no-unknown-classes": "error",
              "shadcn/no-restyle": [
                "error",
                { allow: ["layout"], contracts: [{ pattern: "/^hlm/" }] },
              ],
            } as any,
          },
        ],
        { filename }
      )
      // Past the memo's second, as the next save is.
      vi.setSystemTime(Date.now() + 2 * TTL)
    }
    lintOnce(0)
    lintOnce(1)
    const kept = memoSizeForTests()
    for (let round = 2; round < 12; round++) lintOnce(round)
    expect(memoSizeForTests()).toBe(kept)
  })
})

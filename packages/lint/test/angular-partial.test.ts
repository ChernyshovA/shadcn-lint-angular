// What an installed Angular library's published JavaScript says its
// directives put on their element, read from the partial declarations
// the Angular linker reads: the ɵɵngDeclareDirective and
// ɵɵngDeclareComponent calls in its bundles, with their `host`,
// `hostDirectives` and `usesInheritance`. A directive that puts no class
// on its element leaves an element it alone names to be a plain one.

import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import * as ngParser from "@angular-eslint/template-parser"
import { Linter } from "eslint"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { plugin } from "../src/plugin"
import { dtsExport, resolveDts } from "../src/project/angular-dts"
import {
  compiledStyles,
  resetScriptFilesForTests,
  scriptFilesReadForTests,
} from "../src/project/angular-partial"
import { resetFsMemo } from "../src/project/fs"
import { resetWarnings, setWarningSink } from "../src/project/warn"

const LIBRARIES = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures/angular-libraries"
)
const COMPILED = path.join(LIBRARIES, "src/app/compiled")
const TEMPLATE = path.join(COMPILED, "compiled.component.html")

const contracts = (...patterns: string[]) => ({
  allow: ["layout"],
  contracts: patterns.map((pattern) => ({ pattern })),
})

// Each finding as the class and the element it names.
const findings = (code: string, options: unknown, cwd = LIBRARIES) =>
  new Linter({ cwd })
    .verify(
      code,
      [
        {
          files: ["**/*.html"],
          languageOptions: { parser: ngParser as any },
          plugins: { shadcn: plugin as any },
          rules: { "shadcn/no-restyle": ["error", options] } as any,
        },
      ],
      { filename: TEMPLATE }
    )
    .map(
      (m) =>
        `${m.message.split('"')[1]} on <${/<([^>]+)>/.exec(m.message)![1]}>`
    )

// Whether a library's class puts a class on its element, as the module
// of the entry point `spec` says.
const styles = (spec: string, name: string, from = TEMPLATE) => {
  const deps = new Set<string>()
  const file = resolveDts(spec, from)
  const found = file ? dtsExport(file, name, deps, { spec, from, name }) : null
  if (found?.kind !== "class" || !found.owner || !found.cls.directive) {
    return "no class"
  }
  return compiledStyles(
    found.owner,
    found.name,
    found.cls.directive.selector,
    deps
  )
}

describe("a library's directive on an element", () => {
  // spartan's brain, from npm: its triggers bind ids and listen to
  // clicks; BrnRadio's host is `class: "brn-radio"`.
  it("leaves alone an element only directives that put no class on it name", () => {
    expect(
      findings(
        `<button brnDialogTrigger class="bg-pink-500"></button><button brnDialogClose class="bg-pink-500"></button>`,
        contracts("/^brn/")
      )
    ).toEqual([])
  })

  it("judges an element a directive whose host puts a class on it names", () => {
    expect(
      findings(
        `<brn-radio value="a" class="bg-pink-500"></brn-radio>`,
        contracts("/^brn/")
      )
    ).toEqual(["bg-pink-500 on <brn-radio>"])
  })

  // brain's overlays take the element's class into className, under the
  // public name class, as their .d.ts declares, and put nothing on it in
  // their host. spartan's HlmDialogPortal exposes BrnDialogContent's.
  it("judges an element a directive that takes its class into an input names", () => {
    expect(
      findings(
        `<brn-dialog-overlay class="bg-pink-500"></brn-dialog-overlay><div brnDialogContent class="bg-pink-500"></div>`,
        contracts("/^brn/")
      )
    ).toEqual([
      "bg-pink-500 on <brn-dialog-overlay>",
      "bg-pink-500 on <div brnDialogContent>",
    ])
  })

  it("takes the class input of a library's directive a host exposes, not one it keeps", () => {
    expect(
      findings(
        `<div kitDialogContent class="bg-pink-500"></div><div kitDialogOverlay class="bg-pink-500"></div>`,
        contracts("/^kit/")
      )
    ).toEqual(["bg-pink-500 on <div kitDialogContent>"])
  })

  it("takes what the class it extends puts, from another entry point", () => {
    expect(
      findings(
        `<button brnAlertDialogTrigger class="bg-pink-500"></button>`,
        contracts("/^brn/")
      )
    ).toEqual([])
  })

  // A broad pattern over PrimeNG 22.1: pTooltip and pStyleClass put
  // nothing on their element, pButton binds its class.
  it("reads PrimeNG's tooltip as one that styles nothing, its button as one that does", () => {
    expect(
      findings(
        [
          `<div pTooltip="Info" class="bg-pink-500"></div>`,
          `<span pStyleClass="@next" class="bg-pink-500"></span>`,
          `<button pTooltip="Save" pButton class="bg-pink-500"></button>`,
        ].join(""),
        contracts("/^p[A-Z]/")
      )
    ).toEqual(["bg-pink-500 on <button pButton>"])
  })
})

describe("a project's directive that hosts a library's", () => {
  it("styles what the library's declares it puts on the element", () => {
    expect(
      findings(
        [
          `<button kitDialogTrigger class="bg-pink-500"></button>`,
          `<span kitBind class="bg-pink-500"></span>`,
        ].join(""),
        contracts("/^kit/")
      )
    ).toEqual(["bg-pink-500 on <span kitBind>"])
  })

  it("may style its element when the library's JavaScript is not there", () => {
    expect(
      findings(
        `<span kitTyped class="bg-pink-500"></span>`,
        contracts("/^kit/")
      )
    ).toEqual(["bg-pink-500 on <span kitTyped>"])
  })
})

describe("the declarations a library's JavaScript carries", () => {
  it("are read with the host directives and the classes each extends", () => {
    expect([
      styles("primeng/tooltip", "Tooltip"),
      styles("primeng/styleclass", "StyleClass"),
      styles("primeng/button", "ButtonDirective"),
      // Its own host is empty; the Bind it hosts binds `class`.
      styles("primeng/button", "Button"),
      styles("primeng/dialog", "Dialog"),
      styles("@spartan-ng/brain/dialog", "BrnDialogTrigger"),
      styles("@spartan-ng/brain/alert-dialog", "BrnAlertDialogTrigger"),
      styles("@spartan-ng/brain/radio-group", "BrnRadio"),
    ]).toEqual([false, false, true, true, true, false, false, true])
  })

  // A module's exports are found from the entry point the module is.
  it("are read for a class a module exports", () => {
    expect(
      findings(
        `<div pTooltip="Info" class="bg-pink-500"></div>`,
        contracts("pTooltip")
      )
    ).toEqual([])
  })

  it("leave a library without them installed as one whose directives may style", () => {
    expect(styles("typed-kit", "TypedTip")).toBeNull()
    expect(styles("@angular/material/tooltip", "MatTooltip")).toBeNull()
  })
})

describe("a library's JavaScript whose declarations cannot be read", () => {
  let warnings: string[] = []

  beforeEach(() => {
    warnings = []
    resetWarnings()
    setWarningSink((message) => warnings.push(message))
  })

  afterEach(() => {
    setWarningSink((message) => console.warn(message))
    resetWarnings()
  })

  it("leaves its directives as ones that may style, and says so once per package", () => {
    expect(
      findings(
        [
          `<span tornTip class="bg-pink-500"></span>`,
          `<span futureTip class="bg-pink-500"></span>`,
          `<span typedTip class="bg-pink-500"></span>`,
          `<span tornTip futureTip class="rounded-full"></span>`,
        ].join(""),
        contracts("tornTip", "futureTip", "typedTip")
      )
    ).toEqual([
      "bg-pink-500 on <span tornTip>",
      "bg-pink-500 on <span futureTip>",
      "bg-pink-500 on <span typedTip>",
      "rounded-full on <span tornTip>",
    ])
    // A package without its JavaScript is said nothing of.
    expect(warnings).toEqual([
      "[@shadcn/lint] The Angular declarations in torn-kit 1.0.0 cannot be read: fesm2022/torn-kit.mjs has 1, none of them in the form the linker of Angular 22 reads. Until they can be, shadcn/no-restyle takes its directives for ones that may style their element, as it does without the package's JavaScript.",
      expect.stringContaining(
        "The Angular declarations in future-kit 1.0.0 cannot be read: fesm2022/future-kit.mjs has 1,"
      ),
    ])
  })
})

// The forms a declaration takes, written into a library of its own.
describe("the forms of a partial declaration", () => {
  let root: string
  // What is kept of a file is read again for a new mtime: each rewrite
  // gets one of its own.
  let written = 0
  const write = (
    name: string,
    text: string,
    at = Date.now() - 600_000 + ++written * 1_000
  ) => {
    const file = path.join(root, name)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, text)
    const time = new Date(at)
    fs.utimesSync(file, time, time)
    return file
  }
  const FROM = () => path.join(root, "src/app.ts")
  const dts = (selector: string) =>
    `import * as i0 from '@angular/core';\ndeclare class Kit {\n    static ɵdir: i0.ɵɵDirectiveDeclaration<Kit, ${JSON.stringify(selector)}, never, {}, {}, never, never, true, never>;\n}\nexport { Kit };\n`
  const declare = (name: string, rest: string, minVersion = "14.0.0") =>
    `i0.ɵɵngDeclareDirective({ minVersion: "${minVersion}", version: "22.1.2", type: ${name}, isStandalone: true, ${rest}ngImport: i0 })`
  const library = (
    js: string,
    selector = "[kit]",
    manifest: object = {
      exports: { ".": { types: "./index.d.ts", default: "./kit.mjs" } },
    }
  ) => {
    write(
      "node_modules/kit/package.json",
      JSON.stringify({ name: "kit", version: "1.0.0", ...manifest })
    )
    write("node_modules/kit/index.d.ts", dts(selector))
    write(
      "node_modules/kit/kit.mjs",
      `import * as i0 from '@angular/core';\n${js}`
    )
  }
  const read = () => {
    resetFsMemo()
    return styles("kit", "Kit", FROM())
  }

  beforeEach(() => {
    root = fs.realpathSync.native(
      fs.mkdtempSync(path.join(os.tmpdir(), "lint-partial-"))
    )
    write("package.json", JSON.stringify({ private: true }))
  })

  afterEach(() => {
    vi.useRealTimers()
    resetFsMemo()
    fs.rmSync(root, { recursive: true, force: true })
  })

  it("puts a class through a static class, a binding of the class, its attribute, className or one of a single class", () => {
    const host = (written: string) => {
      library(
        `class Kit {\n  static ɵdir = ${declare("Kit", `selector: "[kit]", host: ${written}, `)};\n}\nexport { Kit };\n`
      )
      return read()
    }
    expect(host(`{ classAttribute: "kit" }`)).toBe(true)
    expect(host(`{ properties: { "class": "c()" } }`)).toBe(true)
    expect(host(`{ properties: { "class.kit-on": "on()" } }`)).toBe(true)
    expect(host(`{ properties: { "attr.class": "c()" } }`)).toBe(true)
    expect(host(`{ properties: { "className": "c()" } }`)).toBe(true)
    expect(
      host(
        `{ attributes: { "role": "button" }, listeners: { "click": "go()" }, properties: { "attr.title": "c()", "style.color": "c()", "classes": "c()", "classNames": "c()" }, styleAttribute: "color: red" }`
      )
    ).toBe(false)
    // What it cannot read may bind a class.
    expect(host(`{ ...HOST }`)).toBeNull()
    expect(host(`{ properties: BOUND }`)).toBeNull()
    expect(host(`{ classBindings: ["kit"] }`)).toBeNull()
  })

  // As @angular/cdk 15.2 and 16.2 publish them.
  it("reads a declaration Angular 15 assigned after its class, and Angular 16 in a static block", () => {
    library(
      `class Kit {\n}\nKit.ɵdir = ${declare("Kit", `selector: "[kit]", host: { classAttribute: "kit" }, `)};\nexport { Kit };\n`
    )
    expect(read()).toBe(true)
    library(
      `class Kit {\n  static { this.ɵdir = ${declare("Kit", `selector: "[kit]", host: { classAttribute: "kit" }, `)}; }\n}\nexport { Kit };\n`
    )
    expect(read()).toBe(true)
  })

  it("reads a class another decorator is kept on, as TypeScript writes it", () => {
    library(
      `let Kit = class Kit {\n  static ɵdir = ${declare("Kit", `selector: "[kit]", `)};\n};\nKit = __decorate([Sealed()], Kit);\nexport { Kit };\n`
    )
    expect(read()).toBe(false)
  })

  it("follows the directives it hosts, written as forward references", () => {
    library(
      [
        `class Kit {`,
        `  static ɵdir = ${declare("Kit", `selector: "[kit]", hostDirectives: [{ directive: i0.forwardRef(() => Inner) }, { directive: i0.forwardRef(function () { return Plain; }) }], `)};`,
        `}`,
        `class Inner {`,
        `  static ɵdir = ${declare("Inner", `host: { classAttribute: "inner" }, `)};`,
        `}`,
        `class Plain {`,
        `  static ɵdir = ${declare("Plain", ``)};`,
        `}`,
        `export { Kit };`,
      ].join("\n")
    )
    expect(read()).toBe(true)
  })

  it("is unknown when a host directive cannot be followed", () => {
    const hosting = (directive: string) => {
      library(
        `import * as i1 from 'other-kit';\nclass Kit {\n  static ɵdir = ${declare("Kit", `selector: "[kit]", hostDirectives: [${directive}], `)};\n}\nclass Plain {\n  static ɵdir = ${declare("Plain", ``)};\n}\nexport { Kit };\n`
      )
      return read()
    }
    expect(hosting(`{ directive: Plain }`)).toBe(false)
    // other-kit is not installed.
    expect(hosting(`{ directive: i1.Other }`)).toBeNull()
    expect(hosting(`{ directive: HOSTS[0] }`)).toBeNull()
    expect(hosting(`...HOSTS`)).toBeNull()
  })

  // ɵɵInheritDefinitionFeature walks the prototype chain past classes
  // Angular does not know, and takes the host bindings and the host
  // directives of each it does.
  it("takes the host of each class up its chain when it inherits", () => {
    const chain = (inherits: boolean, base: string) => {
      library(
        [
          `class Styled {`,
          `  static ɵdir = ${declare("Styled", `host: { properties: { "class.on": "on" } }, `)};`,
          `}`,
          `class Hosting {`,
          `  static ɵdir = ${declare("Hosting", `hostDirectives: [{ directive: Styled }], `)};`,
          `}`,
          `class Plain extends ${base} {}`,
          `class Kit extends Plain {`,
          `  static ɵdir = ${declare("Kit", `selector: "[kit]", ${inherits ? "usesInheritance: true, " : ""}`)};`,
          `}`,
          `export { Kit };`,
        ].join("\n")
      )
      return read()
    }
    expect(chain(true, "Styled")).toBe(true)
    expect(chain(true, "Hosting")).toBe(true)
    expect(chain(false, "Styled")).toBe(false)
    expect(chain(true, "Missing")).toBeNull()
    expect(chain(true, "mixinDisabled(Styled)")).toBeNull()
  })

  it("finds the module through a re-export into a chunk, as the CDK publishes", () => {
    write(
      "node_modules/kit/package.json",
      JSON.stringify({
        name: "kit",
        version: "1.0.0",
        exports: {
          "./overlay": {
            types: "./types/overlay.d.ts",
            default: "./fesm2022/overlay.mjs",
          },
        },
      })
    )
    // Its .d.ts and its bundle split into chunks of their own.
    write(
      "node_modules/kit/types/overlay.d.ts",
      `export { Kit } from './_scrolling-chunk.js';\n`
    )
    write("node_modules/kit/types/_scrolling-chunk.d.ts", dts("[kit]"))
    write(
      "node_modules/kit/fesm2022/overlay.mjs",
      `export { Kit as ɵɵKit } from './scrolling.mjs';\nimport { Kit } from './_kit-chunk.mjs';\nexport { Kit };\n`
    )
    write(
      "node_modules/kit/fesm2022/_kit-chunk.mjs",
      `import * as i0 from '@angular/core';\nclass Kit$1 {\n  static ɵdir = ${declare("Kit$1", `selector: "[kit]", host: { classAttribute: "kit" }, `)};\n}\nexport { Kit$1 as Kit };\n`
    )
    resetFsMemo()
    expect(styles("kit/overlay", "Kit", FROM())).toBe(true)
  })

  it("finds the module through `module` without exports", () => {
    library(
      `class Kit {\n  static ɵdir = ${declare("Kit", `selector: "[kit]", `)};\n}\nexport { Kit };\n`,
      "[kit]",
      { types: "index.d.ts", module: "kit.mjs" }
    )
    expect(read()).toBe(false)
  })

  it("is the declaration of the selector the .d.ts gives", () => {
    const declared = (written: string, selector: string) => {
      library(
        `class Kit {\n  static ɵdir = ${declare("Kit", `selector: ${written}, `)};\n}\nexport { Kit };\n`,
        selector
      )
      return read()
    }
    // A .d.ts writes a selector's line breaks as spaces.
    expect(
      declared(
        `"\\n    button[kit],\\n    a[kit]  "`,
        "     button[kit],     a[kit]  "
      )
    ).toBe(false)
    expect(declared(`"[kit]"`, "[other]")).toBeNull()
    expect(declared(`SELECTOR`, "[kit]")).toBeNull()
  })

  it("leaves a declaration a later linker than Angular 22's must read unread", () => {
    setWarningSink(() => {})
    try {
      library(
        `class Kit {\n  static ɵdir = ${declare("Kit", `selector: "[kit]", `, "23.0.0")};\n}\nexport { Kit };\n`
      )
      expect(read()).toBeNull()
      library(
        `class Kit {\n  static ɵdir = ${declare("Kit", `selector: "[kit]", `, "22.1.0")};\n}\nexport { Kit };\n`
      )
      expect(read()).toBe(false)
    } finally {
      setWarningSink((message) => console.warn(message))
      resetWarnings()
    }
  })

  // A long-lived ESLint server sees a library change under it.
  it("is read again for a new version or a new mtime", () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    const at = Date.now() - 60_000
    const js = (host: string) =>
      `import * as i0 from '@angular/core';\nclass Kit {\n  static ɵdir = ${declare("Kit", `selector: "[kit]", ${host}`)};\n}\nexport { Kit };\n`
    const manifest = (version: string) =>
      JSON.stringify({
        name: "kit",
        version,
        types: "index.d.ts",
        module: "kit.mjs",
      })
    write("node_modules/kit/package.json", manifest("1.0.0"))
    write("node_modules/kit/index.d.ts", dts("[kit]"))
    write("node_modules/kit/kit.mjs", js(""), at)
    expect(read()).toBe(false)
    // The same version and mtime: what was read stands.
    write(
      "node_modules/kit/kit.mjs",
      js(`host: { classAttribute: "kit" }, `),
      at
    )
    expect(read()).toBe(false)
    // A new version, the same mtime.
    vi.setSystemTime(Date.now() + 2_000)
    write("node_modules/kit/package.json", manifest("2.0.0"))
    expect(read()).toBe(true)
    // A new mtime, the same version.
    vi.setSystemTime(Date.now() + 2_000)
    write("node_modules/kit/kit.mjs", js(""))
    expect(read()).toBe(false)
  })
})

// Only what an element a contract judges needs is read: the module of
// each directive its names stand for, and what that hosts and extends.
describe("the modules read", () => {
  beforeEach(() => {
    resetFsMemo()
    resetScriptFilesForTests()
  })

  it("are those of the directives on an element a contract judges", () => {
    const read = () =>
      scriptFilesReadForTests().map((file) => path.relative(LIBRARIES, file))
    findings(
      `<div pTooltip="Info" class="bg-pink-500"></div><button pButton></button>`,
      contracts("/^brn/")
    )
    expect(read()).toEqual([])
    findings(
      `<div pTooltip="Info" class="bg-pink-500"></div><button pButton></button>`,
      contracts("pTooltip")
    )
    expect(read()).toEqual([
      "node_modules/primeng/fesm2022/primeng-tooltip.mjs",
      "node_modules/primeng/fesm2022/primeng-basecomponent.mjs",
    ])
  })
})

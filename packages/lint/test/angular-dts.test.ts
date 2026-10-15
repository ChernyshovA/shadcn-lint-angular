// What an installed Angular library's .d.ts says about its classes, read
// the way ngtsc's DtsMetadataReader reads it, from the syntax alone: the
// ɵɵComponentDeclaration, ɵɵDirectiveDeclaration and ɵɵNgModuleDeclaration
// types the compiler writes on a compiled class's static fields.

import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { dtsExport, dtsLocal, resolveDts } from "../src/project/angular-dts"
import { resetFsMemo } from "../src/project/fs"
import { resetWarnings, setWarningSink } from "../src/project/warn"

const LIBRARIES = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures/angular-libraries"
)
// Where an import is resolved from.
const FROM = path.join(LIBRARIES, "src/app/page.component.ts")

const read = (spec: string, name: string, from = FROM) => {
  const file = resolveDts(spec, from)
  const found = file ? dtsExport(file, name, new Set()) : null
  return found?.kind === "class" ? found.cls : null
}

// The forms Angular 19, 20, 21 and 22 write, copied from the published
// packages: nine type arguments for a directive or a component, four for
// a module, inputs as `{ alias; required; }`, with `isSignal` since 17.1.
describe("declarations of Angular 19 to 22", () => {
  it.each([
    ["material-19/tooltip", "19.2.19, behind minified chunk names"],
    ["@angular/material/tooltip", "20.2.14, in a .d.d.ts chunk"],
    ["material-21/tooltip", "21.2.14, in types/"],
  ])("reads %s (%s)", (spec) => {
    const tooltip = read(spec, "MatTooltip")
    expect(tooltip?.directive).toMatchObject({
      component: false,
      selector: "[matTooltip]",
    })
    expect(tooltip?.directive?.inputs).toEqual(
      expect.arrayContaining([
        "matTooltipClass",
        "matTooltipPosition",
        "matTooltip",
      ])
    )
    expect(read(spec, "MatTooltipModule")?.module?.exports).toEqual(
      expect.arrayContaining([
        { name: "MatTooltip", member: null },
        { name: "TooltipComponent", member: null },
      ])
    )
  })

  it("reads PrimeNG 22, its namespace import and the class it extends", () => {
    const dialog = read("primeng/dialog", "Dialog")
    expect(dialog).toMatchObject({
      directive: { component: true, selector: "p-dialog" },
      base: { name: "BaseComponent", member: null },
    })
    expect(dialog?.directive?.inputs).toContain("styleClass")
    expect(read("primeng/dialog", "DialogModule")?.module).toEqual({
      declarations: [],
      imports: [
        { name: "Dialog", member: null },
        { name: "i2", member: "SharedModule" },
      ],
      exports: [
        { name: "Dialog", member: null },
        { name: "i2", member: "SharedModule" },
      ],
      complete: true,
    })
  })

  it("reads a component an attribute selects, and what it inherits from", () => {
    expect(read("@angular/material/button", "MatButton")).toMatchObject({
      directive: {
        component: true,
        selector: expect.stringContaining("button[mat-flat-button]"),
        inputs: ["matButton"],
      },
      base: { name: "MatButtonBase", member: null },
    })
  })
})

describe("the forms of a declaration file", () => {
  // `never` is no selector, which no element matches; any other type
  // that is no string is one this cannot read, which may match any.
  it("tells a selector that is not written out from none", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lint-dts-selector-"))
    const file = path.join(dir, "index.d.ts")
    fs.writeFileSync(
      file,
      [
        `import * as i0 from "@angular/core";`,
        ...[
          ["None", "never"],
          ["Wide", "string"],
          ["Built", "`kit-${string}`"],
        ].map(
          ([name, selector]) =>
            `export declare class ${name} { static ɵdir: i0.ɵɵDirectiveDeclaration<${name}, ${selector}, never, {}, {}, never, never, true, never>; }`
        ),
      ].join("\n")
    )
    try {
      const selector = (name: string) => {
        const found = dtsLocal(file, name, new Set())
        return found?.kind === "class" ? found.cls.directive?.selector : "?"
      }
      expect(selector("None")).toBe(null)
      expect(selector("Wide")).toBe(undefined)
      expect(selector("Built")).toBe(undefined)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it("reads inputs as Angular wrote them before 16", () => {
    const file = path.join(LIBRARIES, "node_modules/acme-kit/index.d.ts")
    const base = dtsLocal(file, "KitBase", new Set())
    expect(base?.kind === "class" && base.cls.directive).toEqual({
      component: false,
      selector: null,
      inputs: ["panelClass"],
    })
    expect(read("acme-kit", "KitPanel")?.base).toEqual({
      name: "KitBase",
      member: null,
    })
  })

  it("reads the inputs a host directive exposes under the host's names", () => {
    expect(read("acme-kit", "KitTooltip")?.directive?.inputs).toEqual([
      "kitTooltipClass",
      "kitHintClass",
    ])
  })

  it("reads a constant tuple of classes", () => {
    const file = resolveDts("acme-kit", FROM)!
    expect(dtsExport(file, "KitImports", new Set())).toMatchObject({
      kind: "tuple",
      refs: [
        { name: "KitButton", member: null },
        { name: "KitPanel", member: null },
        { name: "KitCard", member: null },
        { name: "KitMixed", member: null },
        { name: "KitTooltip", member: null },
      ],
    })
  })

  // ng-packagr before it bundled them: `export declare class` in a file
  // of its own, behind `export *`.
  it("reads a declaration in a file of its own, behind export *", () => {
    expect(read("split-kit", "SplitChip")?.directive).toEqual({
      component: true,
      selector: "split-chip",
      inputs: ["labelClass"],
    })
    expect(read("split-kit", "SplitModule")?.module?.exports).toEqual([
      { name: "i1", member: "SplitChip" },
      { name: "i2", member: "SplitTip" },
    ])
  })

  it("finds an entry through typings, with no exports", () => {
    expect(resolveDts("acme-kit", FROM)).toBe(
      path.join(LIBRARIES, "node_modules/acme-kit/index.d.ts")
    )
  })

  it("follows `./x.d.js` to `./x.d.d.ts`, and minified names to their classes", () => {
    expect(resolveDts("@angular/material/tooltip", FROM)).toBe(
      path.join(LIBRARIES, "node_modules/@angular/material/tooltip/index.d.ts")
    )
    expect(read("material-19/tooltip", "TooltipComponent")?.directive).toEqual({
      component: true,
      selector: "mat-tooltip-component",
      inputs: [],
    })
  })
})

describe("a .d.ts whose declarations cannot be read", () => {
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

  it("reads nothing of them, and says so once per package", () => {
    // A component still, whose declaration says nothing this can read.
    expect(read("broken-kit", "BrokenCard")).toEqual({
      directive: null,
      declared: true,
      module: null,
      pipe: false,
      base: null,
    })
    read("broken-kit", "BrokenModule")
    expect(read("garbled-kit", "GarbledCard")).toBeNull()
    expect(warnings).toEqual([
      "[@shadcn/lint] The Angular declarations in broken-kit 99.0.0 cannot be read: index.d.ts has 2, none of them in the form Angular 19 to 22 write. Until they can be, shadcn/no-restyle judges a *Class input on an element by the contract of its tag, as it does without the package installed.",
      expect.stringContaining(
        "The Angular declarations in garbled-kit 1.0.0 cannot be read: index.d.ts has 1,"
      ),
    ])
  })

  // @angular/core defines the declaration types and declares no class
  // with them.
  it("says nothing of a file that only defines the declaration types", () => {
    expect(read("core-typings", "ɵɵDirectiveDeclaration")).toBeNull()
    expect(warnings).toEqual([])
  })
})

// A long-lived ESLint server sees a library change under it: what a file
// says is read again for a new version of its package or a new mtime.
describe("the declarations kept of a .d.ts", () => {
  let root: string
  const write = (name: string, text: string, at = Date.now()) => {
    const file = path.join(root, name)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, text)
    const time = new Date(at)
    fs.utimesSync(file, time, time)
    return file
  }
  const library = (selector: string) =>
    `import * as i0 from '@angular/core';\ndeclare class Kit {\n    static ɵcmp: i0.ɵɵComponentDeclaration<Kit, "${selector}", never, {}, {}, never, never, true, never>;\n}\nexport { Kit };\n`
  const manifest = (version: string) =>
    JSON.stringify({ name: "kit", version, types: "index.d.ts" })
  const selectorOf = () => {
    resetFsMemo()
    return read("kit", "Kit", path.join(root, "src/app.ts"))?.directive
      ?.selector
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] })
    root = fs.realpathSync.native(
      fs.mkdtempSync(path.join(os.tmpdir(), "lint-dts-"))
    )
    write("package.json", JSON.stringify({ private: true }))
  })

  afterEach(() => {
    vi.useRealTimers()
    resetFsMemo()
    fs.rmSync(root, { recursive: true, force: true })
  })

  it("are read again for a new version or a new mtime", () => {
    const at = Date.now() - 60_000
    write("node_modules/kit/package.json", manifest("1.0.0"))
    write("node_modules/kit/index.d.ts", library("kit-one"), at)
    expect(selectorOf()).toBe("kit-one")
    // The same version and mtime: what was read stands.
    write("node_modules/kit/index.d.ts", library("kit-two"), at)
    expect(selectorOf()).toBe("kit-one")
    // A new version, the same mtime.
    vi.setSystemTime(Date.now() + 2_000)
    write("node_modules/kit/package.json", manifest("2.0.0"))
    expect(selectorOf()).toBe("kit-two")
    // A new mtime, the same version.
    vi.setSystemTime(Date.now() + 2_000)
    write("node_modules/kit/index.d.ts", library("kit-three"))
    expect(selectorOf()).toBe("kit-three")
  })
})

import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import parser from "@typescript-eslint/parser"
import { Linter } from "eslint"
import { afterEach, beforeEach, describe, expect, test } from "vitest"

import { classifierFor, groupOf } from "../src/grammar/classifier"
import { plugin } from "../src/index"
import { noteAngularCode } from "../src/project/angular-files"
import { componentsFor } from "../src/project/components"
import {
  findProject,
  projectFor,
  uiDirectory,
} from "../src/project/components-json"
import { resetFsMemo } from "../src/project/fs"
import { definingFileOf, exportsOf } from "../src/project/modules"
import {
  readJsonc,
  resolveDirectory,
  resolveFile,
  tsconfigPaths,
} from "../src/project/resolve"
import {
  colorTokensFor,
  parseImports,
  themeFileFor,
} from "../src/project/theme"
import { resetWarnings, setWarningSink } from "../src/project/warn"
import { PROJECT } from "./helpers"

const FIXTURES = path.join(__dirname, "fixtures")
const NO_JSON = path.join(FIXTURES, "no-json")
const NO_JSON_PAGE = path.join(NO_JSON, "src/app/page.tsx")
const DS_BUTTON = path.join(NO_JSON, "src/ds/button.tsx")
const DS_INDEX = path.join(NO_JSON, "src/ds/index.ts")
const MONO = path.join(FIXTURES, "monorepo")
const WEB = path.join(MONO, "apps/web")
const ADMIN = path.join(MONO, "apps/admin")
const WEB_PAGE = path.join(WEB, "app/page.tsx")
const ADMIN_PAGE = path.join(ADMIN, "app/page.tsx")
const BROKEN_PAGE = path.join(MONO, "apps/broken/app/page.tsx")
const UI_COMPONENTS = path.join(MONO, "packages/ui/src/components")
const UI_BUTTON = path.join(UI_COMPONENTS, "button.tsx")

describe("resolve", () => {
  test("readJsonc tolerates comments and trailing commas", () => {
    expect(readJsonc(path.join(NO_JSON, "tsconfig.json"))).toEqual({
      compilerOptions: { paths: { "@/*": ["./src/*"] } },
    })
  })

  test("tsconfig paths, inherited entries resolved against their own file", () => {
    const entries = tsconfigPaths(WEB)
    expect(entries.map((e) => e.pattern)).toEqual(["@/*", "@workspace/ui/*"])
    expect(resolveDirectory("@workspace/ui/components", WEB, WEB)).toBe(
      UI_COMPONENTS
    )
    expect(resolveFile("@/app/globals.css", WEB, WEB)).toBe(
      path.join(WEB, "app/globals.css")
    )
  })

  test("package.json imports", () => {
    expect(resolveFile("#ds/button", NO_JSON, NO_JSON)).toBe(DS_BUTTON)
    expect(resolveFile("#ds", NO_JSON, NO_JSON)).toBe(DS_INDEX)
  })

  test("packages through their exports, past the node_modules symlink", () => {
    expect(resolveDirectory("@workspace/ui/components", ADMIN, ADMIN)).toBe(
      UI_COMPONENTS
    )
    expect(resolveFile("@workspace/ui/components/button", ADMIN, ADMIN)).toBe(
      UI_BUTTON
    )
    expect(
      resolveFile("@workspace/ui/globals.css", ADMIN, ADMIN, [".css"])
    ).toBe(path.join(MONO, "packages/ui/src/styles/globals.css"))
  })

  test("a stylesheet's import takes a package's style export, a script's its JavaScript", () => {
    const app = path.join(PROJECT, "app")
    expect(
      resolveFile("tailwindcss", app, PROJECT, [".css"], { stylesheet: true })
    ).toMatch(/tailwindcss[\\/]index\.css$/)
    expect(resolveFile("tailwindcss", app, PROJECT)).toMatch(
      /tailwindcss[\\/]dist[\\/]lib\.mjs$/
    )
    expect(
      resolveFile("style-only", app, PROJECT, [".css"], { stylesheet: true })
    ).toBe(path.join(PROJECT, "node_modules/style-only/styles/style-only.css"))
  })

  test("relative paths and the @/ convention", () => {
    expect(resolveFile("./ds", path.join(NO_JSON, "src"), NO_JSON)).toBe(
      DS_INDEX
    )
    expect(
      resolveFile("@/ds/button", path.join(NO_JSON, "src/app"), NO_JSON)
    ).toBe(DS_BUTTON)
    expect(resolveFile("@/nothing", NO_JSON, NO_JSON)).toBeNull()
  })
})

// A stylesheet's @import resolves the way @tailwindcss/node does: the
// `style` condition and `default`, in the order a package writes them,
// else its `style` field. A script is never read as CSS.
describe("a stylesheet's package import", () => {
  let root: string
  const write = (file: string, text: string) => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
    fs.writeFileSync(path.join(root, file), text)
  }
  const pkg = (name: string, manifest: object, files: string[]) => {
    write(
      `node_modules/${name}/package.json`,
      JSON.stringify({ name, ...manifest })
    )
    for (const file of files) write(`node_modules/${name}/${file}`, "")
  }
  const css = (spec: string) => {
    const found = resolveFile(spec, root, root, [".css"], { stylesheet: true })
    return found && path.relative(fs.realpathSync(root), found)
  }
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "shadcn-lint-css-imports-"))
    write("package.json", "{}")
  })
  afterEach(() => {
    resetFsMemo()
    fs.rmSync(root, { recursive: true, force: true })
  })

  test("the style field of a package without exports", () => {
    pkg("primeicons", { style: "primeicons.css", main: "index.js" }, [
      "primeicons.css",
      "index.js",
    ])
    expect(css("primeicons")).toBe("node_modules/primeicons/primeicons.css")
  })

  test("exports written short: a string, or conditions without a path", () => {
    pkg("short", { exports: "./short.css" }, ["short.css"])
    pkg("sugar", { exports: { style: "./s.css", default: "./s.js" } }, [
      "s.css",
      "s.js",
    ])
    expect(css("short")).toBe("node_modules/short/short.css")
    expect(css("sugar")).toBe("node_modules/sugar/s.css")
  })

  test("default alone, unless it maps to a script", () => {
    pkg("plain", { exports: { ".": { default: "./plain.css" } } }, [
      "plain.css",
    ])
    pkg(
      "script",
      { exports: { ".": { types: "./i.d.ts", default: "./i.js" } } },
      ["i.js"]
    )
    expect(css("plain")).toBe("node_modules/plain/plain.css")
    expect(css("script")).toBeNull()
  })

  test("a wildcard export's style condition", () => {
    pkg(
      "kit",
      { exports: { "./*": { style: "./css/*", import: "./js/*.mjs" } } },
      ["css/theme.css", "js/theme.css.mjs"]
    )
    expect(css("kit/theme.css")).toBe("node_modules/kit/css/theme.css")
  })

  test("conditions nested under style, not under one Tailwind does not read", () => {
    pkg(
      "nested",
      {
        exports: {
          ".": { style: { production: "./p.css", default: "./d.css" } },
        },
      },
      ["p.css", "d.css"]
    )
    pkg(
      "node-only",
      {
        exports: {
          ".": { node: { style: "./n.css" }, default: "./n.js" },
        },
      },
      ["n.css", "n.js"]
    )
    expect(css("nested")).toBe("node_modules/nested/d.css")
    expect(css("node-only")).toBeNull()
  })

  test("a package.json #import's style condition", () => {
    write(
      "package.json",
      JSON.stringify({
        imports: {
          "#theme": { style: "./src/theme.css", default: "./src/theme.js" },
        },
      })
    )
    write("src/theme.css", "")
    write("src/theme.js", "")
    expect(css("#theme")).toBe("src/theme.css")
  })

  // Tailwind fails on such an import. The linter reads the package's
  // index.css when it has one, as it does without exports, and never its
  // JavaScript.
  test("a package whose exports map only scripts falls back to its index.css", () => {
    pkg(
      "scripts",
      {
        exports: {
          ".": { import: "./dist/index.mjs", require: "./dist/index.cjs" },
        },
      },
      ["dist/index.mjs", "dist/index.cjs", "index.css"]
    )
    pkg("bare", { exports: { ".": { import: "./dist/index.mjs" } } }, [
      "dist/index.mjs",
    ])
    expect(css("scripts")).toBe("node_modules/scripts/index.css")
    expect(css("bare")).toBeNull()
  })
})

describe("modules", () => {
  test("follows barrels to the defining file", () => {
    const exports = exportsOf(DS_INDEX)
    expect(exports.get("Button")).toEqual({ file: DS_BUTTON, name: "Button" })
    expect(exports.get("buttonVariants")?.file).toBe(DS_BUTTON)
    expect(exports.get("CardBody")?.file).toBe(
      path.join(NO_JSON, "src/ds/card.tsx")
    )
  })

  test("definingFileOf through an import specifier", () => {
    expect(definingFileOf("@/ds", "Button", NO_JSON_PAGE)).toBe(DS_BUTTON)
    // An unknown name falls back to the module itself.
    expect(definingFileOf("@/ds", "Nope", NO_JSON_PAGE)).toBe(DS_INDEX)
    expect(definingFileOf("@/missing", "Button", NO_JSON_PAGE)).toBeNull()
  })
})

describe("project without components.json", () => {
  test("falls back to the package root", () => {
    expect(findProject(NO_JSON_PAGE)).toBeNull()
    const project = projectFor(NO_JSON_PAGE)!
    expect(project.file).toBeNull()
    expect(project.root).toBe(NO_JSON)
    expect(uiDirectory(project)).toBeNull()
  })

  test("discovers the theme with the most tokens and follows imports", () => {
    expect(themeFileFor(NO_JSON_PAGE)).toBe(
      path.join(NO_JSON, "src/styles.css")
    )
    const tokens = colorTokensFor(NO_JSON_PAGE)!
    expect([...tokens].sort()).toEqual([
      "accent",
      "accent-ink",
      "ink",
      "ink-muted",
      "line",
      "paper",
    ])
  })

  test("parseImports reads every @import form", () => {
    expect(
      parseImports(
        `@import "tailwindcss";\n@import url("./a.css") layer(base);\n@import './b.css';`
      )
    ).toEqual(["tailwindcss", "./a.css", "./b.css"])
  })
})

describe("monorepo", () => {
  afterEach(() => {
    resetWarnings()
    setWarningSink((message) => console.warn(message))
  })

  test("ui alias through tsconfig paths", () => {
    const project = findProject(WEB_PAGE)!
    expect(uiDirectory(project)).toBe(UI_COMPONENTS)
    expect(componentsFor(WEB_PAGE).files.get("Button")).toBe(UI_BUTTON)
  })

  test("ui alias through package exports", () => {
    expect(componentsFor(ADMIN_PAGE).files.get("Button")).toBe(UI_BUTTON)
  })

  // The ui package's own components.json names the package itself, the
  // way the official monorepo template does; from inside the package
  // there is no node_modules entry to find, only the package.json above.
  test("ui alias through the package's own name, from inside it", () => {
    const warnings: string[] = []
    setWarningSink((message) => warnings.push(message))
    const ui = path.join(MONO, "packages/ui")
    expect(
      resolveDirectory("@workspace/ui/components", UI_COMPONENTS, ui)
    ).toBe(UI_COMPONENTS)
    expect(componentsFor(UI_BUTTON).files.get("Button")).toBe(UI_BUTTON)
    expect(warnings).toEqual([])
  })

  test("theme through a workspace @import, not through tailwindcss itself", () => {
    const tokens = colorTokensFor(WEB_PAGE)!
    expect(tokens.has("brand")).toBe(true)
    expect(tokens.has("primary")).toBe(true)
    expect(tokens.has("red-500")).toBe(false)
  })

  test("an alias that resolves nowhere warns once and recognizes nothing", () => {
    const warnings: string[] = []
    setWarningSink((message) => warnings.push(message))
    expect(componentsFor(BROKEN_PAGE).has("Button")).toBe(false)
    componentsFor(BROKEN_PAGE)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain("@nowhere/ui/components")
    expect(warnings[0]).toContain("componentImports")
  })
})

describe("resolution", () => {
  test("a tsconfig that extends a package resolves without recursing", () => {
    const entries = tsconfigPaths(ADMIN)
    expect(entries.map((e) => e.pattern)).toEqual(["@/*", "@workspace/ui/*"])
    expect(componentsFor(path.join(ADMIN, "app/page.tsx")).has("Button")).toBe(
      true
    )
  })

  // The package imports guide maps "#components/*" to files with an
  // extension, so the ui alias only matches as a directory.
  test("a ui alias through a wildcard package.json imports key", () => {
    const warnings: string[] = []
    setWarningSink((message) => warnings.push(message))
    const root = path.join(FIXTURES, "package-imports")
    const ui = path.join(root, "src/components/ui")
    const app = path.join(root, "src/app.tsx")
    expect(resolveDirectory("#components/ui", root, root)).toBe(ui)
    expect(uiDirectory(findProject(app)!)).toBe(ui)
    expect(componentsFor(app).files.get("Button")).toBe(
      path.join(ui, "button.tsx")
    )
    expect(warnings).toEqual([])
    resetWarnings()
    setWarningSink((message) => console.warn(message))
  })

  test("a .js specifier resolves to the .tsx source", () => {
    expect(resolveFile("@/components/ui/button.js", PROJECT, PROJECT)).toBe(
      path.join(PROJECT, "components/ui/button.tsx")
    )
  })

  test("a barrel cycle resolves both ways and caches nothing partial", () => {
    const a = path.join(NO_JSON, "src/ds/cycle-a.ts")
    const b = path.join(NO_JSON, "src/ds/cycle-b.ts")
    expect(exportsOf(a).get("CycleB")?.file).toBe(b)
    expect(exportsOf(b).get("CycleA")?.file).toBe(a)
    expect(exportsOf(a).get("CycleA")?.file).toBe(a)
  })
})

describe("graceful degradation", () => {
  function captureWarnings() {
    const warnings: string[] = []
    setWarningSink((message) => warnings.push(message))
    return warnings
  }

  afterEach(() => {
    resetWarnings()
    setWarningSink((message) => console.warn(message))
  })

  test("a project cn the classifier cannot build falls back with a warning", () => {
    const warnings = captureWarnings()
    const file = path.join(FIXTURES, "bad-cn/app/page.tsx")
    expect(() => classifierFor(file)).not.toThrow()
    expect(groupOf("bg-primary", file)).toBe("bg-color")
    expect(warnings.some((w) => w.includes("isFutureThing"))).toBe(true)
  })

  test("a malformed components.json warns and falls back to the package root", () => {
    const warnings = captureWarnings()
    const project = projectFor(path.join(FIXTURES, "broken-json/app/page.tsx"))
    expect(project?.file).toBeNull()
    expect(warnings.some((w) => w.includes("could not be parsed"))).toBe(true)
  })
})

describe("components.json with bad aliases", () => {
  const dirs: string[] = []
  // A throwaway project whose components.json has the given aliases.
  function pageIn(aliases: string) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shadcn-lint-aliases-"))
    dirs.push(dir)
    fs.writeFileSync(path.join(dir, "package.json"), "{}")
    fs.writeFileSync(
      path.join(dir, "components.json"),
      `{ "aliases": ${aliases}, "tailwind": { "css": "app/globals.css" } }`
    )
    return path.join(dir, "app/page.tsx")
  }
  const warnings: string[] = []
  beforeEach(() => {
    warnings.length = 0
    setWarningSink((message) => warnings.push(message))
  })
  afterEach(() => {
    resetWarnings()
    setWarningSink((message) => console.warn(message))
    for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true })
  })

  test("a non-string ui alias is ignored with a warning, not thrown", () => {
    const project = projectFor(pageIn(`{ "ui": true, "components": "@/c" }`))!
    expect(project.file).not.toBeNull()
    expect(project.aliases).toEqual({ components: "@/c" })
    expect(() => uiDirectory(project)).not.toThrow()
    expect(warnings.some((w) => w.includes("aliases.ui"))).toBe(true)
  })

  test("a non-string components alias is ignored, not coerced", () => {
    const project = projectFor(pageIn(`{ "components": 1 }`))!
    expect(project.aliases).toEqual({})
    expect(() => uiDirectory(project)).not.toThrow()
    expect(warnings.some((w) => w.includes("aliases.components"))).toBe(true)
  })

  test.each([
    ["an array", "[]"],
    ["a string", '"x"'],
  ])("aliases that is %s is ignored with one warning", (_, aliases) => {
    const page = pageIn(aliases)
    const project = projectFor(page)!
    expect(project.file).not.toBeNull()
    expect(project.aliases).toEqual({})
    expect(() => uiDirectory(project)).not.toThrow()
    uiDirectory(project)
    expect(warnings.filter((w) => w.includes("not an object"))).toHaveLength(1)
  })
})

// The shadcn CLI reads a bare aliases.ui like "src/" against the project
// root, for projects that import components relatively.
describe("components.json with a bare ui alias", () => {
  let root: string
  function write(name: string, source: string) {
    const file = path.join(root, name)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, source)
    return file
  }
  const warnings: string[] = []
  beforeEach(() => {
    resetFsMemo()
    warnings.length = 0
    setWarningSink((message) => warnings.push(message))
    root = fs.realpathSync.native(
      fs.mkdtempSync(path.join(os.tmpdir(), "shadcn-lint-bare-alias-"))
    )
    write("package.json", "{}")
  })
  afterEach(() => {
    resetWarnings()
    setWarningSink((message) => console.warn(message))
    fs.rmSync(root, { recursive: true, force: true })
  })

  function lint(file: string, code: string) {
    return new Linter({ cwd: root }).verify(
      code,
      {
        files: ["**/*.tsx"],
        languageOptions: {
          parser,
          parserOptions: { ecmaFeatures: { jsx: true } },
        },
        plugins: { shadcn: plugin },
        rules: { "shadcn/no-restyle": "error" },
      } as any,
      { filename: file }
    )
  }

  test.each(["src/", "src", "./src"])(
    "%s resolves against the project and recognizes relative imports",
    (ui) => {
      write(
        "components.json",
        JSON.stringify({ aliases: { ui, components: ui } })
      )
      const button = write(
        "src/button.tsx",
        "export function Button(props) { return <button {...props} /> }"
      )
      const page = write("src/app/page.tsx", "")
      expect(uiDirectory(projectFor(page)!)).toBe(path.join(root, "src"))
      expect(componentsFor(page).files.get("Button")).toBe(button)
      const messages = lint(
        page,
        'import { Button } from "../button"\nexport const Page = () => <Button className="rounded-full" />'
      )
      expect(messages.map((m) => m.ruleId)).toEqual(["shadcn/no-restyle"])
      expect(warnings).toEqual([])
    }
  )

  test("a bare package name that is not a directory still warns", () => {
    write("components.json", JSON.stringify({ aliases: { ui: "@acme/ui" } }))
    const page = write("src/app/page.tsx", "")
    expect(uiDirectory(projectFor(page)!)).toBeNull()
    expect(warnings.some((w) => w.includes("does not resolve"))).toBe(true)
  })

  test("tsconfig paths win over a same-named directory", () => {
    write("components.json", JSON.stringify({ aliases: { ui: "ui" } }))
    write(
      "tsconfig.json",
      JSON.stringify({ compilerOptions: { paths: { ui: ["./lib/ui"] } } })
    )
    write("ui/button.tsx", "export function Button() { return null }")
    write("lib/ui/button.tsx", "export function Button() { return null }")
    const page = write("src/app/page.tsx", "")
    expect(uiDirectory(projectFor(page)!)).toBe(path.join(root, "lib/ui"))
  })
})

// Nx keeps the workspace's paths in a root tsconfig.base.json, which each
// project's tsconfig.json extends; the root has no tsconfig.json.
describe("an Nx workspace", () => {
  let root: string
  function write(name: string, source: string) {
    const file = path.join(root, name)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, source)
    return file
  }
  const warnings: string[] = []
  beforeEach(() => {
    resetFsMemo()
    warnings.length = 0
    setWarningSink((message) => warnings.push(message))
    root = fs.realpathSync.native(
      fs.mkdtempSync(path.join(os.tmpdir(), "shadcn-lint-nx-"))
    )
    write("package.json", "{}")
    write(
      "tsconfig.base.json",
      JSON.stringify({
        compilerOptions: {
          baseUrl: ".",
          jsx: "react-jsx",
          paths: { "@acme/ui/*": ["libs/ui/src/*"] },
        },
      })
    )
    write(
      "apps/web/tsconfig.json",
      JSON.stringify({ extends: "../../tsconfig.base.json" })
    )
  })
  afterEach(() => {
    resetWarnings()
    setWarningSink((message) => console.warn(message))
    fs.rmSync(root, { recursive: true, force: true })
  })

  test("reads paths from tsconfig.base.json when the root has no tsconfig.json", () => {
    expect(tsconfigPaths(root).map((entry) => entry.pattern)).toEqual([
      "@acme/ui/*",
    ])
    // A tsconfig.json at the root is read instead.
    write("tsconfig.json", JSON.stringify({ compilerOptions: { paths: {} } }))
    resetFsMemo()
    expect(tsconfigPaths(root)).toEqual([])
  })

  // shadcn-ui/lint#111.
  test("resolves the ui alias through it, with no warning", () => {
    write(
      "components.json",
      JSON.stringify({
        style: "new-york",
        tailwind: { css: "apps/web/src/styles.css" },
        aliases: { ui: "@acme/ui/components", utils: "@acme/ui/utils" },
      })
    )
    write(
      "apps/web/src/styles.css",
      `@import "tailwindcss";\n@theme { --color-primary: #111; }\n`
    )
    write(
      "libs/ui/src/components/button.tsx",
      [
        `import { cva } from "class-variance-authority"`,
        `export const buttonVariants = cva("inline-flex", { variants: { size: { sm: "h-8 px-3", lg: "h-10 px-6" } } })`,
        `export function Button({ className, size }: { className?: string; size?: "sm" | "lg" }) {`,
        `  return <button className={buttonVariants({ size }) + " " + (className ?? "")} />`,
        `}`,
      ].join("\n")
    )
    const page = write(
      "apps/web/src/page.tsx",
      `import { Button } from "@acme/ui/components/button"\nexport const Page = () => <Button className="p-4" />`
    )
    const messages = new Linter({ cwd: root }).verify(
      fs.readFileSync(page, "utf8"),
      {
        files: ["**/*.tsx"],
        languageOptions: {
          parser,
          parserOptions: { ecmaFeatures: { jsx: true } },
        },
        plugins: { shadcn: plugin },
        rules: { "shadcn/no-restyle": ["error", { allow: ["layout"] }] },
      } as any,
      { filename: page }
    )
    expect(messages.map((m) => [m.line, m.column, m.message])).toEqual([
      [
        2,
        45,
        expect.stringMatching(
          /^"p-4" is not allowed on <Button>: <Button> owns its spacing\. Use a size \(sm, lg\)/
        ),
      ],
    ])
    expect(warnings).toEqual([])
  })
})

// spartan's CLI writes a components.json of its own schema, with no
// aliases (libs/cli/src/utils/config.ts): componentsPath is the directory
// it generates components into, importAlias the prefix they are imported
// by, each with the CLI's default when left out.
describe("a spartan components.json", () => {
  let root: string
  function write(name: string, source: string) {
    const file = path.join(root, name)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, source)
    return file
  }
  const config = (json: object) =>
    write("components.json", JSON.stringify(json))
  const page = () => path.join(root, "src/app/app.component.html")
  const warnings: string[] = []
  beforeEach(() => {
    resetFsMemo()
    warnings.length = 0
    setWarningSink((message) => warnings.push(message))
    root = fs.realpathSync.native(
      fs.mkdtempSync(path.join(os.tmpdir(), "shadcn-lint-spartan-"))
    )
    write("package.json", "{}")
  })
  afterEach(() => {
    resetWarnings()
    setWarningSink((message) => console.warn(message))
    fs.rmSync(root, { recursive: true, force: true })
  })

  test("reads componentsPath as the ui directory, and the theme as before", () => {
    config({
      style: "vega",
      tailwind: { css: "src/styles.css" },
      componentsPath: "libs/kit",
      importAlias: "@acme/kit",
    })
    const button = write("libs/kit/button/src/lib/kit-button.ts", "")
    const project = projectFor(page())!
    expect(project.spartan).toEqual({
      componentsPath: "libs/kit",
      importAlias: "@acme/kit",
      ignored: [],
    })
    expect(project.cssFile).toBe(path.join(root, "src/styles.css"))
    expect(uiDirectory(project, true)).toBe(path.join(root, "libs/kit"))
    noteAngularCode(page(), true)
    expect(componentsFor(page()).owns(button)).toBe(true)
    expect(warnings).toEqual([])
  })

  // A barrel or a helper of an Angular app imports nothing from Angular,
  // and is the app's as much as its components are. The rules find what
  // a file is as they start on it.
  test("is read for a script of an Angular project", () => {
    config({ componentsPath: "libs/kit" })
    const button = write("libs/kit/button/src/lib/kit-button.ts", "")
    const barrel = write(
      "libs/kit/button/src/index.ts",
      `export * from "./lib/kit-button"`
    )
    const lint = (file: string) =>
      new Linter({ cwd: root }).verify(
        fs.readFileSync(file, "utf8"),
        {
          files: ["**/*.ts", "**/*.tsx"],
          languageOptions: {
            parser,
            parserOptions: { ecmaFeatures: { jsx: true } },
          },
          plugins: { shadcn: plugin },
          rules: { "shadcn/no-restyle": "error" },
        } as any,
        { filename: file }
      )
    // A dependency on Angular does not make a package's script Angular's.
    write(
      "package.json",
      JSON.stringify({ dependencies: { "@angular/core": "^22.0.0" } })
    )
    lint(barrel)
    expect(componentsFor(barrel).owns(button)).toBe(false)
    write(
      "angular.json",
      JSON.stringify({ projects: { kit: { root: "libs/kit" } } })
    )
    resetFsMemo()
    lint(barrel)
    expect(componentsFor(barrel).owns(button)).toBe(true)
    // A component file of another framework there reads it as upstream.
    const react = write("libs/kit/button/src/page.tsx", `export const A = 1`)
    lint(react)
    expect(componentsFor(react).owns(button)).toBe(false)
  })

  // shadcn's schema requires aliases, so a React components.json without
  // them reads the default alias, as upstream reads it.
  test("is read as upstream reads it for a React file", () => {
    config({ componentsPath: 1, buildable: false })
    const button = write("libs/ui/button/src/index.ts", "")
    const react = path.join(root, "src/app/page.tsx")
    noteAngularCode(react, false)
    expect(uiDirectory(projectFor(react)!)).toBeNull()
    expect(componentsFor(react).owns(button)).toBe(false)
    expect(warnings).toEqual([
      expect.stringContaining('The ui alias "@/components/ui"'),
    ])
  })

  test.each([
    ["Nx's fields alone", { buildable: true, generateAs: "library" }],
    ["importAlias alone", { importAlias: "@acme/kit" }],
  ])("takes the CLI's defaults for what it leaves out: %s", (_, json) => {
    config(json)
    write("libs/ui/button/src/index.ts", "")
    const project = projectFor(page())!
    expect(project.spartan).toEqual({
      componentsPath: "libs/ui",
      importAlias:
        "importAlias" in json ? json.importAlias : "@spartan-ng/helm",
      ignored: [],
    })
    expect(uiDirectory(project, true)).toBe(path.join(root, "libs/ui"))
    expect(warnings).toEqual([])
  })

  test("a componentsPath that is no directory warns once, naming it", () => {
    config({ componentsPath: "libs/ui" })
    const project = projectFor(page())!
    expect(uiDirectory(project, true)).toBeNull()
    uiDirectory(project, true)
    expect(warnings).toEqual([
      `[@shadcn/lint] The componentsPath "libs/ui" in ${path.join(root, "components.json")} is not a directory, so design-system components imported from "@spartan-ng/helm" are not recognized in this project. Fix componentsPath, or set componentImports.`,
    ])
  })

  test("a field that is no string is ignored with a warning", () => {
    config({ componentsPath: 1, importAlias: "@acme/kit" })
    write("libs/ui/button/src/index.ts", "")
    const project = projectFor(page())!
    expect(project.spartan?.componentsPath).toBe("libs/ui")
    expect(warnings).toEqual([])
    expect(uiDirectory(project, true)).toBe(path.join(root, "libs/ui"))
    uiDirectory(project, true)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain("componentsPath in")
  })

  // shadcn's, shadcn-vue's and shadcn-svelte's schemas have aliases and
  // none of spartan's fields.
  test("with aliases, spartan's fields are not read", () => {
    config({ aliases: { ui: "@/components/ui" }, componentsPath: "libs/ui" })
    write("libs/ui/button/src/index.ts", "")
    const project = projectFor(page())!
    expect(project.spartan).toBeUndefined()
    expect(uiDirectory(project)).toBeNull()
    expect(warnings.some((w) => w.includes('ui alias "@/components/ui"'))).toBe(
      true
    )
  })

  test("without aliases or any field of spartan's, the default alias as before", () => {
    config({ tailwind: { css: "src/styles.css" } })
    write("libs/ui/button/src/index.ts", "")
    const project = projectFor(page())!
    expect(project.spartan).toBeUndefined()
    expect(uiDirectory(project)).toBeNull()
    expect(warnings.some((w) => w.includes('ui alias "@/components/ui"'))).toBe(
      true
    )
  })
})

describe("the components.json of shadcn, shadcn-vue and shadcn-svelte", () => {
  const FIXTURE_DIR = path.dirname(PROJECT)
  test.each([
    ["project", "app/page.tsx", "components/ui"],
    ["vue-project", "src/App.vue", "src/components/ui"],
    ["svelte-project", "src/routes/+page.svelte", "src/lib/components/ui"],
  ])("%s reads its aliases, as upstream does", (fixture, file, ui) => {
    const dir = path.join(FIXTURE_DIR, fixture)
    const project = projectFor(path.join(dir, file))!
    expect(project.spartan).toBeUndefined()
    expect(uiDirectory(project)).toBe(
      fs.realpathSync.native(path.join(dir, ui))
    )
  })
})

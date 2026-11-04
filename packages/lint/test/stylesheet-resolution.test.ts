import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { compile } from "@tailwindcss/node"
import { afterEach, beforeEach, expect, test } from "vitest"

import { resetFsMemo } from "../src/project/fs"
import { resolveFile } from "../src/project/resolve"
import { resolveStylesheetImport } from "../src/project/stylesheets"
import { declaresClass } from "../src/project/theme"

let root: string
function write(file: string, value: string | object) {
  const target = path.join(root, file)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(
    target,
    typeof value === "string" ? value : JSON.stringify(value)
  )
  return target
}

beforeEach(() => {
  resetFsMemo()
  root = fs.realpathSync.native(
    fs.mkdtempSync(path.join(os.tmpdir(), "lint-styles-"))
  )
  write("package.json", { private: true })
})
afterEach(() => {
  resetFsMemo()
  fs.rmSync(root, { recursive: true, force: true })
})

const build = (id: string) =>
  compile(`@import "${id}";`, { base: root, onDependency() {} })

test("conditional package imports reach the same CSS as Tailwind", async () => {
  write("package.json", {
    imports: { "#theme": { style: "./theme.css", default: "./index.js" } },
  })
  const css = write("theme.css", ".theme-card { color: red; }")
  write("index.js", "export const value = 1;")
  expect((await build("#theme")).build([])).toContain(".theme-card")
  expect(resolveStylesheetImport(root, "#theme")).toBe(css)
  write("components.json", { tailwind: { css: "app.css" } })
  write("app.css", '@import "#theme";')
  expect(declaresClass(path.join(root, "page.tsx"), "theme-card")).toBe(true)
})

test("a default script export does not silently select adjacent CSS", async () => {
  write("node_modules/kit/package.json", {
    name: "kit",
    exports: { ".": { default: "./index.js" } },
  })
  write("node_modules/kit/index.js", "export const value = 1;")
  write("node_modules/kit/index.css", ".wrong-theme { color: red; }")
  await expect(build("kit")).rejects.toThrow()
  expect(resolveStylesheetImport(root, "kit")).toBeNull()
  write("components.json", { tailwind: { css: "app.css" } })
  write("app.css", '@import "kit";')
  expect(declaresClass(path.join(root, "page.tsx"), "wrong-theme")).toBe(false)
})

test("exports without a style condition do not fall through to the style field", async () => {
  write("node_modules/kit/package.json", {
    name: "kit",
    style: "./index.css",
    exports: { ".": { import: "./index.js" } },
  })
  write("node_modules/kit/index.js", "export const value = 1;")
  write("node_modules/kit/index.css", ".wrong-theme { color: red; }")
  await expect(build("kit")).rejects.toThrow()
  expect(resolveStylesheetImport(root, "kit")).toBeNull()
})

test("an exports array resolves its stylesheet without relying on index.css", async () => {
  write("node_modules/kit/package.json", {
    name: "kit",
    exports: { ".": [{ style: "./dist/theme.css" }] },
  })
  const css = write(
    "node_modules/kit/dist/theme.css",
    ".kit-card { color: red; }"
  )
  expect((await build("kit")).build([])).toContain(".kit-card")
  expect(resolveStylesheetImport(root, "kit")).toBe(css)
})

test("Angular stylesheet lookup retains preprocessor exports and target containment", () => {
  write("node_modules/kit/package.json", {
    name: "kit",
    exports: {
      ".": { style: "./theme.scss", import: "./index.js" },
      "./escape": { style: "../outside.scss" },
    },
  })
  const scss = write(
    "node_modules/kit/theme.scss",
    ".kit { .child { color: red; } }"
  )
  write("node_modules/kit/index.js", "export const value = 1;")
  write("node_modules/outside.scss", ".outside {}")
  expect(resolveFile("kit", root, root, [], { stylesheet: true })).toBe(scss)
  expect(
    resolveFile("kit/escape", root, root, [], { stylesheet: true })
  ).toBeNull()
  expect(resolveStylesheetImport(root, "kit")).toBeNull()
})

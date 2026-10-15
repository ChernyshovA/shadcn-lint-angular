// components.json can name a stylesheet that is not there, or one that
// declares tokens without importing Tailwind. Either is a wrong path, not
// a project without a theme: it warns once and the theme is discovered in
// the meantime, so the checks stay on.

import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { afterEach, beforeEach, expect, test } from "vitest"

import { resetFsMemo } from "../src/project/fs"
import {
  colorTokensFor,
  tailwindEntryFor,
  themeFileFor,
} from "../src/project/theme"
import { resetWarnings, setWarningSink } from "../src/project/warn"

const warnings: string[] = []
let root: string

function write(name: string, source: string) {
  const file = path.join(root, name)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, source)
  return file
}

beforeEach(() => {
  warnings.length = 0
  resetWarnings()
  resetFsMemo()
  setWarningSink((message) => warnings.push(message))
  root = fs.realpathSync.native(
    fs.mkdtempSync(path.join(os.tmpdir(), "lint-theme-path-"))
  )
  write("package.json", JSON.stringify({ private: true }))
  write(
    "components.json",
    JSON.stringify({
      aliases: { ui: "@/components/ui" },
      tailwind: { css: "src/styles/globals.css" },
    })
  )
})

afterEach(() => {
  setWarningSink((message) => console.warn(message))
  fs.rmSync(root, { recursive: true, force: true })
})

test("a missing tailwind.css path warns once and falls back to discovery", () => {
  const real = write(
    "src/app/globals.css",
    '@import "tailwindcss";\n@theme { --color-brand: #f00; }\n'
  )
  const page = path.join(root, "src/app/page.tsx")
  expect(themeFileFor(page)).toBe(real)
  expect(colorTokensFor(page)).toEqual(new Set(["brand"]))
  themeFileFor(page)
  expect(warnings).toHaveLength(1)
  expect(warnings[0]).toContain("src/styles/globals.css")
  expect(warnings[0]).toContain("does not exist")
  expect(warnings[0]).toContain("Using src/app/globals.css")
})

test("with nothing to discover, the warning says the token check is off", () => {
  const page = path.join(root, "src/app/page.tsx")
  expect(themeFileFor(page)).toBeNull()
  expect(colorTokensFor(page)).toBeNull()
  expect(warnings).toHaveLength(1)
  expect(warnings[0]).toContain("src/styles/globals.css")
  expect(warnings[0]).toContain("no-raw-colors cannot check declared tokens")
})

test("a tailwind.css that does not import Tailwind warns once and falls back", () => {
  const configured = write(
    "src/styles/globals.css",
    "@theme inline { --color-brand: #f00; }\n"
  )
  const entry = write("src/app/app.css", '@import "tailwindcss";\n')
  const page = path.join(root, "src/app/page.tsx")
  // The partial is still the theme: its tokens are the project's.
  expect(themeFileFor(page)).toBe(configured)
  expect(colorTokensFor(page)).toEqual(new Set(["brand"]))
  expect(tailwindEntryFor(page)).toBe(entry)
  tailwindEntryFor(page)
  expect(warnings).toHaveLength(1)
  expect(warnings[0]).toContain("src/styles/globals.css")
  expect(warnings[0]).toContain("does not import Tailwind")
  expect(warnings[0]).toContain("Using src/app/app.css")
})

test("with no Tailwind entry to discover, the warning says the grammar answers", () => {
  write("src/styles/globals.css", "@theme inline { --color-brand: #f00; }\n")
  const page = path.join(root, "src/app/page.tsx")
  expect(tailwindEntryFor(page)).toBeNull()
  expect(warnings).toHaveLength(1)
  expect(warnings[0]).toContain("grammar bundled with shadcn-lint-angular")
})

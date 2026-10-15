// The built plugin under Bun's runtime, the way `bun --bun lint` starts
// ESLint or Oxlint: the output has to match the same run under Node.
// The Tailwind worker's synchronous bridge (worker_threads, Atomics.wait,
// receiveMessageOnPort) is what another runtime could break. A plain
// `bun lint` runs the linter's bin under Node, which the other suites
// cover. Needs a build and `bun` on PATH.

import { spawnSync } from "node:child_process"
import * as fs from "node:fs"
import { createRequire } from "node:module"
import * as os from "node:os"
import * as path from "node:path"
import { pathToFileURL } from "node:url"
import { stripVTControlCharacters } from "node:util"
import { afterAll, beforeAll, describe, expect, test } from "vitest"

import { binOf, buildUsable, PKG_DIR, plugin } from "./built"

// Bun starts faster than Node, but both runs start the Tailwind worker
// cold.
const RUN_TIMEOUT = 60_000
const PROJECT = path.join(PKG_DIR, "test/fixtures/project")
const FILE = "app/oxlint.tsx"

const RULES = {
  "shadcn/no-restyle": "error",
  "shadcn/no-raw-colors": "error",
  "shadcn/no-arbitrary-values": "error",
  "shadcn/no-inline-styles": "error",
  "shadcn/require-static-classes": "error",
  "shadcn/no-unknown-classes": "error",
}

const NODE = process.execPath
const BUN = "bun"

const bunAvailable = spawnSync(BUN, ["--version"]).status === 0

// CI installs Bun, so a missing one there would hide a runtime break
// behind a green run.
if (!bunAvailable && process.env.CI) {
  throw new Error("test/bun.test.ts needs `bun` on PATH in CI.")
}

let dir: string
let eslintConfig: string
let oxlintConfig: string

// `bun <file>` runs it in Bun's runtime, as `bun --bun lint` does for a
// script whose bin starts with a node shebang.
function lint(runtime: string, args: string[]) {
  const result = spawnSync(runtime, args, {
    cwd: PROJECT,
    encoding: "utf-8",
    timeout: RUN_TIMEOUT,
  })
  if (result.error) throw result.error
  return (
    stripVTControlCharacters(result.stdout + result.stderr)
      // Oxlint's summary times the run.
      .replace(/^Finished in .*$/m, "")
  )
}

describe.skipIf(!buildUsable || !bunAvailable)(
  "bun",
  { timeout: RUN_TIMEOUT * 2 },
  () => {
    // The configs live outside the fixture so nothing is written into the
    // tree. ESLint imports the parser and plugin by URL from there.
    beforeAll(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), "shadcn-lint-bun-"))
      const parser = createRequire(import.meta.url).resolve(
        "@typescript-eslint/parser"
      )
      eslintConfig = path.join(dir, "eslint.config.mjs")
      fs.writeFileSync(
        eslintConfig,
        `import parser from ${JSON.stringify(pathToFileURL(parser).href)}
import { plugin } from ${JSON.stringify(pathToFileURL(plugin).href)}

export default [
  {
    files: ["**/*.tsx"],
    languageOptions: { parser, parserOptions: { ecmaFeatures: { jsx: true } } },
    plugins: { shadcn: plugin },
    rules: ${JSON.stringify(RULES)},
  },
]
`
      )
      oxlintConfig = path.join(dir, ".oxlintrc.json")
      fs.writeFileSync(
        oxlintConfig,
        JSON.stringify({ jsPlugins: [plugin], rules: RULES })
      )
    })

    afterAll(() => {
      fs.rmSync(dir, { recursive: true, force: true })
    })

    test("ESLint reports the same under Bun as under Node", () => {
      const args = [
        binOf("eslint"),
        "--format",
        "stylish",
        "-c",
        eslintConfig,
        FILE,
      ]
      const out = lint(BUN, args)
      for (const rule of Object.keys(RULES)) expect(out).toContain(rule)
      // A worker that failed under Bun would fall back with a warning.
      expect(out).not.toContain("[shadcn-lint-angular]")
      expect(out).toBe(lint(NODE, args))
    })

    test("Oxlint reports the same under Bun as under Node", () => {
      const args = [
        binOf("oxlint"),
        "--format",
        "default",
        "-c",
        oxlintConfig,
        FILE,
      ]
      const out = lint(BUN, args)
      for (const rule of Object.keys(RULES)) {
        expect(out).toContain(`shadcn(${rule.slice("shadcn/".length)})`)
      }
      expect(out).not.toContain("[shadcn-lint-angular]")
      expect(out).toBe(lint(NODE, args))
    })
  }
)

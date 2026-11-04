// Check the packed declarations in independent ESLint 9/10 consumers.
// A valid config alone cannot detect a disconnected augmentation: the
// deliberately invalid options must fail too, in both ESM and CommonJS.
// Build first, then: node scripts/smoke-types.mjs [--tarball /path/pkg.tgz]
import { spawnSync } from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { fileURLToPath } from "node:url"

const pkg = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const root = fs.mkdtempSync(path.join(os.tmpdir(), "shadcn-lint-types-"))
const npm = [
  process.env.npm_execpath,
  path.join(path.dirname(process.execPath), "node_modules/npm/bin/npm-cli.js"),
  path.resolve(
    path.dirname(process.execPath),
    "../lib/node_modules/npm/bin/npm-cli.js"
  ),
].find((file) => file?.endsWith("npm-cli.js") && fs.existsSync(file))
if (!npm) throw new Error("Cannot find npm-cli.js beside the Node runtime")

function run(args, cwd, expected = 0) {
  const result = spawnSync(process.execPath, args, { cwd, encoding: "utf8" })
  if (result.error) throw result.error
  const output = result.stdout + result.stderr
  if (result.status !== expected) {
    throw new Error(
      `Expected exit ${expected}, got ${result.status}:\n${output}`
    )
  }
  return result.stdout
}

function json(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2))
}

try {
  const flag = process.argv.indexOf("--tarball")
  let tarball
  if (flag !== -1) {
    if (!process.argv[flag + 1]) throw new Error("--tarball needs a path")
    tarball = path.resolve(process.argv[flag + 1])
  } else {
    const packed = run([npm, "pack", "--json", "--pack-destination", root], pkg)
    tarball = path.join(root, JSON.parse(packed)[0].filename)
  }

  for (const eslint of ["9.39.5", "10.14.0"]) {
    const dir = path.join(root, `eslint-${eslint}`)
    fs.mkdirSync(dir)
    json(path.join(dir, "package.json"), {
      name: "shadcn-lint-types-consumer",
      private: true,
      type: "module",
      dependencies: {
        eslint,
        typescript: "5.9.3",
        "@types/node": "24.19.2",
        "shadcn-lint-angular": `file:${tarball}`,
      },
    })
    run([npm, "install", "--ignore-scripts", "--no-audit", "--no-fund"], dir)
    json(path.join(dir, "tsconfig.json"), {
      compilerOptions: {
        target: "ES2022",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        strict: true,
        allowJs: true,
        checkJs: true,
        skipLibCheck: false,
        noEmit: true,
        types: ["node"],
      },
      files: ["valid.mts", "valid.cts", "documented.cjs"],
    })
    const valid = `
import { plugin } from "shadcn-lint-angular";
import { defineConfig } from "eslint/config";
import type { Linter } from "eslint";
export const plain = { rules: { "no-debugger": "error" } } satisfies Linter.Config;
export const configured = defineConfig({
  plugins: { shadcn: plugin },
  rules: { "shadcn/no-restyle": ["error", { allow: ["layout"], multipleContracts: "all" }] },
});
`
    const invalid = `
import "shadcn-lint-angular";
import type { Linter } from "eslint";
export const invalid = { rules: { "shadcn/no-restyle": ["error", { allow: 5 }] } } satisfies Linter.Config;
`
    for (const extension of ["mts", "cts"]) {
      fs.writeFileSync(path.join(dir, `valid.${extension}`), valid)
      fs.writeFileSync(path.join(dir, `invalid.${extension}`), invalid)
    }
    fs.writeFileSync(
      path.join(dir, "documented.cjs"),
      `
const { plugin: shadcn } = require("shadcn-lint-angular");
const { defineConfig } = require("eslint/config");
/** @type {import("eslint").Linter.Config["rules"]} */
const rules = { "shadcn/no-raw-colors": "error" };
module.exports = defineConfig([{ plugins: { shadcn }, rules }]);
`
    )
    const tsc = path.join(dir, "node_modules/typescript/bin/tsc")
    run([tsc, "-p", "tsconfig.json", "--pretty", "false"], dir)
    json(path.join(dir, "tsconfig.invalid.json"), {
      extends: "./tsconfig.json",
      files: ["invalid.mts", "invalid.cts"],
    })
    const rejected = run(
      [tsc, "-p", "tsconfig.invalid.json", "--pretty", "false"],
      dir,
      2
    )
    const errors = rejected.trim().split("\n")
    if (
      errors.length !== 2 ||
      !["mts", "cts"].every((extension) =>
        errors.some(
          (line) =>
            line.startsWith(`invalid.${extension}(`) &&
            line.includes("error TS2322:")
        )
      )
    ) {
      throw new Error(`Wrong negative-control diagnostics:\n${rejected}`)
    }
    console.log(
      `ok ESLint ${eslint}: strict ESM/CJS configs, plain rules, invalid options rejected`
    )
  }
  fs.rmSync(root, { recursive: true, force: true })
} catch (error) {
  console.error(`Type consumer fixtures retained at ${root}`)
  throw error
}

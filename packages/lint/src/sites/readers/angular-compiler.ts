// The compiler angular-eslint bundles. Every Angular project that lints
// with angular-eslint has it, so it is an optional peer: looked up from
// the file being linted and the angular-eslint its project installs, the
// version its templates are parsed with, then from this package.

import { createRequire } from "node:module"
import * as path from "node:path"

const require = createRequire(import.meta.url)

const NAME = "@angular-eslint/bundled-angular-compiler"

const byDirectory = new Map<string, any>()

function load(directory: string) {
  const from = createRequire(path.join(directory, "package.json"))
  const attempts = [
    () => from(NAME),
    ...["@angular-eslint/template-parser", "angular-eslint"].map(
      (via) => () => createRequire(from.resolve(via))(NAME)
    ),
    () => require(NAME),
  ]
  for (const attempt of attempts) {
    try {
      const found = attempt()
      if (typeof found?.makeBindingParser === "function") return found
    } catch {
      // Not installed where this looked.
    }
  }
  return null
}

let override: any

// Tests stand in a compiler, or its absence with null.
export function setAngularCompilerForTests(compiler: any) {
  override = compiler
}

// Null when neither the file's project nor this package has it.
export function angularCompiler(file: string | null | undefined) {
  if (override !== undefined) return override
  const directory = file ? path.dirname(path.resolve(file)) : process.cwd()
  let compiler = byDirectory.get(directory)
  if (compiler === undefined) {
    compiler = load(directory)
    byDirectory.set(directory, compiler)
  }
  return compiler
}

const files = new WeakMap<object, string>()

// A reader is handed nodes, not the linter's context, so each rule
// records the file its AST was parsed from as it starts.
export function recordFile(program: any, file: string) {
  if (program && typeof program === "object" && file) files.set(program, file)
}

export function fileOfNode(node: any): string | null {
  while (node?.parent) node = node.parent
  return (node && files.get(node)) ?? null
}

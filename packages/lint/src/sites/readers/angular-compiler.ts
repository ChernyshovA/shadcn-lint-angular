// The compiler angular-eslint bundles, an optional peer: every project
// linting with angular-eslint has it. Looked up from the linted file
// first, so it is the version its templates are parsed with.

import { createRequire } from "node:module"
import * as path from "node:path"

const require = createRequire(import.meta.url)

const NAME = "@angular-eslint/bundled-angular-compiler"

// A miss is looked for again after a while, so a compiler installed
// mid-session is found.
const byDirectory = new Map<string, { compiler: any; at: number }>()
const RETRY_AFTER = 5000

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

export function angularCompiler(file: string | null | undefined) {
  const directory = file ? path.dirname(path.resolve(file)) : process.cwd()
  const found = byDirectory.get(directory)
  if (found && (found.compiler || Date.now() - found.at < RETRY_AFTER)) {
    return found.compiler
  }
  const compiler = load(directory)
  byDirectory.set(directory, { compiler, at: Date.now() })
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

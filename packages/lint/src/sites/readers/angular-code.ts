// Angular code: a template, in an .html file or inline; a script that
// imports Angular; and any other script of an Angular project, a barrel
// or a helper of its components, which imports nothing from Angular
// itself (project/angular-workspace.ts). What this plugin reads the
// Angular way it reads only there, so a React, Vue or Svelte file, and
// any file outside an Angular project, lints as it does without it.

import { inAngularProject } from "../../project/angular-workspace"

const scripts = new WeakMap<object, boolean>()

// Whether a program imports from an `@angular/` package.
export function importsAngular(program: any): boolean {
  return (program.body ?? []).some(
    (statement: any) =>
      statement?.type === "ImportDeclaration" &&
      typeof statement.source?.value === "string" &&
      statement.source.value.startsWith("@angular/")
  )
}

// A component file of another framework, by its name: React's, Vue's or
// Svelte's is theirs inside an Angular project too.
const COMPONENT_FILE = /\.(?:[jt]sx|vue|svelte|astro|mdx)$/i

// A script of an Angular project. What the linter names when it is given
// no file, `<input>`, lies in none.
function isProjectScript(context: any) {
  const file: string = context.physicalFilename ?? context.getFilename?.() ?? ""
  if (!file || file.startsWith("<") || COMPONENT_FILE.test(file)) {
    return false
  }
  return inAngularProject(file)
}

export function isAngularCode(context: any) {
  const services = context?.sourceCode?.parserServices
  if (typeof services?.convertElementSourceSpanToLoc === "function") return true
  if (services?.isSvelte) return false
  if (typeof services?.defineTemplateBodyVisitor === "function") return false
  const program = context?.sourceCode?.ast
  if (!program || typeof program !== "object") return false
  const known = scripts.get(program)
  if (known !== undefined) return known
  const angular = importsAngular(program) || isProjectScript(context)
  scripts.set(program, angular)
  return angular
}

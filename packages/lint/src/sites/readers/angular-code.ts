// Angular code: a template, a script importing `@angular/`, or any other
// script inside an Angular project, such as a barrel or a helper. Only it
// is read the Angular way, so React, Vue and Svelte files, and files
// outside an Angular project, lint as they would without Angular support.

import { inAngularProject } from "../../project/angular-workspace"

const scripts = new WeakMap<object, boolean>()

export function importsAngular(program: any): boolean {
  return (program.body ?? []).some(
    (statement: any) =>
      statement?.type === "ImportDeclaration" &&
      typeof statement.source?.value === "string" &&
      statement.source.value.startsWith("@angular/")
  )
}

// Another framework's component file stays its own inside an Angular project.
const COMPONENT_FILE = /\.(?:[jt]sx|vue|svelte|astro|mdx)$/i

// `<input>`, the name of text linted with no file, lies in no project.
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

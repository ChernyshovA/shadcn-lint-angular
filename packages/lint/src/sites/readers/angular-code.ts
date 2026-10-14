// Angular code: a template, in an .html file or inline, or a script that
// imports Angular. What this plugin reads the Angular way it reads only
// there, so a React, Vue or Svelte file lints as it does without it.

const scripts = new WeakMap<object, boolean>()

function importsAngular(program: any): boolean {
  return (program.body ?? []).some(
    (statement: any) =>
      statement?.type === "ImportDeclaration" &&
      typeof statement.source?.value === "string" &&
      statement.source.value.startsWith("@angular/")
  )
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
  const angular = importsAngular(program)
  scripts.set(program, angular)
  return angular
}

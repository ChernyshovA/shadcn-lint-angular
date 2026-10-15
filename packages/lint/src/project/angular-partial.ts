// What an Angular library's published JavaScript says its directives and
// components put on their element, read from the syntax alone the way the
// Angular linker reads a partial declaration (@angular/compiler-cli/linker,
// partial_directive_linker_1 and partial_component_linker_1):
//
//   static ɵdir = i0.ɵɵngDeclareDirective({ minVersion: "14.0.0",
//     version: "22.1.2", type: Ripple, isStandalone: true,
//     selector: "[pRipple]", host: { classAttribute: "p-ripple" },
//     usesInheritance: true, ngImport: i0 });
//
// The .d.ts says nothing of `host`; this does. As for a .d.ts, only a
// summary of each file is kept.

import * as fs from "node:fs"
import * as path from "node:path"

import { exportsTarget, jsonAt, packageOf, type Owner } from "./angular-dts"
import { walk } from "./ast"
import { findUp, isFile, memoize, mtimeOf, realpath } from "./fs"
import { parseSource } from "./parser"
import { warnOnce } from "./warn"

// `X`, or `i1.X` through a namespace import.
type Ref = { name: string; member: string | null }

type Declaration = {
  selector: string | null
  // Whether its host puts a class on its element; null for a host this
  // cannot read.
  classes: boolean | null
  // The directives it hosts; null for a list this cannot read.
  hostDirectives: Ref[] | null
  inherits: boolean
}

type JsClass = {
  declaration: Declaration | null
  // The class it extends; "dynamic" for an expression this cannot
  // follow, or a declaration whose class this does not see.
  base: Ref | "dynamic" | null
}

// As DtsFile in angular-dts.ts.
type JsFile = {
  imports: Map<string, { spec: string; name: string }>
  exports: Map<string, { spec: string | null; name: string }>
  stars: string[]
  classes: Map<string, JsClass>
}

// The Angular whose linker this reads as. A linker refuses a declaration
// whose minVersion is newer than itself: that is how a later Angular
// marks a form an earlier one cannot link.
const NEWEST = 22

const DECLARE = new Set(["ɵɵngDeclareDirective", "ɵɵngDeclareComponent"])

// What `host` holds in a partial declaration (R3DeclareDirectiveMetadata).
const HOST_KEYS = new Set([
  "attributes",
  "listeners",
  "properties",
  "classAttribute",
  "styleAttribute",
])

// Host bindings that land on the element's class, in step with
// ON_ELEMENT in angular-restyle.ts; `className` is the property `class`
// reflects to.
export const CLASS_BINDING = /^(?:class(?:\.|$)|attr\.class$|className$)/

const MAX_DEPTH = 16

function nameOf(node: any): string | null {
  if (node?.type === "Identifier") return node.name
  return stringOf(node)
}

function stringOf(node: any): string | null {
  return node?.type === "Literal" && typeof node.value === "string"
    ? node.value
    : null
}

function refOf(node: any): Ref | null {
  if (node?.type === "Identifier") return { name: node.name, member: null }
  if (
    node?.type === "MemberExpression" &&
    !node.computed &&
    node.object?.type === "Identifier" &&
    node.property?.type === "Identifier"
  ) {
    return { name: node.object.name, member: node.property.name }
  }
  return null
}

// A host directive as the linker takes it: `i1.Bind`, or
// `i0.forwardRef(() => Bind)` for one declared after its host.
function hostRefOf(node: any): Ref | null {
  const callee = node?.type === "CallExpression" ? node.callee : null
  if (!callee) return refOf(node)
  const name =
    callee.type === "MemberExpression"
      ? nameOf(callee.property)
      : nameOf(callee)
  if (name !== "forwardRef") return null
  const fn = node.arguments?.[0]
  const body = fn?.body
  if (body?.type !== "BlockStatement") return refOf(body)
  const [only] = body.body ?? []
  return body.body?.length === 1 && only.type === "ReturnStatement"
    ? refOf(only.argument)
    : null
}

// Null for an object a spread or a computed key can add to.
function propertiesOf(node: any): Map<string, any> | null {
  if (node?.type !== "ObjectExpression") return null
  const out = new Map<string, any>()
  for (const property of node.properties ?? []) {
    if (property.type !== "Property" || property.computed) return null
    const key = nameOf(property.key)
    if (key === null) return null
    out.set(key, property.value)
  }
  return out
}

function classesOf(host: any): boolean | null {
  if (host === undefined) return false
  const keys = propertiesOf(host)
  if (!keys || [...keys.keys()].some((key) => !HOST_KEYS.has(key))) {
    return null
  }
  if (keys.has("classAttribute")) return true
  const properties = keys.get("properties")
  if (properties === undefined) return false
  const bound = propertiesOf(properties)
  return bound ? [...bound.keys()].some((key) => CLASS_BINDING.test(key)) : null
}

function hostDirectivesOf(list: any): Ref[] | null {
  if (list === undefined) return []
  if (list?.type !== "ArrayExpression") return null
  const out: Ref[] = []
  for (const element of list.elements ?? []) {
    const ref = hostRefOf(propertiesOf(element)?.get("directive"))
    if (!ref) return null
    out.push(ref)
  }
  return out
}

function majorOf(version: any) {
  const major = /^(\d+)\./.exec(stringOf(version) ?? "")
  return major ? Number(major[1]) : null
}

// ɵɵngDeclareDirective or ɵɵngDeclareComponent as the linker reads it:
// one object, whose `type` is the class it declares.
function declarationOf(
  call: any
): { type: string; declaration: Declaration } | null {
  const callee = call.callee
  const fn =
    callee?.type === "MemberExpression"
      ? nameOf(callee.property)
      : nameOf(callee)
  if (!fn || !DECLARE.has(fn) || call.arguments?.length !== 1) return null
  const meta = propertiesOf(call.arguments[0])
  const type = meta?.get("type")
  const major = majorOf(meta?.get("minVersion"))
  if (!meta || type?.type !== "Identifier" || major === null) return null
  if (major > NEWEST) return null
  const selector = meta.get("selector")
  if (selector !== undefined && stringOf(selector) === null) return null
  const inherits = meta.get("usesInheritance")
  return {
    type: type.name,
    declaration: {
      selector: selector === undefined ? null : stringOf(selector),
      classes: classesOf(meta.get("host")),
      hostDirectives: hostDirectivesOf(meta.get("hostDirectives")),
      // Written as `true`; anything else but `false` may be.
      inherits: !(inherits === undefined || inherits.value === false),
    },
  }
}

function superOf(node: any): JsClass["base"] {
  const base = node?.superClass
  if (!base) return null
  return refOf(base) ?? "dynamic"
}

function extract(program: any) {
  const file: JsFile = {
    imports: new Map(),
    exports: new Map(),
    stars: [],
    classes: new Map(),
  }
  const declare = (node: any, exported: boolean) => {
    const names: string[] = []
    if (node?.type === "ClassDeclaration" && node.id?.name) {
      names.push(node.id.name)
      file.classes.set(node.id.name, { declaration: null, base: superOf(node) })
    } else if (node?.type === "FunctionDeclaration" && node.id?.name) {
      names.push(node.id.name)
    } else if (node?.type === "VariableDeclaration") {
      for (const declarator of node.declarations ?? []) {
        if (declarator.id?.type !== "Identifier") continue
        names.push(declarator.id.name)
        // `let X = class X { … }`, as TypeScript writes a class another
        // decorator is kept on.
        if (declarator.init?.type === "ClassExpression") {
          file.classes.set(declarator.id.name, {
            declaration: null,
            base: superOf(declarator.init),
          })
        }
      }
    }
    if (exported) {
      for (const name of names) file.exports.set(name, { spec: null, name })
    }
  }
  for (const statement of program?.body ?? []) {
    if (statement.type === "ImportDeclaration") {
      const spec = statement.source?.value
      if (typeof spec !== "string") continue
      for (const specifier of statement.specifiers ?? []) {
        const local = specifier.local?.name
        if (!local) continue
        file.imports.set(local, {
          spec,
          name:
            specifier.type === "ImportNamespaceSpecifier"
              ? "*"
              : specifier.type === "ImportDefaultSpecifier"
                ? "default"
                : (nameOf(specifier.imported) ?? local),
        })
      }
    } else if (statement.type === "ExportNamedDeclaration") {
      if (statement.declaration) {
        declare(statement.declaration, true)
        continue
      }
      const spec =
        typeof statement.source?.value === "string"
          ? statement.source.value
          : null
      for (const specifier of statement.specifiers ?? []) {
        const local = nameOf(specifier.local)
        const exported = nameOf(specifier.exported) ?? local
        if (!local || !exported) continue
        file.exports.set(exported, { spec, name: local })
      }
    } else if (statement.type === "ExportAllDeclaration") {
      const spec = statement.source?.value
      if (typeof spec !== "string") continue
      const exported = nameOf(statement.exported)
      if (exported) file.exports.set(exported, { spec, name: "*" })
      else file.stars.push(spec)
    } else if (statement.type === "ExportDefaultDeclaration") {
      const node = statement.declaration
      declare(node, false)
      if (node?.id?.name) {
        file.exports.set("default", { spec: null, name: node.id.name })
      }
    } else {
      declare(statement, false)
    }
  }
  // A declaration sits in its class as a static field, in a static
  // block as Angular 16 wrote it, or after it as an assignment, as
  // Angular 15 did.
  let read = 0
  walk(program, (node) => {
    if (node.type !== "CallExpression") return
    const found = declarationOf(node)
    if (!found) return
    read++
    const cls = file.classes.get(found.type)
    if (cls) cls.declaration = found.declaration
    else {
      file.classes.set(found.type, {
        declaration: found.declaration,
        base: "dynamic",
      })
    }
  })
  return { file, read }
}

// A call to a declaration function, not the function @angular/core
// defines under that name.
const DECLARATIONS =
  /(?<!\bfunction\s*)ɵɵngDeclare(?:Directive|Component)\s*\(/g

const files = new Map<
  string,
  { version: string | null; mtimeMs: number; file: JsFile | null }
>()

// As dtsFile in angular-dts.ts.
function jsFile(file: string): JsFile | null {
  const mtimeMs = mtimeOf(file)
  if (mtimeMs === null) return null
  const pkg = packageOf(file)
  const version = pkg?.version ?? null
  const cached = files.get(file)
  if (cached && cached.mtimeMs === mtimeMs && cached.version === version) {
    return cached.file
  }
  let source = ""
  try {
    source = fs.readFileSync(file, "utf8")
  } catch {
    // Unreadable: it declares nothing.
  }
  const declared = source.match(DECLARATIONS)?.length ?? 0
  let extracted: ReturnType<typeof extract> | null = null
  if (source) {
    try {
      extracted = extract(parseSource(source, file))
    } catch {
      // A syntax this parser does not take: nothing is read.
    }
  }
  if (declared && !extracted?.read) {
    const where = pkg ? path.relative(pkg.dir, file) : file
    const name = pkg ? `${pkg.name}${version ? ` ${version}` : ""}` : where
    warnOnce(
      `angular-partial:${pkg?.dir ?? file}:${version}`,
      `The Angular declarations in ${name} cannot be read: ${where.replace(/\\/g, "/")} has ${declared}, none of them in the form the linker of Angular ${NEWEST} reads. Until they can be, shadcn/no-restyle takes its directives for ones that may style their element, as it does without the package's JavaScript.`
    )
  }
  const kept = extracted?.file ?? null
  files.set(file, { version, mtimeMs, file: kept })
  return kept
}

export function scriptFilesReadForTests() {
  return [...files.keys()]
}

export function resetScriptFilesForTests() {
  files.clear()
}

// `./x.mjs` itself, or `./x` with an extension or as a directory's index.
function scriptFile(base: string) {
  const candidates = [base]
  for (const ext of [".mjs", ".js"]) candidates.push(`${base}${ext}`)
  for (const ext of [".mjs", ".js"])
    candidates.push(path.join(base, `index${ext}`))
  const found = candidates.find((candidate) => isFile(candidate))
  return found ? realpath(found) : null
}

// What an `exports` value gives for code: the conditions a bundler
// reads for a browser build, then those the Angular Package Format wrote
// before 17. Never a declaration file.
const SCRIPT_CONDITIONS = [
  "import",
  "module",
  "default",
  "es2022",
  "esm2022",
  "esm",
  "es2020",
  "esm2020",
  "es2015",
  "browser",
  "node",
]

function scriptTarget(value: any): string | null {
  if (typeof value === "string") {
    return /\.d\.[cm]?ts$/.test(value) ? null : value
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const target = scriptTarget(item)
      if (target) return target
    }
    return null
  }
  if (!value || typeof value !== "object") return null
  for (const key of SCRIPT_CONDITIONS) {
    if (key in value) {
      const target = scriptTarget(value[key])
      if (target) return target
    }
  }
  return null
}

// A package's module for a subpath, found as its .d.ts is: its
// `exports`, else `module`, else the files themselves.
function scriptEntry(dir: string, subpath: string) {
  const manifest = jsonAt(path.join(dir, "package.json"))
  if (manifest?.exports && typeof manifest.exports === "object") {
    const target = exportsTarget(
      manifest.exports,
      subpath ? `./${subpath}` : ".",
      scriptTarget
    )
    return target ? scriptFile(path.resolve(dir, target)) : null
  }
  const at = subpath ? path.join(dir, subpath) : dir
  const own = subpath ? jsonAt(path.join(at, "package.json")) : manifest
  if (typeof own?.module === "string") {
    const found = scriptFile(path.resolve(at, own.module))
    if (found) return found
  }
  return scriptFile(subpath ? at : path.join(dir, "index"))
}

function resolveScript(spec: string, fromFile: string): string | null {
  const dir = path.dirname(fromFile)
  return memoize(`angular-partial:resolve:${dir}\u0000${spec}`, () => {
    if (spec.startsWith(".") || path.isAbsolute(spec)) {
      return scriptFile(path.resolve(dir, spec))
    }
    const parts = spec.split("/")
    const length = spec.startsWith("@") ? 2 : 1
    if (parts.length < length) return null
    const found = findUp(
      dir,
      path.join("node_modules", ...parts.slice(0, length))
    )
    return found
      ? scriptEntry(realpath(found), parts.slice(length).join("/"))
      : null
  })
}

type JsValue = { file: string; cls: JsClass }

function visited(seen: Set<string>, kind: string, file: string, name: string) {
  const key = `${kind}\u0000${file}\u0000${name}`
  if (seen.has(key)) return true
  seen.add(key)
  return false
}

// As dtsExport and dtsLocal in angular-dts.ts, for a module.
function scriptExport(
  file: string,
  name: string,
  deps: Set<string>,
  depth = 0,
  seen = new Set<string>()
): JsValue | null {
  if (depth > MAX_DEPTH || visited(seen, "export", file, name)) return null
  deps.add(file)
  const read = jsFile(file)
  if (!read) return null
  const binding = read.exports.get(name)
  if (binding) {
    if (binding.spec === null)
      return scriptLocal(file, binding.name, deps, depth + 1, seen)
    if (binding.name === "*") return null
    const target = resolveScript(binding.spec, file)
    return target
      ? scriptExport(target, binding.name, deps, depth + 1, seen)
      : null
  }
  for (const spec of read.stars) {
    const target = resolveScript(spec, file)
    const found = target
      ? scriptExport(target, name, deps, depth + 1, seen)
      : null
    if (found) return found
  }
  return null
}

function scriptLocal(
  file: string,
  name: string,
  deps: Set<string>,
  depth = 0,
  seen = new Set<string>()
): JsValue | null {
  if (depth > MAX_DEPTH || visited(seen, "local", file, name)) return null
  deps.add(file)
  const read = jsFile(file)
  if (!read) return null
  const cls = read.classes.get(name)
  if (cls) return { file, cls }
  const imported = read.imports.get(name)
  if (!imported || imported.name === "*") return null
  const target = resolveScript(imported.spec, file)
  return target
    ? scriptExport(target, imported.name, deps, depth + 1, seen)
    : null
}

function scriptRef(file: string, ref: Ref, deps: Set<string>) {
  if (ref.member === null) return scriptLocal(file, ref.name, deps)
  deps.add(file)
  const imported = jsFile(file)?.imports.get(ref.name)
  if (imported?.name !== "*") return null
  const target = resolveScript(imported.spec, file)
  return target ? scriptExport(target, ref.member, deps) : null
}

// Three-valued or; null is unknown.
function either(values: (boolean | null)[]) {
  if (values.includes(true)) return true
  return values.includes(null) ? null : false
}

// Its own host, the directives it hosts and, when it inherits, those of
// each class up its chain, as ɵɵInheritDefinitionFeature walks the
// prototype chain past classes Angular does not know. A class reached
// again adds nothing: what it gives is in the answer already.
function stylesOf(
  found: JsValue,
  deps: Set<string>,
  depth: number,
  seen = new Set<JsClass>()
) {
  if (depth > MAX_DEPTH) return null
  const own = found.cls.declaration
  if (!own) return null
  if (seen.has(found.cls)) return false
  const values: (boolean | null)[] = []
  let at: JsValue | null = found
  for (let up = 0; at; up++) {
    if (up > 0 && seen.has(at.cls)) break
    seen.add(at.cls)
    const { declaration, base } = at.cls
    if (declaration) {
      values.push(declaration.classes)
      if (!declaration.hostDirectives) values.push(null)
      for (const ref of declaration.hostDirectives ?? []) {
        const host = scriptRef(at.file, ref, deps)
        values.push(host ? stylesOf(host, deps, depth + 1, seen) : null)
      }
    }
    if (values.includes(true) || !own.inherits || !base) break
    if (base === "dynamic" || up >= MAX_DEPTH) {
      values.push(null)
      break
    }
    at = scriptRef(at.file, base, deps)
    if (!at) values.push(null)
  }
  return either(values)
}

// A selector as both files write it: a .d.ts writes a line break in it
// as a space.
function spaced(selector: string | null) {
  return selector?.replace(/\s+/g, " ").trim() ?? null
}

// Whether a library's directive or component puts a class on its
// element, read from the module of the entry point its .d.ts was reached
// through; the declaration there must carry the selector the .d.ts gives.
// Null when anything on the way cannot be read.
export function compiledStyles(
  owner: Owner,
  name: string,
  selector: string | null | undefined,
  deps: Set<string>
): boolean | null {
  if (selector === undefined) return null
  const entry = resolveScript(owner.spec, owner.from)
  const found = entry ? scriptExport(entry, owner.name ?? name, deps) : null
  const declaration = found?.cls.declaration
  if (!declaration || spaced(declaration.selector) !== spaced(selector)) {
    return null
  }
  return stylesOf(found!, deps, 0)
}

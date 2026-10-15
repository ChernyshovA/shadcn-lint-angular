// What an Angular library's .d.ts says about its classes, read from the
// syntax alone the way ngtsc's DtsMetadataReader reads it
// (@angular/compiler-cli, src/ngtsc/metadata/src/dts.ts and util.ts). A
// compiled class carries its metadata as the type of a static field:
//
//   static ɵdir: i0.ɵɵDirectiveDeclaration<MatTooltip, "[matTooltip]",
//     ["matTooltip"], { "tooltipClass": { "alias": "matTooltipClass"; … } },
//     {}, never, never, true, never>;
//   static ɵmod: i0.ɵɵNgModuleDeclaration<MatTooltipModule, never,
//     [typeof A11yModule, …], [typeof MatTooltip, …]>;
//
// Only a summary of each file is kept, never its parse tree: an editor's
// ESLint server outlives many runs.

import * as fs from "node:fs"
import * as path from "node:path"

import { findUp, isFile, memoize, mtimeOf, realpath } from "./fs"
import { parseSource } from "./parser"
import { readJsonc } from "./resolve"
import { warnOnce } from "./warn"

// `typeof X`, or `typeof i1.X` through a namespace import.
type TypeRef = { name: string; member: string | null }

// The entry point a library's class was reached through, as ngtsc's
// Reference.bestGuessOwningModule: the bare specifier, the file it was
// resolved from, and the class's exported name there if known. Its
// JavaScript is found through this: a package chunks its .d.ts and its
// bundles differently.
export type Owner = { spec: string; from: string; name: string | null }

type DtsDirective = {
  component: boolean
  // Null for `never`, no selector; undefined for a type this cannot read.
  selector: string | null | undefined
  // Public names, with those its host directives expose on it.
  inputs: string[]
}

type DtsModule = {
  declarations: TypeRef[]
  imports: TypeRef[]
  exports: TypeRef[]
  // Whether every element is a `typeof` this can follow.
  complete: boolean
}

export type DtsClass = {
  directive: DtsDirective | null
  // Whether it declares a component or a directive at all, read or not:
  // one that does not, a helper or an @Injectable, has no host.
  declared: boolean
  module: DtsModule | null
  // A pipe, which a module may export too and no element matches.
  pipe: boolean
  // The class it extends, whose inputs it inherits; "dynamic" for an
  // expression this cannot follow.
  base: TypeRef | "dynamic" | null
}

type Binding = { spec: string | null; name: string }

type DtsFile = {
  // Local name -> where it is imported from; "*" for a namespace.
  imports: Map<string, { spec: string; name: string }>
  // Exported name -> its local name, or what it re-exports.
  exports: Map<string, Binding>
  stars: string[]
  classes: Map<string, DtsClass>
  // `declare const Imports: readonly [typeof A, typeof B]`, or null for
  // another type.
  tuples: Map<string, TypeRef[] | null>
}

// ngtsc's readStringType.
function readStringType(type: any): string | null {
  return type?.type === "TSLiteralType" &&
    typeof type.literal?.value === "string"
    ? type.literal.value
    : null
}

// ngtsc's readBooleanType.
function readBooleanType(type: any): boolean | null {
  return type?.type === "TSLiteralType" &&
    typeof type.literal?.value === "boolean"
    ? type.literal.value
    : null
}

function keyOf(member: any): string | null {
  if (member?.computed) return null
  const key = member?.key
  if (key?.type === "Identifier") return key.name
  return typeof key?.value === "string" ? key.value : null
}

// ngtsc's readMapType.
function readMapType<T>(type: any, transform: (type: any) => T | null) {
  const out = new Map<string, T>()
  if (type?.type !== "TSTypeLiteral") return out
  for (const member of type.members ?? []) {
    const key = keyOf(member)
    const value = member?.typeAnnotation?.typeAnnotation
    if (member?.type !== "TSPropertySignature" || key === null || !value) {
      continue
    }
    const read = transform(value)
    if (read !== null) out.set(key, read)
  }
  return out
}

// ngtsc's readInputsType, to each input's public name: a string before
// Angular 16, `{ "alias": …; "required": …; }` since.
function readInputsType(type: any) {
  const out: string[] = []
  for (const [key, value] of readMapType(type, (value) => value)) {
    const alias =
      readStringType(value) ??
      readMapType(
        value,
        (inner) => readStringType(inner) ?? readBooleanType(inner)
      ).get("alias")
    out.push(typeof alias === "string" ? alias : key)
  }
  return out
}

function typeRefOf(type: any): TypeRef | null {
  if (type?.type !== "TSTypeQuery") return null
  const name = type.exprName
  if (name?.type === "Identifier") return { name: name.name, member: null }
  if (
    name?.type === "TSQualifiedName" &&
    name.left?.type === "Identifier" &&
    name.right?.type === "Identifier"
  ) {
    return { name: name.left.name, member: name.right.name }
  }
  return null
}

// A module's declarations, imports or exports: `never`, or a tuple of
// `typeof` the way ngtsc evaluates it.
function readRefs(type: any) {
  if (type?.type === "TSNeverKeyword") return { refs: [], complete: true }
  if (type?.type !== "TSTupleType") return { refs: [], complete: false }
  const refs: TypeRef[] = []
  let complete = true
  for (const element of type.elementTypes ?? []) {
    const ref = typeRefOf(element)
    if (ref) refs.push(ref)
    else complete = false
  }
  return { refs, complete }
}

// ngtsc's readHostDirectivesType, to the names the host exposes them
// under: `[{ directive: typeof Bind; inputs: { "pSize": "pSize" }; … }]`.
function hostInputsOf(type: any) {
  const out: string[] = []
  if (type?.type !== "TSTupleType") return out
  for (const element of type.elementTypes ?? []) {
    const inputs = readMapType(element, (value) => value).get("inputs")
    out.push(...readMapType(inputs, readStringType).values())
  }
  return out
}

function typeArgumentsOf(type: any): any[] | null {
  if (type?.type !== "TSTypeReference") return null
  return (type.typeArguments ?? type.typeParameters)?.params ?? null
}

// A static ɵcmp, ɵdir or ɵmod, as getDirectiveMetadata and
// getNgModuleMetadata read it; null for any other member or shape.
function declarationOf(
  member: any
):
  | { kind: "module"; module: DtsModule }
  | { kind: "directive"; directive: DtsDirective }
  | null {
  if (member?.type !== "PropertyDefinition" || !member.static) return null
  const field = keyOf(member)
  if (field !== "ɵcmp" && field !== "ɵdir" && field !== "ɵmod") return null
  const args = typeArgumentsOf(member.typeAnnotation?.typeAnnotation)
  if (field === "ɵmod") {
    if (args?.length !== 4) return null
    const [, declarations, imports, exports] = args.map(readRefs)
    return {
      kind: "module",
      module: {
        declarations: declarations.refs,
        imports: imports.refs,
        exports: exports.refs,
        complete: declarations.complete && imports.complete && exports.complete,
      },
    }
  }
  if (!args || args.length < 2) return null
  return {
    kind: "directive",
    directive: {
      component: field === "ɵcmp",
      selector:
        args[1]?.type === "TSNeverKeyword"
          ? null
          : (readStringType(args[1]) ?? undefined),
      inputs: [
        ...readInputsType(args[3]),
        ...(args.length > 8 ? hostInputsOf(args[8]) : []),
      ],
    },
  }
}

function superOf(node: any): DtsClass["base"] {
  const base = node?.superClass
  if (!base) return null
  if (base.type === "Identifier") return { name: base.name, member: null }
  if (
    base.type === "MemberExpression" &&
    !base.computed &&
    base.object?.type === "Identifier" &&
    base.property?.type === "Identifier"
  ) {
    return { name: base.object.name, member: base.property.name }
  }
  return "dynamic"
}

function nameOf(node: any): string | null {
  if (node?.type === "Identifier") return node.name
  return typeof node?.value === "string" ? node.value : null
}

function extract(program: any) {
  const file: DtsFile = {
    imports: new Map(),
    exports: new Map(),
    stars: [],
    classes: new Map(),
    tuples: new Map(),
  }
  let read = 0
  const declare = (node: any, exported: boolean) => {
    if (node?.type === "ClassDeclaration" && node.id?.name) {
      const cls: DtsClass = {
        directive: null,
        declared: false,
        module: null,
        pipe: false,
        base: superOf(node),
      }
      for (const member of node.body?.body ?? []) {
        if (member?.static && keyOf(member) === "ɵpipe") cls.pipe = true
        if (member?.static && /^ɵ(cmp|dir)$/.test(keyOf(member) ?? "")) {
          cls.declared = true
        }
        const declaration = declarationOf(member)
        if (!declaration) continue
        read++
        if (declaration.kind === "module") cls.module = declaration.module
        else cls.directive = declaration.directive
      }
      file.classes.set(node.id.name, cls)
      if (exported)
        file.exports.set(node.id.name, { spec: null, name: node.id.name })
    } else if (node?.type === "VariableDeclaration") {
      for (const declarator of node.declarations ?? []) {
        const name = declarator.id?.name
        if (!name) continue
        let type = declarator.id.typeAnnotation?.typeAnnotation
        if (type?.type === "TSTypeOperator") type = type.typeAnnotation
        file.tuples.set(
          name,
          type?.type === "TSTupleType" ? readRefs(type).refs : null
        )
        if (exported) file.exports.set(name, { spec: null, name })
      }
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
      // `export declare class` is a declaration the parsers call a type
      // export; `export type { … }` exports types only.
      if (statement.declaration) {
        declare(statement.declaration, true)
        continue
      }
      if (statement.exportKind === "type") continue
      const spec =
        typeof statement.source?.value === "string"
          ? statement.source.value
          : null
      for (const specifier of statement.specifiers ?? []) {
        const local = nameOf(specifier.local)
        const exported = nameOf(specifier.exported) ?? local
        if (!local || !exported || specifier.exportKind === "type") continue
        file.exports.set(exported, { spec, name: local })
      }
    } else if (statement.type === "ExportAllDeclaration") {
      const spec = statement.source?.value
      if (typeof spec !== "string") continue
      const exported = nameOf(statement.exported)
      if (exported) file.exports.set(exported, { spec, name: "*" })
      else file.stars.push(spec)
    } else {
      declare(statement, false)
    }
  }
  return { file, read }
}

// The fields only: not the ɵɵ…Declaration types @angular/core defines,
// nor `static ɵcmp = defineComponent(…)` in its doc comments.
const DECLARATIONS = /\bstatic\s+ɵ(?:cmp|dir|mod)\s*:/g

export type Package = { dir: string; name: string; version: string | null }

// The installed package: the directory under a file's last node_modules.
export function packageOf(file: string): Package | null {
  const parts = file.split(/[\\/]/)
  const at = parts.lastIndexOf("node_modules")
  if (at === -1 || at + 1 >= parts.length) return null
  const length = parts[at + 1].startsWith("@") ? 2 : 1
  const dir = parts.slice(0, at + 1 + length).join(path.sep)
  const manifest = jsonAt(path.join(dir, "package.json"))
  return {
    dir,
    name:
      typeof manifest?.name === "string"
        ? manifest.name
        : parts.slice(at + 1, at + 1 + length).join("/"),
    version: typeof manifest?.version === "string" ? manifest.version : null,
  }
}

const jsons = new Map<string, { mtimeMs: number; json: any }>()

export function jsonAt(file: string) {
  const mtimeMs = mtimeOf(file)
  if (mtimeMs === null) return null
  const cached = jsons.get(file)
  if (cached?.mtimeMs === mtimeMs) return cached.json
  const json = readJsonc(file)
  jsons.set(file, { mtimeMs, json })
  return json
}

const files = new Map<
  string,
  { version: string | null; mtimeMs: number; file: DtsFile | null }
>()

// Read again when the package's version or the file's mtime changes.
// Declarations none of which can be read are said once per package: a
// later Angular may write them otherwise.
function dtsFile(file: string): DtsFile | null {
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
      `angular-dts:${pkg?.dir ?? file}:${version}`,
      `The Angular declarations in ${name} cannot be read: ${where.replace(/\\/g, "/")} has ${declared}, none of them in the form Angular 19 to 22 write. Until they can be, shadcn/no-restyle judges a *Class input on an element by the contract of its tag, as it does without the package installed.`
    )
  }
  const kept = extracted?.file ?? null
  files.set(file, { version, mtimeMs, file: kept })
  return kept
}

export function declarationFilesReadForTests() {
  return [...files.keys()]
}

export function resetDeclarationFilesForTests() {
  files.clear()
}

// `./x.js` is `./x.d.ts`, `./x.mjs` is `./x.d.mts`, `./x` may be
// `./x/index.d.ts`.
function declarationFile(base: string) {
  const candidates: string[] = []
  const script = /\.([cm]?)js$/.exec(base)
  if (script) {
    candidates.push(`${base.slice(0, -script[0].length)}.d.${script[1]}ts`)
  }
  if (/\.d\.[cm]?ts$/.test(base)) candidates.push(base)
  candidates.push(`${base}.d.ts`, path.join(base, "index.d.ts"))
  const found = candidates.find((candidate) => isFile(candidate))
  return found ? realpath(found) : null
}

// What an `exports` value gives for types: the `types` condition first,
// then what the code is, whose declarations lie beside it.
function typesTarget(value: any): string | null {
  if (typeof value === "string") return value
  if (Array.isArray(value)) {
    for (const item of value) {
      const target = typesTarget(item)
      if (target) return target
    }
    return null
  }
  if (!value || typeof value !== "object") return null
  for (const key of ["types", "import", "default", "require", "node"]) {
    if (key in value) {
      const target = typesTarget(value[key])
      if (target) return target
    }
  }
  return null
}

export function exportsTarget(
  exports: any,
  subpath: string,
  pick: (value: any) => string | null = typesTarget
): string | null {
  const map =
    typeof exports === "string" ||
    Array.isArray(exports) ||
    !Object.keys(exports).some((key) => key.startsWith("."))
      ? { ".": exports }
      : exports
  if (subpath in map) return pick(map[subpath])
  let best: { key: string; captured: string } | null = null
  for (const key of Object.keys(map)) {
    const star = key.indexOf("*")
    if (star === -1) continue
    const prefix = key.slice(0, star)
    const suffix = key.slice(star + 1)
    if (
      subpath.length >= prefix.length + suffix.length &&
      subpath.startsWith(prefix) &&
      subpath.endsWith(suffix) &&
      (!best || key.length > best.key.length)
    ) {
      best = {
        key,
        captured: subpath.slice(prefix.length, subpath.length - suffix.length),
      }
    }
  }
  const target = best ? pick(map[best.key]) : null
  return target && best ? target.replaceAll("*", best.captured) : null
}

// A package's declarations for a subpath, the way TypeScript finds them:
// its `exports`, else `types` or `typings`, else the files themselves.
function typesEntry(dir: string, subpath: string) {
  const manifest = jsonAt(path.join(dir, "package.json"))
  if (manifest?.exports && typeof manifest.exports === "object") {
    const target = exportsTarget(
      manifest.exports,
      subpath ? `./${subpath}` : "."
    )
    return target ? declarationFile(path.resolve(dir, target)) : null
  }
  const at = subpath ? path.join(dir, subpath) : dir
  // A secondary entry point before Angular 13 had a package.json of its own.
  const own = subpath ? jsonAt(path.join(at, "package.json")) : manifest
  const typings = own?.types ?? own?.typings
  if (typeof typings === "string") {
    const found = declarationFile(path.resolve(at, typings))
    if (found) return found
  }
  return declarationFile(subpath ? at : path.join(dir, "index"))
}

export function resolveDts(spec: string, fromFile: string): string | null {
  const dir = path.dirname(fromFile)
  return memoize(`angular-dts:resolve:${dir}\u0000${spec}`, () => {
    if (spec.startsWith(".") || path.isAbsolute(spec)) {
      return declarationFile(path.resolve(dir, spec))
    }
    const parts = spec.split("/")
    const length = spec.startsWith("@") ? 2 : 1
    if (parts.length < length) return null
    const name = parts.slice(0, length).join("/")
    const found = findUp(dir, path.join("node_modules", name))
    return found
      ? typesEntry(realpath(found), parts.slice(length).join("/"))
      : null
  })
}

export type DtsValue =
  | {
      kind: "class"
      file: string
      name: string
      cls: DtsClass
      owner: Owner | null
    }
  | { kind: "tuple"; file: string; refs: TypeRef[]; owner: Owner | null }

const MAX_DEPTH = 16

function isBare(spec: string) {
  return !spec.startsWith(".") && !path.isAbsolute(spec)
}

// A relative specifier stays inside the entry point already reached.
function ownerPast(
  spec: string,
  file: string,
  name: string | null,
  owner: Owner | null
): Owner | null {
  return isBare(spec) ? { spec, from: file, name } : owner
}

// `export *` that loop back, or meet again, give nothing the first visit
// to a file for a name did not.
function visited(seen: Set<string>, kind: string, file: string, name: string) {
  const key = `${kind}\u0000${file}\u0000${name}`
  if (seen.has(key)) return true
  seen.add(key)
  return false
}

// What a declaration file exports under `name`, through its re-exports.
// `deps` collects the files read.
export function dtsExport(
  file: string,
  name: string,
  deps: Set<string>,
  owner: Owner | null = null,
  depth = 0,
  seen = new Set<string>()
): DtsValue | null {
  if (depth > MAX_DEPTH || visited(seen, "export", file, name)) return null
  deps.add(file)
  const read = dtsFile(file)
  if (!read) return null
  const binding = read.exports.get(name)
  if (binding) {
    if (binding.spec === null)
      return dtsLocal(file, binding.name, deps, owner, depth + 1, seen)
    if (binding.name === "*") return null
    const target = resolveDts(binding.spec, file)
    return target
      ? dtsExport(
          target,
          binding.name,
          deps,
          ownerPast(binding.spec, file, binding.name, owner),
          depth + 1,
          seen
        )
      : null
  }
  for (const spec of read.stars) {
    const target = resolveDts(spec, file)
    const found = target
      ? dtsExport(
          target,
          name,
          deps,
          ownerPast(spec, file, name, owner),
          depth + 1,
          seen
        )
      : null
    if (found) return found
  }
  return null
}

// A class or a constant a declaration file declares or imports.
export function dtsLocal(
  file: string,
  name: string,
  deps: Set<string>,
  owner: Owner | null = null,
  depth = 0,
  seen = new Set<string>()
): DtsValue | null {
  if (depth > MAX_DEPTH || visited(seen, "local", file, name)) return null
  deps.add(file)
  const read = dtsFile(file)
  if (!read) return null
  const cls = read.classes.get(name)
  if (cls) return { kind: "class", file, name, cls, owner }
  const tuple = read.tuples.get(name)
  if (tuple) return { kind: "tuple", file, refs: tuple, owner }
  const imported = read.imports.get(name)
  if (!imported || imported.name === "*") return null
  const target = resolveDts(imported.spec, file)
  return target
    ? dtsExport(
        target,
        imported.name,
        deps,
        ownerPast(imported.spec, file, imported.name, owner),
        depth + 1,
        seen
      )
    : null
}

// What `typeof X` or `typeof i1.X` refers to. A module's exports and a
// constant's classes keep its entry point, not its exported name.
export function dtsRef(
  file: string,
  ref: TypeRef,
  deps: Set<string>,
  owner: Owner | null = null
): DtsValue | null {
  const unnamed = owner && { ...owner, name: null }
  if (ref.member === null) return dtsLocal(file, ref.name, deps, unnamed)
  deps.add(file)
  const imported = dtsFile(file)?.imports.get(ref.name)
  if (imported?.name !== "*") return null
  const target = resolveDts(imported.spec, file)
  return target
    ? dtsExport(
        target,
        ref.member,
        deps,
        ownerPast(imported.spec, file, ref.member, unnamed)
      )
    : null
}

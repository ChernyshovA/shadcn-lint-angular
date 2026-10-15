// Which directives an Angular template element is, the way the compiler
// finds them. The template's component brings its scope: a standalone
// component's `imports`, or its NgModule's declarations and what its
// `imports` export. Each class is read by the first source that knows
// it, as ngtsc's CompoundMetadataReader asks its readers in turn: the
// project's decorators, a library's .d.ts (angular-dts.ts) and, for its
// host, its published JavaScript (angular-partial.ts). The compiler's own
// SelectorMatcher then matches them.
//
// What this cannot follow leaves the answer unknown, never wrong.

import * as fs from "node:fs"
import * as path from "node:path"

import { dottedName } from "../sites/collect"
import type { ElementSelector } from "../sites/readers/angular"
import { angularCompiler } from "../sites/readers/angular-compiler"
import {
  dtsExport,
  dtsRef,
  resolveDts,
  type DtsClass,
  type DtsValue,
} from "./angular-dts"
import { CLASS_BINDING, compiledStyles } from "./angular-partial"
import {
  listing,
  readText,
  templateOwners,
  type ComponentMeta,
} from "./angular-styles"
import { walk } from "./ast"
import { isFile, memoize, mtimeOf, NODE_MODULES, realpath } from "./fs"
import { definingExportOf } from "./modules"
import { parseSource } from "./parser"
import { packageRoot, resolveFile } from "./resolve"

export type DirectiveClass = {
  file: string
  name: string
  // Its file declares no other directive, so a cva in it is its own.
  sole: boolean
}

type Known = DirectiveClass & {
  // What its hostDirectives put on the element too, one level down.
  hosted: DirectiveClass[]
  // Read from a library's .d.ts: no cva to read, and no file to send
  // anyone to.
  compiled: boolean
}

export type DirectiveRef = Known & {
  // A component draws itself in its template, whatever its host says.
  component: boolean
  // Whether it styles its element (stylesIn, takesClass), or null.
  styles: boolean | null
}

type Directive = Known & {
  selector: string
  component: boolean
  // The public names of the inputs it takes.
  inputs: Set<string>
  // Whether every input it takes is among them.
  complete: boolean
  // What it was read from: whether it styles its element is read from
  // there only for an element a contract judges.
  found: Extract<Found, { kind: "source" | "class" }>
}

type ParsedModule = {
  // Local name -> where it is imported from; "*" for a namespace.
  imports: Map<string, { spec: string; name: string }>
  // Top-level classes and constants, as much of each as is read.
  declarations: Map<string, any>
}

const parsed = new Map<
  string,
  { mtimeMs: number; module: ParsedModule | null }
>()

function moduleOf(file: string) {
  const mtimeMs = mtimeOf(file)
  if (mtimeMs === null) return null
  const cached = parsed.get(file)
  if (cached && cached.mtimeMs === mtimeMs) return cached.module
  let module: ParsedModule | null = null
  try {
    module = declarationsOf(parseSource(fs.readFileSync(file, "utf8"), file))
  } catch {
    // Unreadable: nothing is declared.
  }
  parsed.set(file, { mtimeMs, module })
  return module
}

export function cachedDeclarationForTests(file: string, name: string) {
  return moduleOf(file)?.declarations.get(name) ?? null
}

function nameOf(node: any): string | null {
  if (node?.type === "Identifier") return node.name
  if (node?.type === "Literal" && typeof node.value === "string") {
    return node.value
  }
  return null
}

function declarationsOf(program: any): ParsedModule {
  const imports = new Map<string, { spec: string; name: string }>()
  const declarations = new Map<string, any>()
  for (const statement of program?.body ?? []) {
    if (statement.type === "ImportDeclaration") {
      if (statement.importKind === "type") continue
      const spec = statement.source?.value
      if (typeof spec !== "string") continue
      for (const specifier of statement.specifiers ?? []) {
        const local = specifier.local?.name
        if (!local || specifier.importKind === "type") continue
        if (specifier.type === "ImportSpecifier") {
          imports.set(local, {
            spec,
            name: nameOf(specifier.imported) ?? local,
          })
        } else if (specifier.type === "ImportDefaultSpecifier") {
          imports.set(local, { spec, name: "default" })
        } else if (specifier.type === "ImportNamespaceSpecifier") {
          imports.set(local, { spec, name: "*" })
        }
      }
      continue
    }
    const node =
      statement.type === "ExportNamedDeclaration" ||
      statement.type === "ExportDefaultDeclaration"
        ? statement.declaration
        : statement
    if (node?.type === "ClassDeclaration" && node.id?.name) {
      declarations.set(node.id.name, classSummaryOf(node))
    } else if (node?.type === "VariableDeclaration") {
      for (const declarator of node.declarations ?? []) {
        if (declarator.id?.type === "Identifier" && declarator.init) {
          declarations.set(declarator.id.name, valueSummaryOf(declarator.init))
        }
      }
    }
  }
  return { imports, declarations }
}

// A module stays cached while the session lives, so of its tree it keeps
// only what this file reads: a tree holds no parent references, so the
// rest is let go.
function classSummaryOf(node: any) {
  return {
    type: node.type,
    id: node.id,
    decorators: node.decorators,
    superClass: node.superClass,
    body: { body: (node.body?.body ?? []).map(memberSummaryOf) },
    styling: stylingOf(node),
  }
}

function memberSummaryOf(member: any) {
  const value = member?.value
  return {
    type: member?.type,
    computed: member?.computed,
    key: member?.key,
    decorators: member?.decorators,
    // `input(initial, { alias })`: what fieldInputOf reads of the call.
    value:
      value?.type === "CallExpression"
        ? {
            type: value.type,
            callee: value.callee,
            arguments: (value.arguments ?? []).map((argument: any) =>
              argument?.type === "ObjectExpression" ||
              argument?.type === "Literal"
                ? argument
                : { type: argument?.type }
            ),
          }
        : value && { type: value.type },
  }
}

const KEPT_VALUES = new Set([
  "ArrayExpression",
  "Literal",
  "TemplateLiteral",
  "Identifier",
])

function valueSummaryOf(init: any) {
  const value = unwrapped(init)
  if (KEPT_VALUES.has(value?.type)) return init
  // `forwardRef(() => X)` and `X.forRoot()` name X, as a scope entry.
  if (value?.type === "CallExpression") {
    const { callee } = value
    if (nameOf(callee) === "forwardRef") return value
    if (callee?.type === "MemberExpression") {
      return {
        type: value.type,
        callee: { type: callee.type, object: callee.object },
        arguments: [],
      }
    }
  }
  return { type: value?.type }
}

function unwrapped(node: any) {
  let value = node
  while (
    value?.type === "TSAsExpression" ||
    value?.type === "TSSatisfiesExpression" ||
    value?.type === "TSTypeAssertion" ||
    value?.type === "ParenthesizedExpression"
  ) {
    value = value.expression
  }
  return value
}

function elementsOf(node: any): any[] | null {
  const value = unwrapped(node)
  return value?.type === "ArrayExpression" ? value.elements : null
}

// An `imports`, `exports` or `declarations` option as entries: a
// constant it names is one, followed like any other.
function listed(value: any): any[] {
  return value ? (elementsOf(value) ?? [value]) : []
}

function propertyOf(object: any, key: string) {
  if (object?.type !== "ObjectExpression") return null
  for (const property of object.properties ?? []) {
    if (property.type === "Property" && nameOf(property.key) === key) {
      return property.value
    }
  }
  return null
}

// Whether an object literal writes out every key it has: a spread or a
// computed key can carry any of them.
function whole(object: any) {
  return (
    object?.type === "ObjectExpression" &&
    object.properties.every(
      (property: any) => property.type === "Property" && !property.computed
    )
  )
}

// `whole` when every option is written out: none are given, or an object
// literal whose keys can all be read.
function decoratorOf(node: any, names: readonly string[]) {
  for (const decorator of node?.decorators ?? []) {
    const call = decorator.expression
    if (call?.type !== "CallExpression") continue
    const callee = nameOf(call.callee)
    if (callee && names.includes(callee)) {
      const options = call.arguments?.[0]
      return {
        name: callee,
        options: options ?? {},
        whole: options === undefined || whole(options),
      }
    }
  }
  return null
}

const DIRECTIVE = ["Directive", "Component"]
const NG_MODULE = ["NgModule"]
const PIPE = ["Pipe"]

function directiveOptions(node: any) {
  return decoratorOf(node, DIRECTIVE)?.options ?? null
}

// A string written out, or built of the constants the file declares:
// "kit-local", SELECTOR, `${PREFIX}-tpl`. Null for any other.
function constantString(
  node: any,
  module: ParsedModule,
  depth = 0,
  read = new Map<string, string | null>()
): string | null {
  const value = unwrapped(node)
  if (value?.type === "Literal") {
    return typeof value.value === "string" ? value.value : null
  }
  if (depth > MAX_DEPTH) return null
  if (value?.type === "Identifier") {
    if (read.has(value.name)) return read.get(value.name)!
    // Until it is read, a constant that names itself reads as nothing.
    read.set(value.name, null)
    const declared = module.declarations.get(value.name)
    const string = declared
      ? constantString(declared, module, depth + 1, read)
      : null
    read.set(value.name, string)
    return string
  }
  if (value?.type !== "TemplateLiteral") return null
  let out = ""
  for (const [i, quasi] of value.quasis.entries()) {
    if (typeof quasi.value?.cooked !== "string") return null
    out += quasi.value.cooked
    if (i === value.expressions.length) break
    const part = constantString(value.expressions[i], module, depth + 1, read)
    if (part === null) return null
    out += part
  }
  return out
}

// Null for no selector, undefined for one this cannot read.
function selectorOf(node: any, module: ParsedModule) {
  const decorator = decoratorOf(node, DIRECTIVE)
  const value = propertyOf(decorator?.options, "selector")
  if (!value) return decorator?.whole ? null : undefined
  return constantString(value, module) ?? undefined
}

type Reading = {
  out: Directive[]
  seen: Set<string>
  deps: Set<string>
  // mergeFunctions: a call to one builds the element's classes.
  helpers: ReadonlySet<string>
  // Whether every entry of the scope was followed to what it is.
  complete: boolean
  lists: Lists
}

// The lists a walk has opened, and those still open in it. One reached
// again adds nothing more; one reached from inside itself is a loop no
// build evaluates: `const A = [B]; const B = [A]` throws before it is read.
type Lists = { opened: Set<unknown>; open: Set<unknown> }

const noLists = (): Lists => ({ opened: new Set(), open: new Set() })

function openList(lists: Lists, list: unknown) {
  if (lists.opened.has(list)) return lists.open.has(list) ? "loop" : "again"
  lists.opened.add(list)
  lists.open.add(list)
  return "new"
}

// A directive styles its element when it takes the element's class, as
// spartan's classes() does through inject(new HostAttributeToken("class")),
// builds classes with a mergeFunctions helper, or binds the class in
// `host` or with @HostBinding. Null when it names or binds what this
// cannot read, `host: HOST`.
function stylesHost(node: any, helpers: ReadonlySet<string>) {
  const { calls, tokens, bindings } = node.styling as Styling
  if ([...calls].some((callee) => callee === "classes" || helpers.has(callee)))
    return true
  if (tokens.includes("class")) return true
  if (bindings.some((bound) => bound !== null && CLASS_BINDING.test(bound)))
    return true
  // A name a token or a binding is given as is not a string.
  const unread = tokens.includes(null) || bindings.includes(null)
  const decorator = decoratorOf(node, DIRECTIVE)
  // A spread among its options can carry `host`.
  if (decorator && !decorator.whole) return null
  const host = propertyOf(decorator?.options, "host")
  if (host) {
    if (!whole(host)) return null
    const keys = host.properties.map((property: any) => nameOf(property.key))
    if (keys.some((key: string | null) => isClassHostKey(key))) return true
  }
  return unread ? null : false
}

type Styling = {
  calls: Set<string>
  // The names `new HostAttributeToken(…)` is given; null for a non-string.
  tokens: (string | null)[]
  // The same of @HostBinding(…) and @Attribute(…).
  bindings: (string | null)[]
}

// What stylesHost reads of a class body, read as the file is parsed. Not
// of its decorator: spartan's HlmTooltip calls hlm in its providers for
// the tooltip it opens, not for its element.
function stylingOf(node: any): Styling {
  const styling: Styling = { calls: new Set(), tokens: [], bindings: [] }
  const name = (argument: any, into: (string | null)[]) => {
    if (argument) into.push(stringIn(argument))
  }
  walk(node.body, (child) => {
    if (child.type === "CallExpression") {
      const callee = dottedName(child.callee)
      if (callee) styling.calls.add(callee)
    } else if (
      child.type === "NewExpression" &&
      nameOf(child.callee) === "HostAttributeToken"
    ) {
      name(child.arguments?.[0], styling.tokens)
    } else if (child.type === "Decorator") {
      const callee = child.expression?.callee
      const decorator =
        callee?.type === "MemberExpression"
          ? nameOf(callee.property)
          : nameOf(callee)
      if (decorator === "HostBinding" || decorator === "Attribute") {
        name(child.expression.arguments?.[0], styling.bindings)
      }
    }
  })
  return styling
}

function isClassHostKey(key: string | null) {
  if (key === "class" || key === "[ngClass]") return true
  return !!key?.startsWith("[") && key.endsWith("]")
    ? CLASS_BINDING.test(key.slice(1, -1))
    : false
}

// Three-valued or.
function either(values: (boolean | null)[]) {
  if (values.includes(true)) return true
  return values.includes(null) ? null : false
}

const MAX_DEPTH = 16

// What a name a source file declares or imports stands for: one of its
// classes or arrays, or what a library's .d.ts declares under it.
type Found =
  | {
      kind: "source"
      file: string
      name: string
      node: any
      module: ParsedModule
    }
  | { kind: "array"; file: string; elements: any[] }
  | DtsValue

// A bare specifier an installed package answers, past tsconfig paths
// that map it into the project.
function installedSpec(spec: string, from: string) {
  if (spec.startsWith(".") || path.isAbsolute(spec)) return false
  const dir = path.dirname(from)
  const resolved = resolveFile(spec, dir, packageRoot(from) ?? dir)
  return !resolved || NODE_MODULES.test(resolved)
}

function lookup(
  file: string,
  name: string,
  deps: Set<string>,
  depth = 0
): Found | null {
  if (depth > MAX_DEPTH) return null
  deps.add(file)
  const module = moduleOf(file)
  if (!module) return null
  const declared = module.declarations.get(name)
  if (declared) {
    if (declared.type === "ClassDeclaration") {
      return { kind: "source", file, name, node: declared, module }
    }
    const elements = elementsOf(declared)
    return elements ? { kind: "array", file, elements } : null
  }
  const imported = module.imports.get(name)
  // A namespace is no class or list.
  if (!imported || imported.name === "*") return null
  // A library compiled into node_modules declares no decorator to read;
  // its .d.ts does.
  if (installedSpec(imported.spec, file)) {
    const target = resolveDts(imported.spec, file)
    return target
      ? dtsExport(target, imported.name, deps, {
          spec: imported.spec,
          from: file,
          name: imported.name,
        })
      : null
  }
  const binding = definingExportOf(imported.spec, imported.name, file, deps)
  if (!binding || NODE_MODULES.test(binding.file)) return null
  return lookup(binding.file, binding.name, deps, depth + 1)
}

type Entry = { file: string; node: any }

// The entries of a decorator's `inputs` or hostDirectives, followed
// through the constants and spreads it is built of, `[A, ...B]` or `C`.
// Null for a list built some other way, or one that spreads itself.
function entriesOf(file: string, node: any, deps: Set<string>): Entry[] | null {
  const out: Entry[] = []
  const entered = new Set<unknown>()
  const lists = noLists()
  const add = (file: string, node: any, depth: number): boolean => {
    if (depth > MAX_DEPTH) return false
    const value = unwrapped(
      node?.type === "SpreadElement" ? node.argument : node
    )
    let elements = elementsOf(value)
    let at = file
    if (!elements && value?.type === "Identifier") {
      const found = lookup(file, value.name, deps)
      if (found?.kind === "array") {
        elements = found.elements
        at = found.file
      }
    }
    if (!elements) return false
    const opened = openList(lists, elements)
    if (opened !== "new") return opened === "again"
    for (const element of elements) {
      if (element?.type === "SpreadElement") {
        if (!add(at, element, depth + 1)) return false
      } else if (!entered.has(element)) {
        entered.add(element)
        out.push({ file: at, node: element })
      }
    }
    lists.open.delete(elements)
    return true
  }
  return add(file, node, 0) ? out : null
}

// `X.forRoot()` and the like: a call on what an entry names, which
// gives a module only when X is one.
function memberCall(node: any) {
  const value = node?.type === "SpreadElement" ? node.argument : node
  return (
    value?.type === "CallExpression" &&
    value.callee?.type === "MemberExpression"
  )
}

// The name an entry is written with: `X`, `...X`, `forwardRef(() => X)`,
// or `X.forRoot()`, which gives the module X.
function referenceIn(node: any): string | null {
  let value = node?.type === "SpreadElement" ? node.argument : node
  if (value?.type === "CallExpression") {
    const callee = value.callee
    if (nameOf(callee) === "forwardRef") {
      const arrow = value.arguments?.[0]
      value = arrow?.type === "ArrowFunctionExpression" ? arrow.body : null
    } else if (
      callee?.type === "MemberExpression" &&
      callee.object?.type === "Identifier"
    ) {
      value = callee.object
    }
  }
  return value?.type === "Identifier" ? value.name : null
}

function stringIn(node: any): string | null {
  return node?.type === "Literal" && typeof node.value === "string"
    ? node.value
    : null
}

// The public name an entry of `inputs` gives: "size", "size: btnSize"
// or `{ name, alias }`. Null for one this cannot read.
function inputNameOf(node: any): string | null {
  const written = stringIn(node)
  if (written !== null) {
    const [name, alias] = written.split(":").map((part) => part.trim())
    return alias || name || null
  }
  if (whole(node)) {
    const alias = propertyOf(node, "alias")
    return alias ? stringIn(alias) : stringIn(propertyOf(node, "name"))
  }
  return null
}

// Whether a callee is @angular/core's `name`: `Input`, or `core.Input`.
function fromCore(module: ParsedModule, callee: any, name: string) {
  if (callee?.type === "Identifier") {
    const imported = module.imports.get(callee.name)
    return imported?.spec === "@angular/core" && imported.name === name
  }
  if (
    callee?.type !== "MemberExpression" ||
    callee.computed ||
    callee.object?.type !== "Identifier" ||
    nameOf(callee.property) !== name
  ) {
    return false
  }
  const imported = module.imports.get(callee.object.name)
  return imported?.spec === "@angular/core" && imported.name === "*"
}

// The alias options give an input, the field's own name without one;
// undefined for an alias, or a name, this cannot read.
function aliasIn(options: any, key: string | null) {
  if (options === undefined) return key ?? undefined
  const written = stringIn(options)
  if (written !== null) return written
  if (!whole(options)) return undefined
  const alias = propertyOf(options, "alias")
  return alias ? (stringIn(alias) ?? undefined) : (key ?? undefined)
}

// The public name a field declares as an input, `@Input(…)`, `input()`,
// `input.required()` or `model()`, aliased or not. Null for a field that
// is no input, undefined for an input whose name this cannot read.
function fieldInputOf(
  member: any,
  module: ParsedModule
): string | null | undefined {
  // `[KEY] = input()`: an input, under a name not read.
  const key = member?.computed ? null : nameOf(member?.key)
  for (const decorator of member?.decorators ?? []) {
    const call = decorator.expression
    if (
      call?.type !== "CallExpression" ||
      !fromCore(module, call.callee, "Input")
    ) {
      continue
    }
    return aliasIn(call.arguments?.[0], key)
  }
  const value = member?.value
  if (value?.type !== "CallExpression") return null
  const callee = value.callee
  const required =
    callee?.type === "MemberExpression" &&
    !callee.computed &&
    nameOf(callee.property) === "required"
  const base = required ? callee.object : callee
  const kind = ["input", "model"].find((name) => fromCore(module, base, name))
  if (!kind) return null
  const options = value.arguments?.[required ? 0 : 1]
  // input(initial, { transform }) takes its own name.
  return options?.type === "ObjectExpression" || options === undefined
    ? aliasIn(options, key)
    : undefined
}

type Inputs = { names: Set<string>; complete: boolean }

// A source class's inputs, as ngtsc reads them: its decorator's `inputs`,
// its fields, what its hostDirectives expose, and the class it extends.
function sourceInputs(
  found: Extract<Found, { kind: "source" }>,
  deps: Set<string>,
  depth: number,
  chain = new Set<string>()
): Inputs {
  const names = new Set<string>()
  const decorator = decoratorOf(found.node, DIRECTIVE)
  // A spread among its options can carry inputs.
  let complete = depth <= MAX_DEPTH && decorator?.whole !== false
  const options = decorator?.options
  const add = (list: any, file: string) => {
    const entries = entriesOf(file, list, deps)
    if (!entries) complete = false
    for (const entry of entries ?? []) {
      const name = inputNameOf(entry.node)
      if (name) names.add(name)
      else complete = false
    }
  }
  const inputs = propertyOf(options, "inputs")
  if (inputs) add(inputs, found.file)
  const hosts = propertyOf(options, "hostDirectives")
  const entries = hosts ? entriesOf(found.file, hosts, deps) : []
  if (!entries) complete = false
  for (const entry of entries ?? []) {
    // `{ directive, inputs }` exposes inputs under the host's names; a
    // class alone exposes none, anything else may.
    if (entry.node?.type === "ObjectExpression") {
      if (!whole(entry.node)) complete = false
      const exposed = propertyOf(entry.node, "inputs")
      if (exposed) add(exposed, entry.file)
      continue
    }
    const name = memberCall(entry.node) ? null : referenceIn(entry.node)
    const kind = name ? lookup(entry.file, name, deps)?.kind : null
    if (kind !== "source" && kind !== "class") complete = false
  }
  for (const member of found.node.body?.body ?? []) {
    const name = fieldInputOf(member, found.module)
    if (name) names.add(name)
    else if (name === undefined) complete = false
  }
  const base = found.node.superClass
  if (base && complete) {
    const inherited =
      base.type === "Identifier"
        ? classInputs(
            lookup(found.file, base.name, deps),
            deps,
            depth + 1,
            chain
          )
        : null
    if (inherited) for (const name of inherited.names) names.add(name)
    complete = !!inherited?.complete
  }
  return { names, complete }
}

// A library class's inputs: those its declaration lists, and those of
// the class it extends, as ngtsc flattens them.
function dtsInputs(
  file: string,
  cls: DtsClass,
  deps: Set<string>,
  depth: number,
  chain = new Set<string>()
): Inputs {
  const names = new Set(cls.directive?.inputs ?? [])
  let complete = depth <= MAX_DEPTH && cls.base !== "dynamic"
  if (cls.base && cls.base !== "dynamic" && complete) {
    const inherited = classInputs(
      dtsRef(file, cls.base, deps),
      deps,
      depth + 1,
      chain
    )
    if (inherited) for (const name of inherited.names) names.add(name)
    complete = !!inherited?.complete
  }
  return { names, complete }
}

// The inputs of a base class, each class once: a chain that loops back
// is no class a build compiles, and what it takes is not known.
function classInputs(
  found: Found | null,
  deps: Set<string>,
  depth: number,
  chain: Set<string>
): Inputs | null {
  if (found?.kind !== "source" && found?.kind !== "class") return null
  const key = `${found.file}\u0000${found.name}`
  if (chain.has(key)) return null
  chain.add(key)
  return found.kind === "source"
    ? sourceInputs(found, deps, depth, chain)
    : dtsInputs(found.file, found.cls, deps, depth, chain)
}

// The directives a class's hostDirectives apply to its element too.
// `read` is false when one cannot be followed to a source or a .d.ts.
function hostsOf(file: string, node: any, deps: Set<string>) {
  const hosts: Extract<Found, { kind: "source" }>[] = []
  const compiled: Extract<Found, { kind: "class" }>[] = []
  const decorator = decoratorOf(node, DIRECTIVE)
  let read = decorator?.whole !== false
  const list = propertyOf(decorator?.options, "hostDirectives")
  const entries = list ? entriesOf(file, list, deps) : []
  if (!entries) read = false
  for (const entry of entries ?? []) {
    const ref =
      entry.node?.type === "ObjectExpression"
        ? propertyOf(entry.node, "directive")
        : entry.node
    const name = memberCall(ref) ? null : referenceIn(ref)
    const found = name ? lookup(entry.file, name, deps) : null
    // A host directive needs no selector.
    if (found?.kind === "source" && directiveOptions(found.node)) {
      hosts.push(found)
    } else if (found?.kind === "class" && found.cls.directive) {
      compiled.push(found)
    } else read = false
  }
  return { hosts, compiled, read }
}

// Whether a library directive styles its element, as its published
// JavaScript declares; unknown without the entry point it came through.
function compiledStylesOf(
  found: Extract<Found, { kind: "class" }>,
  deps: Set<string>
) {
  const { owner, cls } = found
  if (!owner || !cls.directive) return null
  return compiledStyles(owner, found.name, cls.directive.selector, deps)
}

// Whether a library class a directive extends styles the element. A host
// compiles into a declaration, so a class without one, a helper or an
// @Injectable such as NgRx's ComponentStore, adds nothing: Angular's
// inheritance walks past it to the class it extends. A chain that loops
// back adds nothing more; one this cannot read or follow is unknown.
function libraryBaseStyles(
  found: Exclude<Found, { kind: "source" }>,
  deps: Set<string>
): boolean | null {
  const seen = new Set<string>()
  let at: Found | null = found
  for (let depth = 0; at?.kind === "class"; depth++) {
    const { cls } = at
    if (cls.directive) return compiledStylesOf(at, deps)
    if (cls.declared || cls.base === "dynamic" || depth >= MAX_DEPTH) {
      return null
    }
    const key = `${at.file}\u0000${at.name}`
    if (!cls.base || seen.has(key)) return false
    seen.add(key)
    at = dtsRef(at.file, cls.base, deps, at.owner)
  }
  return null
}

// Whether a directive styles its element: itself, the classes it extends,
// whose host, host directives and constructor Angular inherits, or the
// directives it hosts, in turn. Unknown when one cannot be read, a mixin's
// `extends Base(…)`. Each is read once, however many paths reach it.
function stylesOf(
  found: Extract<Found, { kind: "source" }>,
  deps: Set<string>,
  helpers: ReadonlySet<string>
): boolean | null {
  const values: (boolean | null)[] = []
  const seen = new Set<string>()
  let level = [found]
  for (let depth = 0; level.length; depth++) {
    const next: typeof level = []
    for (const directive of level) {
      const key = `${directive.file}\u0000${directive.name}`
      if (seen.has(key)) continue
      seen.add(key)
      const own = stylesHost(directive.node, helpers)
      if (own) return true
      if (depth >= MAX_DEPTH) {
        values.push(null)
        continue
      }
      values.push(own)
      const { hosts, compiled, read } = hostsOf(
        directive.file,
        directive.node,
        deps
      )
      if (!read) values.push(null)
      for (const host of compiled) values.push(compiledStylesOf(host, deps))
      next.push(...hosts)
      const base = directive.node.superClass
      if (base) {
        const found =
          base.type === "Identifier"
            ? lookup(directive.file, base.name, deps)
            : null
        if (found?.kind === "source") next.push(found)
        else values.push(found ? libraryBaseStyles(found, deps) : null)
      }
    }
    level = next
  }
  return either(values)
}

function directivesDeclaredIn(module: ParsedModule) {
  let count = 0
  for (const node of module.declarations.values()) {
    if (node.type === "ClassDeclaration" && directiveOptions(node)) count++
  }
  return count
}

function signatureOf(deps: Set<string>) {
  let signature = ""
  for (const dep of deps) signature += `${dep}:${mtimeOf(dep) ?? "missing"}|`
  return signature
}

// Read once while the files it was read from stand, as every template
// whose component can use the class asks the same of it.
function derived<T>(key: string, compute: (deps: Set<string>) => T) {
  return memoize(
    key,
    () => {
      const deps = new Set<string>()
      const value = compute(deps)
      return { value, deps, signature: signatureOf(deps) }
    },
    (hit) => hit.signature !== signatureOf(hit.deps)
  )
}

// A directive or component as a scope holds it: null for one with no
// selector, which no element matches; undefined for one whose selector
// this cannot read, which may match any.
function directiveIn(
  found: Extract<Found, { kind: "source" | "class" }>,
  helpers: ReadonlySet<string>
) {
  const key = `angular:directive:${found.file}\u0000${found.name}`
  if (found.kind === "class") {
    return derived(key, (deps): Directive | null | undefined => {
      const { directive } = found.cls
      if (directive?.selector === undefined) return directive ? undefined : null
      if (!directive.selector) return null
      deps.add(found.file)
      const inputs = dtsInputs(found.file, found.cls, deps, 0)
      return {
        file: found.file,
        name: found.name,
        selector: directive.selector,
        component: directive.component,
        inputs: inputs.names,
        complete: inputs.complete,
        sole: false,
        hosted: [],
        compiled: true,
        found,
      }
    })
  }
  return derived(
    `${key}\u0000${[...helpers].join(",")}`,
    (deps): Directive | null | undefined => {
      const { file, node, module } = found
      deps.add(file)
      const selector = selectorOf(node, module)
      if (selector === undefined) return undefined
      if (!selector) return null
      // What its variants may come from, one level down.
      const { hosts } = hostsOf(file, node, deps)
      const inputs = sourceInputs(found, deps, 0)
      return {
        file,
        name: found.name,
        selector,
        component: decoratorOf(node, DIRECTIVE)?.name === "Component",
        inputs: inputs.names,
        complete: inputs.complete,
        sole: directivesDeclaredIn(module) === 1,
        hosted: hosts.map((host) => ({
          file: host.file,
          name: host.name,
          sole: directivesDeclaredIn(host.module) === 1,
        })),
        compiled: false,
        found,
      } satisfies Directive
    }
  )
}

// The modules whose exports are being read, to stop at a cycle.
const expanding = new Set<string>()

// The directives a module exports, through the modules it exports too.
function exportsOfModule(
  found: Extract<Found, { kind: "source" | "class" }>,
  helpers: ReadonlySet<string>
) {
  const key = `angular:exports:${found.file}\u0000${found.name}\u0000${[...helpers].join(",")}`
  if (expanding.has(key)) return null
  expanding.add(key)
  try {
    return derived(key, (deps) => {
      const reading: Reading = {
        out: [],
        seen: new Set(),
        deps,
        helpers,
        complete: true,
        lists: noLists(),
      }
      deps.add(found.file)
      if (found.kind === "class") {
        const module = found.cls.module!
        if (!module.complete) reading.complete = false
        for (const ref of module.exports) {
          addFound(dtsRef(found.file, ref, deps, found.owner), reading, 1)
        }
      } else {
        const decorator = decoratorOf(found.node, NG_MODULE)
        if (!decorator?.whole) reading.complete = false
        for (const element of listed(
          propertyOf(decorator?.options, "exports")
        )) {
          addEntry(found.file, element, reading, 1)
        }
      }
      return { directives: reading.out, complete: reading.complete }
    })
  } finally {
    expanding.delete(key)
  }
}

function addDirective(
  read: { value: Directive | null | undefined; deps: Set<string> },
  reading: Reading
) {
  for (const dep of read.deps) reading.deps.add(dep)
  const directive = read.value
  if (directive === undefined) reading.complete = false
  if (!directive) return
  const key = `${directive.file}\u0000${directive.name}`
  if (reading.seen.has(key)) return
  reading.seen.add(key)
  reading.out.push(directive)
}

// What an entry of a scope brings into it: a directive or component, an
// array of more entries, or what a module exports.
function addFound(found: Found | null, reading: Reading, depth: number) {
  if (!found || depth > MAX_DEPTH) {
    reading.complete = false
    return
  }
  if (found.kind === "array" || found.kind === "tuple") {
    const list = found.kind === "array" ? found.elements : found.refs
    const opened = openList(reading.lists, list)
    if (opened === "loop") reading.complete = false
    if (opened !== "new") return
    if (found.kind === "array") {
      for (const element of found.elements)
        addEntry(found.file, element, reading, depth + 1)
    } else {
      for (const ref of found.refs)
        addFound(
          dtsRef(found.file, ref, reading.deps, found.owner),
          reading,
          depth + 1
        )
    }
    reading.lists.open.delete(list)
    return
  }
  const decorator =
    found.kind === "source"
      ? decoratorOf(found.node, [...DIRECTIVE, ...NG_MODULE, ...PIPE])
      : null
  // A pipe is matched by no element.
  if (decorator?.name === "Pipe" || (found.kind === "class" && found.cls.pipe))
    return
  if (
    decorator?.name === "NgModule" ||
    (found.kind === "class" && found.cls.module)
  ) {
    const exported = exportsOfModule(found, reading.helpers)
    // A module that exports one being read: the cycle is not followed,
    // and what lies past it is not known.
    if (!exported) {
      reading.complete = false
      return
    }
    for (const dep of exported.deps) reading.deps.add(dep)
    if (!exported.value.complete) reading.complete = false
    for (const directive of exported.value.directives) {
      addDirective({ value: directive, deps: new Set() }, reading)
    }
    return
  }
  if (found.kind === "source" ? !decorator : !found.cls.directive) {
    // A class neither decorated nor compiled: no one Angular knows.
    reading.complete = false
    return
  }
  addDirective(directiveIn(found, reading.helpers), reading)
}

function addEntry(file: string, node: any, reading: Reading, depth: number) {
  const name = referenceIn(node)
  const found = name ? lookup(file, name, reading.deps) : null
  // `MAT.concat([…])` gives what this does not read.
  if (memberCall(node) && !isModule(found)) {
    reading.complete = false
    return
  }
  addFound(found, reading, depth)
}

function isModule(found: Found | null) {
  if (found?.kind === "source") return !!decoratorOf(found.node, NG_MODULE)
  return found?.kind === "class" && !!found.cls.module
}

const NOT_SOURCE = /\.(?:d|spec|test)\.[cm]?ts$/
const PROJECT_ROOT = ["package.json", "project.json", "angular.json"]

// Whether a module's `declarations` name the class `name` of `file`,
// through the constants they are written as, each read once.
function declares(
  moduleFile: string,
  module: ParsedModule,
  list: any,
  file: string,
  name: string,
  deps: Set<string>,
  depth = 0,
  lists = new Set<unknown>()
): boolean {
  if (depth > MAX_DEPTH || lists.has(list)) return false
  lists.add(list)
  for (const element of listed(list)) {
    const local = referenceIn(element)
    if (!local) continue
    const declared = module.declarations.get(local)
    if (declared) {
      if (declared.type === "ClassDeclaration") {
        if (realpath(moduleFile) === file && local === name) return true
      } else if (
        declares(
          moduleFile,
          module,
          declared,
          file,
          name,
          deps,
          depth + 1,
          lists
        )
      ) {
        return true
      }
      continue
    }
    const imported = module.imports.get(local)
    if (
      !imported ||
      imported.name === "*" ||
      installedSpec(imported.spec, moduleFile)
    ) {
      continue
    }
    const binding = definingExportOf(
      imported.spec,
      imported.name,
      moduleFile,
      deps
    )
    if (binding && binding.name === name && realpath(binding.file) === file)
      return true
  }
  return false
}

// The NgModule that declares a component, in its directory or one above
// it up to the project's root, where apps keep their modules.
function declaringModuleOf(file: string, name: string, deps: Set<string>) {
  const own = realpath(file)
  let dir = path.dirname(file)
  for (let depth = 0; depth < 12; depth++) {
    // A module added later changes its directory.
    deps.add(dir)
    for (const entry of listing(dir)) {
      if (!/\.[cm]?ts$/.test(entry) || NOT_SOURCE.test(entry)) continue
      const candidate = path.join(dir, entry)
      const text = readText(candidate)
      // Most files never mention the component; they are not parsed.
      if (!text?.includes("NgModule") || !text.includes(name)) continue
      deps.add(candidate)
      const module = moduleOf(candidate)
      for (const node of module?.declarations.values() ?? []) {
        if (node.type !== "ClassDeclaration") continue
        const decorator = decoratorOf(node, NG_MODULE)
        if (
          decorator &&
          declares(
            candidate,
            module!,
            propertyOf(decorator.options, "declarations"),
            own,
            name,
            deps
          )
        ) {
          return { file: candidate, decorator }
        }
      }
    }
    if (PROJECT_ROOT.some((marker) => isFile(path.join(dir, marker)))) break
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return null
}

// What a component's template can use, as a matcher of their selectors.
function scopeOf(
  file: string,
  meta: ComponentMeta,
  compiler: any,
  helpers: ReadonlySet<string>
) {
  const scope = memoize(
    `angular:directives:${file}\u0000${meta.name}\u0000${[...helpers].join(",")}`,
    () => {
      const reading: Reading = {
        out: [],
        seen: new Set(),
        deps: new Set([file]),
        helpers,
        complete: true,
        lists: noLists(),
      }
      // A spread among the component's options can carry its imports.
      if (meta.spreads) reading.complete = false
      if (meta.imports) {
        for (const node of listed(meta.imports)) {
          addEntry(file, node, reading, 0)
        }
      } else {
        const declaring = declaringModuleOf(file, meta.name, reading.deps)
        if (declaring) {
          const { options, whole } = declaring.decorator
          if (!whole) reading.complete = false
          for (const key of ["declarations", "imports"]) {
            for (const node of listed(propertyOf(options, key))) {
              addEntry(declaring.file, node, reading, 0)
            }
          }
        } else if (meta.standalone !== true) {
          // Standalone with nothing imported uses nothing; else the module
          // that declares it was not found.
          reading.complete = false
        }
      }
      return {
        directives: reading.out,
        complete: reading.complete,
        deps: reading.deps,
        signature: signatureOf(reading.deps),
        matcher: null as any,
      }
    },
    (hit) => hit.signature !== signatureOf(hit.deps)
  )
  if (!scope.matcher) {
    const matcher = new compiler.SelectorMatcher()
    for (const directive of scope.directives) {
      try {
        matcher.addSelectables(
          compiler.CssSelector.parse(directive.selector),
          directive
        )
      } catch {
        // A selector the compiler rejects matches nothing in a build.
      }
    }
    scope.matcher = matcher
  }
  return scope
}

// Whether a selector names the element by this tag or attribute. A tag
// names only a selector that asks nothing more: `p-select[multiple]` is a
// directive added to the p-select component, not the component.
function selectorNames(selector: any, name: string) {
  if (selector?.element === name) {
    return !selector.attrs?.length && !selector.classNames?.length
  }
  const attrs: string[] = selector?.attrs ?? []
  for (let i = 0; i < attrs.length; i += 2) {
    if (attrs[i] === name) return true
  }
  return false
}

function targetOf(compiler: any, element: ElementSelector) {
  const target = new compiler.CssSelector()
  target.setElement(element.tag)
  for (const [attribute, value] of element.attributes) {
    target.addAttribute(attribute, value)
    if (attribute.toLowerCase() === "class") {
      for (const className of value.trim().split(/\s+/)) {
        if (className) target.addClassName(className)
      }
    }
  }
  return target
}

// The directives that match the element, with the selector each matched
// by, per component of the template; null without compiler or component.
function matchesOf(
  template: string,
  physical: string,
  element: ElementSelector,
  helpers: ReadonlySet<string>
) {
  const compiler = angularCompiler(physical)
  if (!compiler?.SelectorMatcher || !compiler.CssSelector) return null
  const owners = templateOwners(template, physical)
  if (!owners.length) return null
  const target = targetOf(compiler, element)
  return owners.map(({ file, meta }) => {
    const scope = scopeOf(file, meta, compiler, helpers)
    const matched: { selector: any; directive: Directive }[] = []
    scope.matcher.match(target, (selector: any, directive: Directive) => {
      matched.push({ selector, directive })
    })
    return { matched, complete: scope.complete }
  })
}

function knownOf(directive: Directive): Known {
  const { file, name, sole, hosted, compiled } = directive
  return { file, name, sole, hosted, compiled }
}

function stylesIn(directive: Directive, helpers: ReadonlySet<string>) {
  const { found } = directive
  return derived(
    `angular:styles:${found.file}\u0000${found.name}\u0000${[...helpers].join(",")}`,
    (deps) => {
      deps.add(found.file)
      return found.kind === "source"
        ? stylesOf(found, deps, helpers)
        : compiledStylesOf(found, deps)
    }
  ).value
}

// An input whose public name is `class` takes the element's class to put
// it where the directive likes: Material's MatMenu on its panel through
// panelClass. Unknown when an input's name cannot be read.
function takesClass(directive: Directive) {
  if (directive.inputs.has("class")) return true
  return directive.complete ? false : null
}

// The directive an element's name stands for: the first in the template's
// scope whose selector matches the element and names it.
export function directiveOf(
  template: string,
  physical: string,
  element: ElementSelector,
  name: string,
  helpers: ReadonlySet<string>
): DirectiveRef | null {
  for (const { matched } of matchesOf(template, physical, element, helpers) ??
    []) {
    const found = matched.find(({ selector }) => selectorNames(selector, name))
    if (found) {
      return {
        ...knownOf(found.directive),
        component: found.directive.component,
        styles: either([
          takesClass(found.directive),
          stylesIn(found.directive, helpers),
        ]),
      }
    }
  }
  return null
}

// The project's component an element is the host of, whose styles can be
// read; null for a library's compiled one, or when none can be told.
export function hostComponentOf(
  template: string,
  physical: string,
  element: ElementSelector,
  helpers: ReadonlySet<string>
): DirectiveClass | null {
  for (const { matched } of matchesOf(template, physical, element, helpers) ??
    []) {
    const found = matched.find(({ directive }) => directive.component)
    if (found) {
      const { file, name, sole, compiled } = found.directive
      return compiled ? null : { file, name, sole }
    }
  }
  return null
}

// A directive that takes an input, and the element's names its selector
// matched by: `mat-flat-button` for one on `button[mat-flat-button]`.
type InputOwner = Known & {
  component: boolean
  names: string[]
}

// Each directive the element matches that declares the input by its
// public name. Empty when every one was read whole and none takes it, so
// the value lands nowhere; null when that cannot be told.
export function inputOwnersOf(
  template: string,
  physical: string,
  element: ElementSelector,
  input: string,
  helpers: ReadonlySet<string>
): InputOwner[] | null {
  const scopes = matchesOf(template, physical, element, helpers)
  if (!scopes) return null
  const names = [element.tag, ...element.names]
  let known = true
  for (const { matched, complete } of scopes) {
    const owners = new Map<Directive, Set<string>>()
    for (const { selector, directive } of matched) {
      if (!directive.inputs.has(input)) {
        if (!directive.complete) known = false
        continue
      }
      let by = owners.get(directive)
      if (!by) owners.set(directive, (by = new Set()))
      for (const name of names) if (selectorNames(selector, name)) by.add(name)
    }
    if (owners.size) {
      return [...owners].map(([directive, by]) => ({
        ...knownOf(directive),
        component: directive.component,
        names: [...by],
      }))
    }
    if (!complete) known = false
  }
  return known ? [] : null
}

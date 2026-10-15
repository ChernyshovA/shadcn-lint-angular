// The classes an Angular component's own styles declare, for its
// template the way an SFC's <style> block serves its own. The component
// is the .ts whose @Component names the template: by templateUrl from
// the template's directory, or, for an inline template, the file
// angular-eslint's processor took it from.
//
// What cannot be read settles nothing on its own: a selector built from
// an interpolation settles the prefix before it, and styles that are not
// written out (`styles: [shared]`, a stylesheet that is missing, `&` with
// no rule around it) settle every class in the template. Better quiet
// than wrong, but not silent: `unread` says why, for a warning.

import * as fs from "node:fs"
import * as path from "node:path"

import { angularProjectFor } from "./angular-workspace"
import { findUp, isDirectory, memoize, mtimeOf, NODE_MODULES } from "./fs"
import { parseSource } from "./parser"
import { packageRoot, readJsonc, resolveFile } from "./resolve"
import { parseClassSelectors } from "./theme"

// Why styles settle every class: `reason` is a phrase, `where` the
// stylesheet it is in when that is not the component's own file.
export type Unread = {
  reason: string
  where: string | null
  component?: string
  file?: string
}

export type OwnClasses = {
  has: (name: string) => boolean
  unread: Unread | null
  // The classes the project's own stylesheets name, past a package's
  // and those an interpolation builds.
  names?: () => Iterable<string>
  // The properties the rules a class is in set. Null for a class they do
  // not declare, one whose rules set what cannot be read as a property,
  // or one they may declare otherwise too, as an interpolated selector
  // may.
  propertiesOf?: (name: string) => readonly string[] | null
}

type Declared = {
  classes: Set<string>
  // Those of them a stylesheet of the project's own writes.
  local: Set<string>
  prefixes: string[]
  // Those a selector puts on the component's own element, `:host(.x)`,
  // which reach it where another template uses the component.
  host: Set<string>
  hostPrefixes: string[]
  // By class, what the rules it is in set (OwnClasses.propertiesOf).
  properties: Map<string, Set<string>>
  // What nesting has grown the selectors read so far by (MAX_NESTED).
  nested: number
  unread: Unread | null
}

export type ComponentMeta = {
  name: string
  templateUrl: string | null
  // An inline template angular-eslint's processor hands over.
  inline: boolean
  styleUrls: string[]
  styles: string[]
  // A metadata value that is not written out.
  unread: string | null
  // The `imports` of a standalone component, as written.
  imports: any
  // `standalone` as written, null when it is not.
  standalone: boolean | null
  // Whether the decorator spreads an object, which can carry any option.
  spreads: boolean
}

const declaredNothing = (): Declared => ({
  classes: new Set(),
  local: new Set(),
  prefixes: [],
  host: new Set(),
  hostPrefixes: [],
  properties: new Map(),
  nested: 0,
  unread: null,
})

const EMPTY = declaredNothing()

type Kept<T> = Map<string, { mtimeMs: number | null; value: T }>

// An answer about a file or a directory, kept while its mtime stands:
// one for each path, however many times an editor saves it, since the
// ESLint server of an editor outlives many saves.
function whileUnchanged<T>(kept: Kept<T>, at: string, compute: () => T): T {
  const mtimeMs = mtimeOf(at)
  const hit = kept.get(at)
  if (hit && hit.mtimeMs === mtimeMs) return hit.value
  const value = compute()
  kept.set(at, { mtimeMs, value })
  return value
}

const texts: Kept<string | null> = new Map()

// A file's text, or null for one that cannot be read.
export function readText(file: string) {
  return whileUnchanged(texts, file, () => {
    try {
      return fs.readFileSync(file, "utf8")
    } catch {
      return null
    }
  })
}

const listings: Kept<string[]> = new Map()

// What a directory holds, or nothing for one that cannot be read.
export function listing(dir: string) {
  return whileUnchanged(listings, dir, () => {
    try {
      return fs.readdirSync(dir)
    } catch {
      return []
    }
  })
}

const read = readText

function stringOf(node: any): string | null {
  if (node?.type === "Literal" && typeof node.value === "string") {
    return node.value
  }
  if (node?.type === "TemplateLiteral" && !node.expressions?.length) {
    return node.quasis?.[0]?.value?.cooked ?? null
  }
  return null
}

// A value as the warning can name it.
function shown(node: any): string {
  if (node?.type === "Identifier") return `\`${node.name}\``
  if (node?.type === "SpreadElement")
    return `\`...${shown(node.argument).replaceAll("`", "")}\``
  return "an expression"
}

// The strings a styleUrl, styleUrls or styles value writes out, and the
// first value that is not one.
function stringsOf(node: any, key: string) {
  const out: string[] = []
  let unread: string | null = null
  const elements = node?.type === "ArrayExpression" ? node.elements : [node]
  for (const element of elements) {
    const value = stringOf(element)
    if (value !== null) out.push(value)
    else unread ??= `${key} holds ${shown(element)}, not a string`
  }
  return { out, unread }
}

// The class declarations of a file, in order, as angular-eslint's
// processor finds them: nested ones too, as in a test file, but none
// inside another class.
function classesOf(program: any): any[] {
  const out: any[] = []
  const visit = (node: any) => {
    if (Array.isArray(node)) {
      for (const child of node) visit(child)
      return
    }
    if (!node || typeof node.type !== "string") return
    if (node.type === "ClassDeclaration") {
      out.push(node)
      return
    }
    if (node.type === "ImportDeclaration") return
    for (const key in node) {
      if (key === "parent" || key === "loc" || key === "range") continue
      const value = node[key]
      if (value && typeof value === "object") visit(value)
    }
  }
  visit(program?.body)
  return out
}

// A key as the processor matches one, by its text: `template`, not
// `"template"` or `["template"]`.
const keyed = (property: any, name: string) =>
  property?.type === "Property" &&
  !property.computed &&
  property.key?.type === "Identifier" &&
  property.key.name === name

// Whether angular-eslint's processor hands this decorator's template over
// as a file of its own, and so counts it in the names it gives them
// (processors.js, preprocessComponentFile): a decorator given only its
// options, with no `templateUrl`, whose first `template` is written
// `template: …` as a string or template literal that is not empty.
function handedOver(call: any) {
  if (call.arguments?.length !== 1) return false
  const properties = call.arguments[0].properties ?? []
  if (properties.some((property: any) => keyed(property, "templateUrl")))
    return false
  const property = properties.find((property: any) =>
    keyed(property, "template")
  )
  if (
    !property ||
    property.kind !== "init" ||
    property.method ||
    property.shorthand
  )
    return false
  const value = property.value
  if (value?.type === "TemplateLiteral") {
    return value.quasis.length > 1 || value.quasis[0]?.value?.raw !== ""
  }
  return (
    value?.type === "Literal" &&
    typeof value.value === "string" &&
    value.value !== ""
  )
}

const components: Kept<ComponentMeta[]> = new Map()

// Each @Component({...}) in the file, in order.
function componentsIn(file: string): ComponentMeta[] {
  return whileUnchanged(components, file, () => {
    const source = read(file)
    if (source === null) return []
    let program: any
    try {
      program = parseSource(source, file)
    } catch {
      return []
    }
    const out: ComponentMeta[] = []
    for (const declaration of classesOf(program)) {
      for (const decorator of declaration.decorators ?? []) {
        const call = decorator.expression
        if (
          call?.type !== "CallExpression" ||
          call.callee?.type !== "Identifier" ||
          call.callee.name !== "Component"
        ) {
          continue
        }
        // The processor skips a decorator that is not given an object,
        // and a templateUrl cannot be read from one either.
        const object = call.arguments?.[0]
        if (object?.type !== "ObjectExpression") continue
        const meta: ComponentMeta = {
          name: declaration.id?.name ?? "the component",
          templateUrl: null,
          inline: false,
          styleUrls: [],
          styles: [],
          unread: null,
          imports: null,
          standalone: null,
          spreads: false,
        }
        for (const property of object.properties) {
          if (property.type !== "Property") {
            // A spread can carry any of them.
            meta.spreads = true
            meta.unread ??= `the decorator spreads ${shown(property)}`
            continue
          }
          const key = property.key?.name ?? property.key?.value
          if (key === "templateUrl") {
            meta.templateUrl = stringOf(property.value)
          } else if (key === "imports") {
            meta.imports = property.value
          } else if (key === "standalone") {
            const value = property.value?.value
            meta.standalone = typeof value === "boolean" ? value : null
          } else if (
            key === "styleUrl" ||
            key === "styleUrls" ||
            key === "styles"
          ) {
            const { out, unread } = stringsOf(property.value, key)
            if (key === "styles") meta.styles.push(...out)
            else meta.styleUrls.push(...out)
            meta.unread ??= unread
          }
        }
        meta.inline = handedOver(call)
        out.push(meta)
      }
    }
    return out
  })
}

// The components in the template's directory that name it.
function ownersOf(template: string) {
  const dir = path.dirname(template)
  const base = path.basename(template)
  const out: { file: string; meta: ComponentMeta }[] = []
  for (const entry of listing(dir)) {
    if (!/\.[cm]?ts$/.test(entry) || /\.(d|spec|test)\.[cm]?ts$/.test(entry)) {
      continue
    }
    const file = path.join(dir, entry)
    // Most files never mention the template; they are not parsed.
    if (!read(file)?.includes(base)) continue
    for (const meta of componentsIn(file)) {
      if (
        meta.templateUrl !== null &&
        path.resolve(dir, meta.templateUrl) === template
      ) {
        out.push({ file, meta })
      }
    }
  }
  return out
}

// An inline template's component: the nth inline template of the .ts it
// sits in, or every one when its number cannot be read. Null for a
// template in a file of its own.
function inlineMetasOf(template: string, physical: string) {
  if (template === physical || !/\.[cm]?ts$/.test(physical)) return null
  const metas = componentsIn(physical).filter((meta) => meta.inline)
  const nth = /-(\d+)\.component\.html$/.exec(template)
  const own = nth ? metas[Number(nth[1]) - 1] : undefined
  return own ? [own] : metas
}

// The components a template belongs to. `template` is the file the
// linter was handed, `physical` the file on disk.
export function templateOwners(template: string, physical: string) {
  const inline = inlineMetasOf(template, physical)
  return inline
    ? inline.map((meta) => ({ file: physical, meta }))
    : ownersOf(path.resolve(physical))
}

// A stylesheet being read: the files already read, and the include
// paths a bare Sass import is looked for in after its own directory.
type Reading = { seen: Set<string>; includes: readonly string[] }

// A Sass or Less import, as the files it may name: beside the file,
// then in each include path, then, for a bare name, in the package it
// names, as Angular resolves `@use "font-awesome"`.
function importCandidates(
  from: string,
  spec: string,
  includes: readonly string[]
) {
  const bases = [path.dirname(from)]
  const bare = !spec.startsWith(".") && !path.isAbsolute(spec)
  if (bare) bases.push(...includes)
  const out = bases.flatMap((base) => candidatesAt(path.resolve(base, spec)))
  return bare ? [...out, ...packageCandidates(from, spec)] : out
}

// A package's own stylesheet is its `sass` or `style` entry, or its index,
// else what its `exports` give a stylesheet's import, as a CSS import of
// `tw-animate-css` finds `./dist/tw-animate.css` under `style`.
function packageCandidates(from: string, spec: string) {
  const match = /^((?:@[\w.-]+\/)?[\w.-]+)(?:\/(.+))?$/.exec(spec)
  if (!match) return []
  const [, name, subpath] = match
  const json = findUp(
    path.dirname(from),
    path.join("node_modules", name, "package.json")
  )
  if (!json) return []
  const dir = path.dirname(json)
  const fromDir = path.dirname(from)
  const exported = resolveFile(
    spec,
    fromDir,
    packageRoot(from) ?? fromDir,
    [],
    {
      stylesheet: true,
      skipPaths: true,
    }
  )
  const viaExports = exported && STYLESHEET.test(exported) ? [exported] : []
  if (subpath) return [...candidatesAt(path.join(dir, subpath)), ...viaExports]
  const manifest = readJsonc(json)
  const entry = [manifest?.sass, manifest?.style].find(
    (value) => typeof value === "string"
  )
  return [
    ...(entry ? [path.join(dir, entry)] : []),
    ...candidatesAt(path.join(dir, "index")),
    ...viaExports,
  ]
}

const STYLESHEET = /\.(?:css|scss|sass|less)$/

function candidatesAt(target: string) {
  const dir = path.dirname(target)
  const name = path.basename(target)
  const ext = path.extname(name)
  if (ext === ".css" || ext === ".scss" || ext === ".sass" || ext === ".less") {
    return [target, path.join(dir, `_${name}`)]
  }
  const out: string[] = []
  for (const extension of [".scss", ".sass", ".css", ".less"]) {
    out.push(path.join(dir, `${name}${extension}`))
    out.push(path.join(dir, `_${name}${extension}`))
    out.push(path.join(target, `_index${extension}`))
    out.push(path.join(target, `index${extension}`))
  }
  return out
}

// A placeholder for what an interpolation (`#{$x}`, `@{x}`) produces, and
// for the rule a top-level or mixin `&` stands for.
const HOLE = "\u0000"
const UNKNOWN = "\u0001"

// Comments out, strings kept as written: `content: " // x"` holds no
// comment. A line comment starts where a token may, after a space or a
// brace, so `url(//cdn.test/a.css)` is no comment either. The last
// character written is kept aside: reading it back from the text being
// built flattens that text each time, which made a large stylesheet's
// comments take seconds.
function stripComments(css: string) {
  let out = ""
  let last = ""
  let i = 0
  while (i < css.length) {
    const c = css[i]
    if (c === '"' || c === "'") {
      // A string ends at its quote, or, unclosed, at the line's end.
      let j = i + 1
      while (j < css.length && css[j] !== c && css[j] !== "\n") {
        j += css[j] === "\\" ? 2 : 1
      }
      const string = css.slice(i, j + 1)
      out += string
      last = string[string.length - 1]
      i = j + 1
    } else if (c === "/" && css[i + 1] === "*") {
      const end = css.indexOf("*/", i + 2)
      out += " "
      last = " "
      i = end === -1 ? css.length : end + 2
    } else if (
      c === "/" &&
      css[i + 1] === "/" &&
      (last === "" || /[\s;{}]/.test(last))
    ) {
      while (i < css.length && css[i] !== "\n" && css[i] !== "\r") i++
    } else {
      out += c
      last = c
      i++
    }
  }
  return out
}

const QUOTED = /^(["'])((?:\\.|(?!\1)[^\\])*)\1/s
const URL = /^url\(\s*(?:(["'])((?:\\.|(?!\1)[^\\])*)\1|([^\s"'()]*))\s*\)/s

// The URLs an import statement names, `#{…}` read as a hole: the one
// right after @use or @forward, what follows it being `as`, `with (…)`,
// `show` or `hide`; each of @import's list, a string or `url(…)`, before
// its media query; and the one meta.load-css loads.
function importsOf(statement: string): string[] {
  const at = /^@(import|use|forward)\s+/.exec(statement)
  if (!at) {
    const load = /^@include\s+(?:[\w-]+\.)?load-css\(\s*(["'])([^"']+)\1/.exec(
      statement
    )
    return load ? [load[2]] : []
  }
  const out: string[] = []
  let rest = statement.slice(at[0].length)
  for (;;) {
    const quoted = QUOTED.exec(rest)
    const url = quoted ? null : at[1] === "import" ? URL.exec(rest) : null
    const written = quoted?.[2] ?? url?.[2] ?? url?.[3]
    if (written === undefined) break
    if (written) out.push(written)
    if (at[1] !== "import") break
    rest = rest.slice((quoted ?? url)![0].length)
    const comma = /^\s*,\s*/.exec(rest)
    if (!comma) break
    rest = rest.slice(comma[0].length)
  }
  return out
}

// Splits on commas outside parentheses: `:is(.a, .b), .c`.
function splitSelectors(text: string) {
  const out: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === "(") depth++
    else if (c === ")") depth--
    else if (c === "," && depth === 0) {
      out.push(text.slice(start, i))
      start = i + 1
    }
  }
  out.push(text.slice(start))
  return out.map((part) => part.trim()).filter(Boolean)
}

// The compound selectors of a selector, outside parentheses, brackets
// and strings: `.a > .b:is(.c .d)` is `.a`, `.b:is(.c .d)`.
function compoundsOf(selector: string) {
  const out: string[] = []
  let depth = 0
  let quote: string | null = null
  let current = ""
  for (const c of selector) {
    if (quote) {
      if (c === quote) quote = null
    } else if (c === '"' || c === "'") quote = c
    else if (c === "(" || c === "[") depth++
    else if (c === ")" || c === "]") depth--
    else if (depth === 0 && /[\s>+~]/.test(c)) {
      if (current) out.push(current)
      current = ""
      continue
    }
    current += c
  }
  if (current) out.push(current)
  return out
}

// What a rule's selector is to the rules nested in it. `&` glues them to
// its first or its last compound; every class between those is declared
// already, with the rule itself. Kept as those two, the selectors of a
// rule that differ only between them are one parent, so that `.a, .b`
// nested in itself twenty times over is four parents, not a million.
function asParent(selector: string) {
  const compounds = compoundsOf(selector)
  return compounds.length > 2
    ? `${compounds[0]} ${compounds[compounds.length - 1]}`
    : selector
}

// The most the selectors of a stylesheet's rules may grow by, nested in
// the rules around them, with those of what it imports, read at once: a
// rule nested in none grows by nothing, so a vendor stylesheet of flat
// rules is read whatever its size. `&` twice in one compound,
// `&:not(&)`, doubles a selector at each level, and `&-x, &-y` doubles
// how many there are, each longer than the last; rules side by side
// under such a one add up. The styles of the projects this was tried on
// came to under 100,000 characters read at once, a few hundred a rule.
const MAX_NESTED = 1_000_000

// The selectors of a rule nested in rules with these selectors, or null
// when they grow what is read past MAX_NESTED characters.
function nest(
  parents: readonly string[],
  selector: string,
  declared: Declared
) {
  const out: string[] = []
  let size = declared.nested
  for (const part of splitSelectors(selector)) {
    const amps = part.split("&").length - 1
    for (const parent of parents) {
      const glued = parent === "" ? UNKNOWN : parent
      size += amps
        ? amps * (glued.length - 1)
        : parent === "" || parent === UNKNOWN
          ? 0
          : parent.length + 1
      if (size > MAX_NESTED) return null
      out.push(
        amps
          ? part.replaceAll("&", glued)
          : parent === "" || parent === UNKNOWN
            ? part
            : `${parent} ${part}`
      )
    }
  }
  declared.nested = size
  return out
}

// A selector as a message shows it: on one line, its start.
function shownSelector(selector: string) {
  const line = written(selector.replace(/\s+/g, " ").trim())
  return line.length > 60 ? `${line.slice(0, 60)}…` : line
}

// A rule's selectors declared, what the rules nested in it nest in, and
// the classes its declarations set properties for: none, in rules whose
// selectors grow by more than can be read, which leave the stylesheet
// unread.
function enter(
  parents: readonly string[],
  selector: string,
  declared: Declared,
  file: string | null
) {
  const selectors = nest(parents, selector, declared)
  if (!selectors) {
    declared.unread ??= {
      reason: `the selectors of its rules, nested in the rules around them, grow by more than ${MAX_NESTED} characters, at \`${shownSelector(selector)}\``,
      where: file,
    }
    return null
  }
  const classes = new Set<string>()
  for (const one of selectors) {
    addSelector(one, declared, file)
    for (const name of classNamesIn(one)) {
      if (!name.includes(HOLE)) {
        classes.add(name)
        declared.local.add(name)
      }
    }
  }
  return {
    parents: [...new Set(selectors.map(asParent))],
    classes: [...classes],
  }
}

// What cannot be read as a property: `@include`, `@extend`, `@apply`, a
// property whose name is interpolated, a package's rule.
const OPAQUE = "?"

function setsOn(
  declared: Declared,
  classes: Iterable<string>,
  property: string
) {
  for (const name of classes) {
    let set = declared.properties.get(name)
    if (!set) declared.properties.set(name, (set = new Set()))
    set.add(property)
  }
}

const PROPERTY = /^(-{0,2}[a-zA-Z][\w-]*)\s*:/

// A selector as it was written.
const written = (selector: string) =>
  selector.replaceAll(HOLE, "#{…}").replaceAll(UNKNOWN, "&")

const classNamesIn = (text: string) =>
  [
    ...text.matchAll(new RegExp(`\\.(-?[_a-zA-Z${HOLE}][\\w${HOLE}-]*)`, "g")),
  ].map((match) => match[1])

// The compound selectors that put classes on the component's own element:
// `:host(.x)`, `:host.x` (`&.x` inside `:host`), and `:host-context(.y).x`,
// whose context may be the element itself. Angular's emulation compiles
// each to `.x[_nghost-…]` (ShadowCss in @angular/compiler).
// One nested in another's parentheses is part of that one, so the
// selector is read once.
function hostCompoundsOf(selector: string) {
  const out: string[] = []
  const host = /:host(?:-context)?(?![\w-])/g
  for (let match = host.exec(selector); match; match = host.exec(selector)) {
    let depth = 0
    let end = match.index
    for (; end < selector.length; end++) {
      const c = selector[end]
      if (c === "(") depth++
      else if (c === ")") depth--
      else if (depth === 0 && /[\s>+~]/.test(c)) break
    }
    out.push(selector.slice(match.index, end))
    host.lastIndex = Math.max(host.lastIndex, end)
  }
  return out
}

function addSelector(
  selector: string,
  declared: Declared,
  file: string | null
) {
  // `&-header` under a rule this file does not show.
  if (new RegExp(`${UNKNOWN}[\\w-]`).test(selector)) {
    declared.unread ??= {
      reason: `\`${written(selector)}\` has no rule around it to stand for &`,
      where: file,
    }
  }
  for (const name of classNamesIn(selector)) {
    const hole = name.indexOf(HOLE)
    if (hole === -1) declared.classes.add(name)
    else if (hole === 0) {
      declared.unread ??= {
        reason: `the selector \`${written(selector)}\` starts with an interpolation`,
        where: file,
      }
    } else declared.prefixes.push(name.slice(0, hole))
  }
  for (const compound of hostCompoundsOf(selector)) {
    for (const name of classNamesIn(compound)) {
      const hole = name.indexOf(HOLE)
      if (hole === -1) declared.host.add(name)
      else if (hole > 0) declared.hostPrefixes.push(name.slice(0, hole))
    }
  }
}

const NOT_SELECTORS = /^@(?:-\w+-)?(?:keyframes|font-face|page|property)\b/
const OWN_SCOPE = /^@(?:mixin|function)\b/

// The classes CSS, SCSS or Less selects, with nesting and `&` resolved.
// Indented Sass and Stylus are read as flat text, and so is a package's
// stylesheet: its classes are what it writes out, and what it builds is
// not the project's to fix.
function declareStyles(
  css: string,
  file: string | null,
  declared: Declared,
  reading: Reading
) {
  if (file && NODE_MODULES.test(file)) {
    for (const name of parseClassSelectors(css)) {
      declared.classes.add(name)
      setsOn(declared, [name], OPAQUE)
    }
    return
  }
  if (file && /\.(sass|styl)$/i.test(file)) {
    for (const name of parseClassSelectors(css)) {
      declared.classes.add(name)
      setsOn(declared, [name], OPAQUE)
    }
    if (/&[\w-]|#\{/.test(css)) {
      declared.unread ??= {
        reason:
          "indented Sass and Stylus are read as flat selectors, and this one nests or interpolates",
        where: file,
      }
    }
    return
  }
  const text = stripComments(css)
  // Each open block's selectors; null inside one that holds none.
  const stack: (string[] | null)[] = []
  let parents: string[] | null = [""]
  // The classes of the rule a declaration is in, for each open block.
  const ruleStack: string[][] = []
  let rule: string[] = []
  let prelude = ""
  // A statement ends at its semicolon, or with the block or the file it
  // is last in. In a rule, it is a declaration, or what may set any.
  const statement = () => {
    const head = prelude.trim()
    if (file) {
      for (const spec of importsOf(head)) {
        declareImport(file, spec, declared, reading)
      }
    }
    if (rule.length && head && !head.startsWith("$")) {
      const property = head.startsWith("@") ? null : PROPERTY.exec(head)
      if (property) setsOn(declared, rule, property[1].toLowerCase())
      else if (!/^@(?:import|use|forward)\b/.test(head)) {
        setsOn(declared, rule, OPAQUE)
      }
    }
    prelude = ""
  }
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === '"' || c === "'") {
      let j = i + 1
      while (j < text.length && text[j] !== c) j += text[j] === "\\" ? 2 : 1
      prelude += text.slice(i, j + 1)
      i = j
    } else if ((c === "#" || c === "@") && text[i + 1] === "{") {
      const end = text.indexOf("}", i)
      prelude += HOLE
      i = end === -1 ? text.length : end
    } else if (c === "{") {
      const head = prelude.trim()
      stack.push(parents)
      ruleStack.push(rule)
      if (parents === null || NOT_SELECTORS.test(head)) {
        parents = null
        rule = []
      } else if (OWN_SCOPE.test(head)) {
        parents = [UNKNOWN]
        rule = []
      } else if (head.startsWith("@at-root")) {
        const rest = head.slice("@at-root".length).trim()
        const entered = rest ? enter([""], rest, declared, file) : null
        parents = rest ? (entered?.parents ?? null) : [""]
        rule = entered?.classes ?? []
      } else if (head.startsWith("@")) {
        // @media, @supports, @include's content block, @if, @each: the
        // rule around them is still the rule. A mixin sets what it likes.
        if (/^@include\b/.test(head)) setsOn(declared, rule, OPAQUE)
      } else if (/^[\w-]+\s*:/.test(head) && !/^[\w-]+:[\w-]/.test(head)) {
        // Nested properties, `font: { family: x }`.
        setsOn(declared, rule, head.split(":")[0].trim().toLowerCase())
        parents = null
        rule = []
      } else {
        const entered = enter(parents, head, declared, file)
        parents = entered?.parents ?? null
        rule = entered?.classes ?? []
      }
      prelude = ""
    } else if (c === "}") {
      statement()
      parents = stack.pop() ?? [""]
      rule = ruleStack.pop() ?? []
    } else if (c === ";") {
      statement()
    } else {
      prelude += c
    }
  }
  statement()
}

const MAX_STYLESHEETS = 64

// An import this cannot read may declare any class: it leaves the
// stylesheet unread, as a selector it cannot read does. Sass's own
// modules declare none, and a stylesheet a URL names is the browser's to
// load, not the build's.
function declareImport(
  from: string,
  spec: string,
  declared: Declared,
  reading: Reading
) {
  if (/^(sass:|https?:|\/\/)/.test(spec)) return
  const unread = (reason: string) => {
    declared.unread ??= { reason, where: from }
  }
  // `~pkg` is webpack's spelling of a package import, which this does
  // not resolve.
  if (spec.startsWith("~")) {
    unread(`the import "${spec}" uses \`~\`, which is not resolved`)
    return
  }
  const { seen } = reading
  for (const candidate of importCandidates(from, spec, reading.includes)) {
    const source = read(candidate)
    if (source === null) continue
    if (seen.has(candidate)) return
    if (seen.size >= MAX_STYLESHEETS) {
      unread(
        `it imports more than ${MAX_STYLESHEETS} stylesheets, and the rest are not read`
      )
      return
    }
    seen.add(candidate)
    declareStyles(source, candidate, declared, reading)
    return
  }
  unread(`the import "${spec}" does not resolve to a stylesheet`)
}

// Why a path names no stylesheet to read, as settings.shadcn.entryPoint
// says it.
function noStylesheet(written: string, at: string) {
  if (!written) return "an empty path names no stylesheet"
  if (isDirectory(at)) return `${written} is a directory, not a stylesheet`
  return `the stylesheet ${written} does not exist`
}

function declaredBy(file: string, metas: ComponentMeta[]) {
  const declared = declaredNothing()
  const seen = new Set<string>()
  const reading = { seen, includes: angularProjectFor(file)?.includes ?? [] }
  for (const meta of metas) {
    const before = declared.unread
    if (meta.unread) declared.unread ??= { reason: meta.unread, where: null }
    for (const url of meta.styleUrls) {
      const sheet = path.resolve(path.dirname(file), url)
      const source = read(sheet)
      if (source === null) {
        declared.unread ??= { reason: noStylesheet(url, sheet), where: null }
        continue
      }
      seen.add(sheet)
      declareStyles(source, sheet, declared, reading)
    }
    for (const source of meta.styles) {
      declareStyles(source, file, declared, reading)
    }
    if (!before && declared.unread) {
      declared.unread = { ...declared.unread, component: meta.name, file }
      if (declared.unread.where === file) declared.unread.where = null
    }
  }
  return declared
}

function toOwnClasses(declared: Declared): OwnClasses {
  return {
    has: (name) =>
      !!declared.unread ||
      declared.classes.has(name) ||
      declared.prefixes.some((prefix) => name.startsWith(prefix)),
    unread: declared.unread,
    names: () => declared.local,
    propertiesOf: (name) => {
      if (declared.unread || !declared.classes.has(name)) return null
      if (declared.prefixes.some((prefix) => name.startsWith(prefix))) {
        return null
      }
      const properties = declared.properties.get(name)
      return properties?.has(OPAQUE) ? null : [...(properties ?? [])]
    },
  }
}

// One stylesheet on its own, imports unread.
export function ownClassesOfCss(css: string, file: string | null = null) {
  const declared = declaredNothing()
  declareStyles(css, file, declared, { seen: new Set(), includes: [] })
  return toOwnClasses(declared)
}

// The classes a project's global stylesheets declare, from angular.json
// or an Nx project.json: every file in the project may use them. Null
// outside an Angular workspace.
export function angularGlobalClassesOf(fromFile: string): OwnClasses | null {
  const project = angularProjectFor(fromFile)
  if (!project?.styles.length) return null
  // What is read depends on the project, which a warning names, and its
  // include paths, as much as on the stylesheets.
  const key = [
    project.config,
    project.root,
    ...project.includes,
    ...project.styles.map((style) => style.file ?? style.input),
  ]
  const declared = memoize(`angular:global:${key.join("\u0000")}`, () => {
    const declared = declaredNothing()
    const reading = { seen: new Set<string>(), includes: project.includes }
    for (const { input, file, config, dir } of project.styles) {
      const sheet = file ?? packageSheet(dir, input)
      const source = sheet === null ? null : read(sheet)
      if (sheet === null || source === null) {
        declared.unread ??= {
          reason: noStylesheet(input, sheet ?? path.resolve(dir, input)),
          where: null,
          file: config,
        }
        continue
      }
      const before = declared.unread
      reading.seen.add(sheet)
      declareStyles(source, sheet, declared, reading)
      if (!before && declared.unread) declared.unread.file = config
    }
    return declared
  })
  return toOwnClasses(declared)
}

// A global style that names a package, `"styles": ["tailwindcss"]`, as
// Angular's stylesheet bundler resolves it from the workspace root: the
// package's stylesheet, as an import of it finds one, never its
// JavaScript.
function packageSheet(dir: string, input: string) {
  if (input.startsWith(".") || path.isAbsolute(input)) return null
  return (
    packageCandidates(path.join(dir, "angular.json"), input).find(
      (candidate) => read(candidate) !== null
    ) ?? null
  )
}

// `template` is the file the linter was handed; `physical` the file on
// disk, a component's .ts when its template is inline. The processor
// names the nth inline template `inline-template-<file>-<n>.component.html`.
export function angularOwnClassesOf(
  template: string,
  physical: string
): OwnClasses {
  const declared = memoize(`angular:own:${template}\u0000${physical}`, () => {
    const inline = inlineMetasOf(template, physical)
    if (inline) return inline.length ? declaredBy(physical, inline) : EMPTY
    const owners = ownersOf(path.resolve(physical))
    if (!owners.length) return EMPTY
    const declared = declaredNothing()
    for (const { file, meta } of owners) {
      const one = declaredBy(file, [meta])
      for (const name of one.classes) declared.classes.add(name)
      for (const name of one.local) declared.local.add(name)
      declared.prefixes.push(...one.prefixes)
      for (const [name, properties] of one.properties) {
        for (const property of properties) setsOn(declared, [name], property)
      }
      declared.unread ??= one.unread
    }
    return declared
  })
  return toOwnClasses(declared)
}

// The classes the styles of a component select on its own element, as
// `:host(.row-fill)` does: where another template uses the component,
// its element there wears them. Every class when its styles cannot be
// read, as in its own template. Null when the file declares no such
// component.
export function angularHostClassesOf(
  file: string,
  name: string
): OwnClasses | null {
  const declared = memoize(`angular:host:${file}\u0000${name}`, () => {
    const meta = componentsIn(file).find((meta) => meta.name === name)
    return meta ? declaredBy(file, [meta]) : null
  })
  if (!declared) return null
  return {
    has: (className) =>
      !!declared.unread ||
      declared.host.has(className) ||
      declared.hostPrefixes.some((prefix) => className.startsWith(prefix)),
    unread: declared.unread,
  }
}

// The classes the styles of the components a .ts file declares select,
// for the host bindings written beside them.
export function angularFileClassesOf(file: string): OwnClasses {
  const declared = memoize(`angular:file:${file}`, () => {
    const metas = componentsIn(file)
    return metas.length ? declaredBy(file, metas) : EMPTY
  })
  return toOwnClasses(declared)
}

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
import { findUp, memoize, mtimeOf, NODE_MODULES } from "./fs"
import { parseSource } from "./parser"
import { readJsonc } from "./resolve"
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
}

type Declared = {
  classes: Set<string>
  prefixes: string[]
  unread: Unread | null
}

type ComponentMeta = {
  name: string
  templateUrl: string | null
  // An inline template angular-eslint's processor hands over.
  inline: boolean
  styleUrls: string[]
  styles: string[]
  // A metadata value that is not written out.
  unread: string | null
}

const declaredNothing = (): Declared => ({
  classes: new Set(),
  prefixes: [],
  unread: null,
})

const EMPTY = declaredNothing()

function read(file: string) {
  return memoize(`angular:read:${file}:${mtimeOf(file)}`, () => {
    try {
      return fs.readFileSync(file, "utf8")
    } catch {
      return null
    }
  })
}

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

function classesOf(program: any): any[] {
  const out: any[] = []
  for (const statement of program?.body ?? []) {
    const node =
      statement.type === "ExportNamedDeclaration" ||
      statement.type === "ExportDefaultDeclaration"
        ? statement.declaration
        : statement
    if (node?.type === "ClassDeclaration") out.push(node)
  }
  return out
}

// Each @Component({...}) in the file, in order.
function componentsIn(file: string): ComponentMeta[] {
  const source = read(file)
  if (source === null) return []
  return memoize(`angular:components:${file}:${mtimeOf(file)}`, () => {
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
        }
        let template = false
        let templateUrl = false
        for (const property of object.properties) {
          if (property.type !== "Property") {
            // A spread can carry any of them.
            meta.unread ??= `the decorator spreads ${shown(property)}`
            continue
          }
          const key = property.key?.name ?? property.key?.value
          if (key === "templateUrl") {
            templateUrl = true
            meta.templateUrl = stringOf(property.value)
          } else if (key === "template") {
            // The processor passes an empty template over.
            const value = property.value
            template =
              (typeof value?.value === "string" && value.value !== "") ||
              (value?.type === "TemplateLiteral" &&
                (value.quasis.length > 1 || value.quasis[0]?.value?.raw !== ""))
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
        meta.inline = template && !templateUrl
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
  let entries: string[]
  try {
    entries = memoize(`angular:dir:${dir}:${mtimeOf(dir)}`, () =>
      fs.readdirSync(dir)
    )
  } catch {
    return []
  }
  const out: { file: string; meta: ComponentMeta }[] = []
  for (const entry of entries) {
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
  if (/^(sass:|~|https?:|\/\/)/.test(spec)) return []
  const bases = [path.dirname(from)]
  const bare = !spec.startsWith(".") && !path.isAbsolute(spec)
  if (bare) bases.push(...includes)
  const out = bases.flatMap((base) => candidatesAt(path.resolve(base, spec)))
  return bare ? [...out, ...packageCandidates(from, spec)] : out
}

// A package's own stylesheet is its `sass` or `style` entry, or its index.
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
  if (subpath) return candidatesAt(path.join(dir, subpath))
  const manifest = readJsonc(json)
  const entry = [manifest?.sass, manifest?.style].find(
    (value) => typeof value === "string"
  )
  return [
    ...(entry ? [path.join(dir, entry)] : []),
    ...candidatesAt(path.join(dir, "index")),
  ]
}

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

function stripComments(css: string) {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[\s;{}])\/\/[^\n\r]*/g, "$1")
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

function nest(parents: string[], selector: string) {
  const out: string[] = []
  for (const part of splitSelectors(selector)) {
    for (const parent of parents) {
      out.push(
        part.includes("&")
          ? part.replaceAll("&", parent === "" ? UNKNOWN : parent)
          : parent === "" || parent === UNKNOWN
            ? part
            : `${parent} ${part}`
      )
    }
  }
  return out
}

// A selector as it was written.
const written = (selector: string) =>
  selector.replaceAll(HOLE, "#{…}").replaceAll(UNKNOWN, "&")

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
  for (const match of selector.matchAll(
    new RegExp(`\\.(-?[_a-zA-Z${HOLE}][\\w${HOLE}-]*)`, "g")
  )) {
    const name = match[1]
    const hole = name.indexOf(HOLE)
    if (hole === -1) declared.classes.add(name)
    else if (hole === 0) {
      declared.unread ??= {
        reason: `the selector \`${written(selector)}\` starts with an interpolation`,
        where: file,
      }
    } else declared.prefixes.push(name.slice(0, hole))
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
    for (const name of parseClassSelectors(css)) declared.classes.add(name)
    return
  }
  if (file && /\.(sass|styl)$/i.test(file)) {
    for (const name of parseClassSelectors(css)) declared.classes.add(name)
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
  let prelude = ""
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
      if (parents === null || NOT_SELECTORS.test(head)) parents = null
      else if (OWN_SCOPE.test(head)) parents = [UNKNOWN]
      else if (head.startsWith("@at-root")) {
        const rest = head.slice("@at-root".length).trim()
        parents = rest ? nest([""], rest) : [""]
      } else if (head.startsWith("@")) {
        // @media, @supports, @include's content block, @if, @each: the
        // rule around them is still the rule.
      } else if (/^[\w-]+\s*:/.test(head) && !/^[\w-]+:[\w-]/.test(head)) {
        // Nested properties, `font: { family: x }`.
        parents = null
      } else {
        parents = nest(parents, head)
        for (const selector of parents) addSelector(selector, declared, file)
      }
      prelude = ""
    } else if (c === "}") {
      parents = stack.pop() ?? [""]
      prelude = ""
    } else if (c === ";") {
      const statement = prelude.trim()
      const imported =
        /^@(?:import|use|forward)\s+(.*)$/s.exec(statement) ??
        /^@include\s+(?:[\w-]+\.)?load-css\(\s*(["'][^"']+["'])/.exec(statement)
      if (imported && file) {
        for (const [, spec] of imported[1].matchAll(/["']([^"']+)["']/g)) {
          declareImport(file, spec, declared, reading)
        }
      }
      prelude = ""
    } else {
      prelude += c
    }
  }
}

function declareImport(
  from: string,
  spec: string,
  declared: Declared,
  reading: Reading
) {
  const { seen } = reading
  for (const candidate of importCandidates(from, spec, reading.includes)) {
    const source = read(candidate)
    if (source === null) continue
    if (!seen.has(candidate) && seen.size < 64) {
      seen.add(candidate)
      declareStyles(source, candidate, declared, reading)
    }
    return
  }
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
        declared.unread ??= {
          reason: `the stylesheet ${url} does not exist`,
          where: null,
        }
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
  const key = project.styles.map((style) => style.file ?? style.input)
  const declared = memoize(`angular:global:${key.join("\u0000")}`, () => {
    const declared = declaredNothing()
    const reading = { seen: new Set<string>(), includes: project.includes }
    for (const { input, file, config } of project.styles) {
      const source = file === null ? null : read(file)
      if (file === null || source === null) {
        declared.unread ??= {
          reason: `the stylesheet ${input} does not exist`,
          where: null,
          file: config,
        }
        continue
      }
      const before = declared.unread
      reading.seen.add(file)
      declareStyles(source, file, declared, reading)
      if (!before && declared.unread) declared.unread.file = config
    }
    return declared
  })
  return toOwnClasses(declared)
}

// `template` is the file the linter was handed; `physical` the file on
// disk, a component's .ts when its template is inline. The processor
// names the nth inline template `inline-template-<file>-<n>.component.html`.
export function angularOwnClassesOf(
  template: string,
  physical: string
): OwnClasses {
  const declared = memoize(`angular:own:${template}\u0000${physical}`, () => {
    if (template !== physical && /\.[cm]?ts$/.test(physical)) {
      const metas = componentsIn(physical).filter((meta) => meta.inline)
      const nth = /-(\d+)\.component\.html$/.exec(template)
      const own = nth ? metas[Number(nth[1]) - 1] : undefined
      if (own) return declaredBy(physical, [own])
      return metas.length ? declaredBy(physical, metas) : EMPTY
    }
    const owners = ownersOf(path.resolve(physical))
    if (!owners.length) return EMPTY
    const declared = declaredNothing()
    for (const { file, meta } of owners) {
      const one = declaredBy(file, [meta])
      for (const name of one.classes) declared.classes.add(name)
      declared.prefixes.push(...one.prefixes)
      declared.unread ??= one.unread
    }
    return declared
  })
  return toOwnClasses(declared)
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

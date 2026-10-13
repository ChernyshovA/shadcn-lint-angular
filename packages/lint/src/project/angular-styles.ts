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
// than wrong.

import * as fs from "node:fs"
import * as path from "node:path"

import { memoize, mtimeOf } from "./fs"
import { parseSource } from "./parser"
import { parseClassSelectors } from "./theme"

export type OwnClasses = { has: (name: string) => boolean }

type Declared = { classes: Set<string>; prefixes: string[]; opaque: boolean }

type ComponentMeta = {
  templateUrl: string | null
  inline: boolean
  // Stylesheet paths and inline sources; null when one is not a literal.
  styleUrls: (string | null)[]
  styles: (string | null)[]
}

const EMPTY: Declared = { classes: new Set(), prefixes: [], opaque: false }

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

function stringsOf(node: any): (string | null)[] {
  if (node?.type === "ArrayExpression") {
    return node.elements.map((element: any) => stringOf(element))
  }
  return [stringOf(node)]
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
        const meta: ComponentMeta = {
          templateUrl: null,
          inline: false,
          styleUrls: [],
          styles: [],
        }
        const object = call.arguments?.[0]
        if (object?.type !== "ObjectExpression") {
          meta.styles.push(null)
          out.push(meta)
          continue
        }
        for (const property of object.properties) {
          if (property.type !== "Property") {
            // A spread can carry any of them.
            meta.styles.push(null)
            continue
          }
          const key = property.key?.name ?? property.key?.value
          if (key === "templateUrl") meta.templateUrl = stringOf(property.value)
          else if (key === "template") meta.inline = true
          else if (key === "styleUrl" || key === "styleUrls") {
            meta.styleUrls.push(...stringsOf(property.value))
          } else if (key === "styles")
            meta.styles.push(...stringsOf(property.value))
        }
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

// A Sass or Less import, as the files it may name.
function importCandidates(from: string, spec: string) {
  if (/^(sass:|~|@|https?:|\/\/)/.test(spec)) return []
  const target = path.resolve(path.dirname(from), spec)
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

function addSelector(selector: string, declared: Declared) {
  // `&-header` under a rule this file does not show.
  if (new RegExp(`${UNKNOWN}[\\w-]`).test(selector)) declared.opaque = true
  for (const match of selector.matchAll(
    new RegExp(`\\.(-?[_a-zA-Z${HOLE}][\\w${HOLE}-]*)`, "g")
  )) {
    const name = match[1]
    const hole = name.indexOf(HOLE)
    if (hole === -1) declared.classes.add(name)
    else if (hole === 0) declared.opaque = true
    else declared.prefixes.push(name.slice(0, hole))
  }
}

const NOT_SELECTORS = /^@(?:-\w+-)?(?:keyframes|font-face|page|property)\b/
const OWN_SCOPE = /^@(?:mixin|function)\b/

// The classes CSS, SCSS or Less selects, with nesting and `&` resolved.
// Indented Sass and Stylus are read as flat text.
function declareStyles(
  css: string,
  file: string | null,
  declared: Declared,
  seen: Set<string>
) {
  if (file && /\.(sass|styl)$/i.test(file)) {
    for (const name of parseClassSelectors(css)) declared.classes.add(name)
    if (/&[\w-]|#\{/.test(css)) declared.opaque = true
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
        for (const selector of parents) addSelector(selector, declared)
      }
      prelude = ""
    } else if (c === "}") {
      parents = stack.pop() ?? [""]
      prelude = ""
    } else if (c === ";") {
      const statement = prelude.trim()
      const imported = /^@(?:import|use|forward)\s+(.*)$/s.exec(statement)
      if (imported && file) {
        for (const [, spec] of imported[1].matchAll(/["']([^"']+)["']/g)) {
          declareImport(file, spec, declared, seen)
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
  seen: Set<string>
) {
  for (const candidate of importCandidates(from, spec)) {
    const source = read(candidate)
    if (source === null) continue
    if (!seen.has(candidate) && seen.size < 64) {
      seen.add(candidate)
      declareStyles(source, candidate, declared, seen)
    }
    return
  }
}

function declaredBy(file: string, metas: ComponentMeta[]) {
  const declared: Declared = {
    classes: new Set(),
    prefixes: [],
    opaque: false,
  }
  const seen = new Set<string>()
  for (const meta of metas) {
    for (const url of meta.styleUrls) {
      const sheet = url === null ? null : path.resolve(path.dirname(file), url)
      const source = sheet === null ? null : read(sheet)
      if (sheet === null || source === null) {
        declared.opaque = true
        continue
      }
      seen.add(sheet)
      declareStyles(source, sheet, declared, seen)
    }
    for (const source of meta.styles) {
      if (source === null) declared.opaque = true
      else declareStyles(source, file, declared, seen)
    }
  }
  return declared
}

function toOwnClasses(declared: Declared): OwnClasses {
  return {
    has: (name) =>
      declared.opaque ||
      declared.classes.has(name) ||
      declared.prefixes.some((prefix) => name.startsWith(prefix)),
  }
}

// One stylesheet on its own, imports unread.
export function ownClassesOfCss(css: string, file: string | null = null) {
  const declared: Declared = {
    classes: new Set(),
    prefixes: [],
    opaque: false,
  }
  declareStyles(css, file, declared, new Set())
  return toOwnClasses(declared)
}

// `template` is the file the linter was handed; `physical` the file on
// disk, a component's .ts when its template is inline.
export function angularOwnClassesOf(
  template: string,
  physical: string
): OwnClasses {
  const declared = memoize(`angular:own:${template}\u0000${physical}`, () => {
    if (template !== physical && /\.[cm]?ts$/.test(physical)) {
      const metas = componentsIn(physical).filter((meta) => meta.inline)
      return metas.length ? declaredBy(physical, metas) : EMPTY
    }
    const owners = ownersOf(path.resolve(physical))
    if (!owners.length) return EMPTY
    const declared: Declared = {
      classes: new Set(),
      prefixes: [],
      opaque: false,
    }
    for (const { file, meta } of owners) {
      const one = declaredBy(file, [meta])
      for (const name of one.classes) declared.classes.add(name)
      declared.prefixes.push(...one.prefixes)
      declared.opaque ||= one.opaque
    }
    return declared
  })
  return toOwnClasses(declared)
}

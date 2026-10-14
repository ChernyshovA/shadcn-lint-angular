import { isSfc } from "../../project/parser"
import { warnOnce } from "../../project/warn"
import { fileOf } from "../../rules/messages"
import { angularReader } from "./angular"
import { isAngularCode } from "./angular-code"
import { recordFile } from "./angular-compiler"
import { withHostBindings } from "./angular-host"
import { jsxReader } from "./jsx"
import { svelteReader } from "./svelte"
import type { TemplateReader, Visitors } from "./types"
import { vueReader } from "./vue"

export type { ElementName, ExtraSite, TemplateReader, Visitors } from "./types"

// A script file that imports Angular can declare a component, whose host
// bindings are a template of their own.
const scriptReader = withHostBindings(jsxReader)

const readers = [scriptReader, svelteReader, vueReader, angularReader]

// The parser decides: each template language has its own node types, so
// a reader only ever meets the nodes it was written for.
export function readerFor(context: any) {
  const services = context?.sourceCode?.parserServices
  if (services?.isSvelte) return svelteReader
  if (typeof services?.defineTemplateBodyVisitor === "function") {
    return vueReader
  }
  if (typeof services?.convertElementSourceSpanToLoc === "function") {
    return angularReader
  }
  return isAngularCode(context) ? scriptReader : jsxReader
}

// Whether this class attribute takes an object with classes as keys.
// Elsewhere an object is a classNames map, its values the classes.
export function keysClasses(
  reader: TemplateReader,
  attribute: any,
  name: string | null
) {
  const { classObjects } = reader
  if (name === null) return false
  return typeof classObjects === "function"
    ? classObjects(attribute, name)
    : classObjects === true && name === "class"
}

// Whether a string at this value is CSS text.
export function readsStyleText(reader: TemplateReader, value: any) {
  const { staticStyles } = reader
  return typeof staticStyles === "function"
    ? staticStyles(value)
    : staticStyles === true
}

// The node that wraps an expression in an attribute, by the attribute
// type that holds it.
const CONTAINERS: Record<string, string> = {
  JSXExpressionContainer: "JSXAttribute",
  SvelteMustacheTag: "SvelteAttribute",
  VExpressionContainer: "VAttribute",
}

const LITERALS = new Set([
  "Literal",
  "SvelteLiteral",
  "VLiteral",
  "AngularLiteral",
])

// One node type can carry two roles (Vue's VAttribute is an attribute
// and a spread), so a second visitor joins the first.
export function addVisitor(
  visitors: Visitors,
  type: string,
  visit: (node: any) => void
) {
  const existing = visitors[type]
  visitors[type] = existing
    ? (node) => {
        existing(node)
        visit(node)
      }
    : visit
}

export function isContainer(node: any) {
  return typeof node?.type === "string" && node.type in CONTAINERS
}

// The attribute an expression container is the value of. Svelte's
// `{className}` has no container: the attribute holds the identifier.
export function attributeOfContainer(container: any) {
  if (container?.type === "SvelteShorthandAttribute") return container
  const attribute = container?.parent
  return attribute && CONTAINERS[container.type] === attribute.type
    ? attribute
    : null
}

export function attributeNameIn(attribute: any) {
  const reader = readers.find((r) => r.attributes.includes(attribute?.type))
  return reader ? reader.attributeName(attribute) : ""
}

// A class or style string as the markup spells it.
export function isMarkupLiteral(node: any) {
  return node?.type !== "Literal" && LITERALS.has(node?.type)
}

// A string written in the attribute, bare or inside a container.
export function staticStringOf(value: any) {
  const node = isContainer(value) ? value.expression : value
  return LITERALS.has(node?.type) && typeof node.value === "string"
    ? (node.value as string)
    : null
}

// A node the traversal reaches twice is still one attribute.
function once(visitors: Visitors, reader: TemplateReader): Visitors {
  if (!reader.revisited?.some((type) => visitors[type])) return visitors
  const out = { ...visitors }
  const seen = new WeakSet<object>()
  for (const type of reader.revisited) {
    const visit = visitors[type]
    if (!visit) continue
    out[type] = (node) => {
      if (seen.has(node)) return
      seen.add(node)
      visit(node)
    }
  }
  return out
}

// What every rule's visitors go through before the linter gets them.
//
// Vue's template visitors only run when they are registered through the
// parser. The same handlers serve both halves: a node type belongs to
// one half or the other, and a call or a string can sit in either. The
// parser writes its trigger onto the script half, so each half gets an
// object of its own.
//
// A .svelte or .vue file that arrives without its framework's parser has
// only its script blocks in the AST (Oxlint does this). Passing quietly
// would read as "checked", so it says so once. Oxlint parses no Angular
// template either, .html or inline, and names its parser "oxlint".
const ANGULAR_COMPONENT = /@Component\s*\(/

export function withTemplates<T extends { create: (context: any) => any }>(
  rule: T
) {
  return {
    ...rule,
    create(context: any) {
      recordFile(context.sourceCode?.ast, fileOf(context))
      const visitors = once(rule.create(context), readerFor(context))
      const services = context.sourceCode?.parserServices
      const define = services?.defineTemplateBodyVisitor
      if (typeof define === "function") {
        return define({ ...visitors }, { ...visitors })
      }
      if (!services?.isSvelte && isSfc(fileOf(context) ?? "")) {
        warnOnce(
          "templates:unread",
          "Templates in .svelte and .vue files are read under ESLint with svelte-eslint-parser or vue-eslint-parser. This run has no template parser, so only their script blocks are linted. See https://github.com/shadcn-ui/lint/blob/main/docs/vue.md and https://github.com/shadcn-ui/lint/blob/main/docs/svelte.md."
        )
      }
      if (
        context.languageOptions?.parser?.name === "oxlint" &&
        isAngularCode(context) &&
        ANGULAR_COMPONENT.test(context.sourceCode?.text ?? "")
      ) {
        warnOnce(
          "templates:angular",
          "Angular templates, .html files and inline template strings, are read under ESLint with @angular-eslint/template-parser. Oxlint does not parse them, so in component files only host bindings and class helpers are linted."
        )
      }
      return visitors
    },
  }
}

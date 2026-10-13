// @angular-eslint/template-parser hands over the Angular compiler's own
// template AST, each node typed by its class: Element, TextAttribute,
// BoundAttribute. A static `class="p-4"` is a TextAttribute holding the
// decoded text and the spans it was read from. A binding, `[class]` or
// `class="{{ x }}"`, is a BoundAttribute, and this reader does not read it.

import type { TemplateReader } from "./types"

const literals = new WeakMap<object, any>()

// An inline template written as a template string with `${x}` reaches
// the parser as source text: the interpolation is JavaScript the
// processor does not run. It and the token glued to it are blanked to
// spaces of the same length, so what is read is what is written out and
// every offset stays where it was, the way a glued interpolation in a JSX
// template literal leaves no class of its own.
function withoutInterpolations(value: string) {
  if (!value.includes("${")) return value
  let out = ""
  let i = 0
  while (i < value.length) {
    const start = value.indexOf("${", i)
    if (start === -1) {
      out += value.slice(i)
      break
    }
    let end = start + 2
    let depth = 1
    while (end < value.length && depth > 0) {
      const c = value[end]
      if (c === "{") depth++
      else if (c === "}") depth--
      else if (c === '"' || c === "'" || c === "`") {
        const close = value.indexOf(c, end + 1)
        if (close !== -1) end = close
      }
      end++
    }
    const before = value
      .slice(i, start)
      .replace(/\S+$/, (m) => " ".repeat(m.length))
    // Up to the next interpolation, which the next round blanks.
    const tail = /^\S*/.exec(value.slice(end))![0]
    const next = tail.indexOf("${")
    const glued = next === -1 ? tail.length : next
    out += before + " ".repeat(end - start + glued)
    i = end + glued
  }
  return out
}

// The value as a literal over its quotes, where JSX and Vue place theirs.
// Lines and columns are the parser's own count, so a finding lines up
// with its nodes and its comments. Built once per attribute so every rule
// sees one node.
function literalOf(attribute: any) {
  const span = attribute?.valueSpan
  if (!span) return null
  let literal = literals.get(attribute)
  if (literal) return literal
  // `start` skips the whitespace a value opens with; `fullStart` is where
  // the value begins.
  const start = span.fullStart ?? span.start
  const end = span.end
  const text: string = start.file?.content ?? ""
  const quote = text[start.offset - 1]
  const quoted = (quote === '"' || quote === "'") && text[end.offset] === quote
  const pad = quoted ? 1 : 0
  literal = {
    type: "AngularLiteral",
    value: withoutInterpolations(attribute.value),
    range: [start.offset - pad, end.offset + pad],
    loc: {
      start: { line: start.line + 1, column: start.col - pad },
      end: { line: end.line + 1, column: end.col + pad },
    },
    parent: attribute,
  }
  literals.set(attribute, literal)
  return literal
}

// The compiler names a <path> inside an <svg> `:svg:path`.
function tagOf(element: any) {
  const name = element?.name
  return typeof name === "string" ? name.replace(/^:[^:]*:/, "") : ""
}

export const angularReader: TemplateReader = {
  attributes: ["TextAttribute"],
  // The router adds these classes while the link is active.
  classAttributes: ["routerLinkActive"],
  // PrimeNG's StyleClass takes the element it toggles classes on:
  // `pStyleClass="@next"`. Its enterActiveClass and the rest are classes.
  notClassAttributes: ["pStyleClass"],
  spreads: [],
  staticStyles: true,
  attributeName: (node) => (typeof node?.name === "string" ? node.name : ""),
  attributeValue: literalOf,
  spreadArgument: () => null,
  // A structural directive's own attributes (`*ngFor="let x of xs"`) sit
  // on the template it creates, which is no element.
  elementOf(node) {
    const element = node?.parent
    return element?.type === "Element" ? element : null
  },
  // A custom element is a component. Its selector decides which one, so
  // the tag is not turned into a class name the way Vue's <card-title> is,
  // and <Card> is not the Card a .tsx file imports: HTML reads a tag in
  // any case, and the lowercase name resolves to no component.
  nameOf(element) {
    const text = tagOf(element)
    if (!text) return null
    return {
      root: text.toLowerCase(),
      property: null,
      text,
      component: text.includes("-"),
    }
  },
  // <ng-container> renders nothing of its own; <ng-template> and blocks
  // are not elements.
  parentElementOf(element) {
    for (let node = element?.parent; node; node = node.parent) {
      if (node.type === "Element" && node.name !== "ng-container") return node
    }
    return null
  },
}

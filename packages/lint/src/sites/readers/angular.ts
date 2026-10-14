// @angular-eslint/template-parser hands over the Angular compiler's own
// template AST, each node typed by its class: Element, TextAttribute,
// BoundAttribute. A static `class="p-4"` is a TextAttribute holding the
// decoded text and the spans it was read from. A binding, `[class]` or
// `class="{{ x }}"`, is a BoundAttribute whose value is an expression,
// read through `estreeOf`.

import { angularCompiler } from "./angular-compiler"
import {
  classNameNode,
  estreeOf,
  lineCounter,
  styleObjectNode,
  type ExpressionSource,
} from "./angular-expressions"
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

const sources = new WeakMap<object, ExpressionSource>()

// Template spans are offsets into the file the parser read.
function fileSourceOf(file: any): ExpressionSource {
  let source = sources.get(file)
  if (!source) {
    source = {
      text: file.content,
      base: 0,
      at: (offset) => offset,
      loc: lineCounter(file.content),
    }
    sources.set(file, source)
  }
  return source
}

const entities = new Map<string, string | null>()

// What the parser decodes a named entity to, asked of the compiler.
function namedEntity(entity: string, file: string) {
  if (entities.has(entity)) return entities.get(entity)!
  let value: string | null = null
  try {
    const angular = angularCompiler(file)
    const { rootNodes, errors } = new angular.HtmlParser().parse(
      `<a b="${entity}"></a>`,
      "",
      {}
    )
    if (!errors.length) value = rootNodes[0]?.attrs?.[0]?.value ?? null
  } catch {
    // No compiler: the value is placed as a whole.
  }
  entities.set(entity, value)
  return value
}

// An attribute value as the parser decodes it, and for each character
// the offset in `raw` it was read from, with one more for the end. Line
// endings stay as written. Null for an entity this cannot decode.
function decode(raw: string, file: string) {
  let text = ""
  const at: number[] = []
  let i = 0
  while (i < raw.length) {
    let value = raw[i]
    let length = 1
    if (value === "&") {
      const entity =
        /^&(?:#[xX]([0-9a-fA-F]+)|#(\d+)|[A-Za-z][A-Za-z0-9]*);/.exec(
          raw.slice(i, i + 64)
        )
      if (entity) {
        const [written, hex, decimal] = entity
        let decoded: string | null = null
        try {
          decoded =
            hex || decimal
              ? String.fromCodePoint(parseInt(hex ?? decimal, hex ? 16 : 10))
              : namedEntity(written, file)
        } catch {
          // Past the last code point.
        }
        if (decoded === null) return null
        value = decoded
        length = written.length
      }
    }
    text += value
    for (let k = 0; k < value.length; k++) at.push(i)
    i += length
  }
  at.push(raw.length)
  return { text, at }
}

// The parser reads a binding from its value with entities decoded, and
// its spans count that text from where the value starts. Where the file spells the value
// otherwise, its offsets are mapped back through the decoding; a value
// this cannot decode as the parser did is placed as a whole.
function sourceOf(attribute: any): ExpressionSource | null {
  const file = attribute?.sourceSpan?.start?.file
  if (typeof file?.content !== "string") return null
  const source = fileSourceOf(file)
  const span = attribute.valueSpan
  const decoded = attribute.value?.source
  if (!span || typeof decoded !== "string") return source
  const from: number = (span.fullStart ?? span.start).offset
  const to: number = span.end.offset
  const raw: string = file.content.slice(from, to)
  if (raw === decoded) return source
  const decoding = decode(raw, file.url ?? "")
  if (
    decoding?.text !== decoded ||
    attribute.value.sourceSpan?.start !== from
  ) {
    return { ...source, whole: [from, to] }
  }
  const { at } = decoding
  return {
    ...source,
    at: (offset) =>
      from + at[Math.max(0, Math.min(offset - from, at.length - 1))],
    decoded: { text: decoded, from },
  }
}

// The binding as written between the brackets: `class.active`,
// `style.width.px`, `attr.fill`. The parser keeps the compiler's binding
// kind out of reach, since `type` is the node's class name.
function keyOf(attribute: any): string {
  const key = attribute?.keySpan
  const text: string = key?.start?.file?.content ?? ""
  return key && text
    ? text.slice(key.start.offset, key.end.offset).replace(/^bind-/, "")
    : (attribute?.name ?? "")
}

// What a binding sets, under the attribute name a static one would have:
// `[ngClass]` and `[class.x]` set classes, `[ngStyle]` and `[style.x]`
// a style, `[attr.fill]` the attribute.
function bindingName(attribute: any) {
  const key = keyOf(attribute)
  if (key.startsWith("class.") || key === "ngClass") return "class"
  if (key.startsWith("style.") || key === "ngStyle") return "style"
  if (key.startsWith("attr.")) return key.slice(5)
  return typeof attribute?.name === "string" ? attribute.name : ""
}

const values = new WeakMap<object, any>()

// NgStyle reads `'width.px': w` as the width in pixels. `[style]` takes a
// key whole, as the property it names.
function withoutUnits(node: any): any {
  if (node?.type === "ConditionalExpression") {
    withoutUnits(node.consequent)
    withoutUnits(node.alternate)
  } else if (node?.type === "LogicalExpression") {
    withoutUnits(node.left)
    withoutUnits(node.right)
  } else if (node?.type === "ObjectExpression") {
    for (const { key } of node.properties) {
      if (key?.type === "Literal" && typeof key.value === "string") {
        key.value = key.value.split(".")[0]
      }
    }
  }
  return node
}

// `[class.active]="on"` adds the class its key names; `[style.color]="c"`
// is the style object `{ color: c }`. Everything else is its expression.
function bindingValue(attribute: any) {
  if (values.has(attribute)) return values.get(attribute)
  const source = sourceOf(attribute)
  let value: any = null
  if (source && attribute.value) {
    const key = keyOf(attribute)
    const start = attribute.keySpan?.start?.offset
    if (key.startsWith("class.") && typeof start === "number") {
      value = classNameNode(
        key.slice("class.".length),
        start + "class.".length,
        start + key.length,
        source,
        attribute
      )
    } else if (key.startsWith("style.") && typeof start === "number") {
      const property = key.slice("style.".length).split(".")[0]
      const from = start + "style.".length
      value = styleObjectNode(
        property,
        from,
        from + property.length,
        source,
        attribute,
        (owner) =>
          estreeOf(attribute.value, source, owner, withoutInterpolations)
      )
    } else {
      value = estreeOf(
        attribute.value,
        source,
        attribute,
        withoutInterpolations
      )
      if (key === "ngStyle") withoutUnits(value)
    }
  }
  values.set(attribute, value)
  return value
}

// A structural directive's template copies the element's bindings into
// its own inputs: the same node, reached twice, with the template as its
// parent.
function elementOfBinding(attribute: any) {
  const parent = attribute?.parent
  if (parent?.type === "Element") return parent
  if (parent?.type !== "Template") return null
  if (parent.templateAttrs?.includes(attribute)) return null
  return (
    parent.children?.find(
      (child: any) =>
        child?.type === "Element" && child.inputs?.includes(attribute)
    ) ?? null
  )
}

// The compiler names a <path> inside an <svg> `:svg:path`.
function tagOf(element: any) {
  const name = element?.name
  return typeof name === "string" ? name.replace(/^:[^:]*:/, "") : ""
}

export type ElementSelector = {
  tag: string
  // Each attribute with its value, a binding or an event with "", in the
  // order the template writes them.
  attributes: [string, string][]
  // Those a contract can name the element by, past the events the
  // compiler matches too that are not the element's own.
  names: string[]
}

// Bindings no directive selector matches.
const NOT_SELECTED = /^(?:class\.|style\.|attr\.|animate\.)/

// `[@fade]`: the key the parser spans starts past the `@`.
function isAnimation(binding: any) {
  const key = binding?.keySpan?.start
  return key?.file?.content?.[key.offset - 1] === "@"
}

const selectors = new WeakMap<object, ElementSelector>()

// What Angular matches a directive's selector against: the tag, each
// static attribute (the parser keeps i18n's out), each property or
// two-way binding and each event, by the names the template writes.
export function selectorOf(element: any): ElementSelector | null {
  if (element?.type !== "Element") return null
  let selector = selectors.get(element)
  if (selector) return selector
  const written: { at: number; name: string; value: string; own: boolean }[] =
    []
  const at = (node: any) => node?.sourceSpan?.start?.offset ?? 0
  for (const attribute of element.attributes ?? []) {
    if (typeof attribute?.name !== "string") continue
    written.push({
      at: at(attribute),
      name: attribute.name,
      value: typeof attribute.value === "string" ? attribute.value : "",
      own: true,
    })
  }
  for (const input of element.inputs ?? []) {
    if (typeof input?.name !== "string") continue
    if (NOT_SELECTED.test(keyOf(input)) || isAnimation(input)) continue
    written.push({ at: at(input), name: input.name, value: "", own: true })
  }
  // Every event, the way the compiler matches them, though an animation's
  // (`(@fade.done)`, `(animate.leave)`) and one on window, document or
  // body are not the element's own.
  for (const output of element.outputs ?? []) {
    if (typeof output?.name !== "string") continue
    written.push({
      at: at(output),
      name: output.name,
      value: "",
      own:
        !output.target &&
        !isAnimation(output) &&
        !NOT_SELECTED.test(keyOf(output)),
    })
  }
  // Stable: a two-way binding's input stays before its event.
  written.sort((a, b) => a.at - b.at)
  selector = {
    tag: tagOf(element),
    attributes: written.map(({ name, value }) => [name, value]),
    names: written.flatMap(({ name, own }) => (own ? [name] : [])),
  }
  selectors.set(element, selector)
  return selector
}

// The names a contract can match on an element: its tag, then its
// attributes, bindings and events, without the class and style the
// classes are written in. An <ng-container> renders no element to wear
// a class.
export function contractNamesOf(element: any) {
  const selector = selectorOf(element)
  if (!selector?.tag || selector.tag === "ng-container") return null
  const names = new Set([selector.tag])
  for (const name of selector.names) {
    if (name !== "class" && name !== "style") names.add(name)
  }
  return [...names]
}

export const angularReader: TemplateReader = {
  attributes: ["TextAttribute", "BoundAttribute"],
  revisited: ["BoundAttribute"],
  // The router adds these classes while the link is active.
  classAttributes: ["routerLinkActive"],
  // PrimeNG's StyleClass takes the element it toggles classes on:
  // `pStyleClass="@next"`. Its enterActiveClass and the rest are classes.
  notClassAttributes: ["pStyleClass"],
  spreads: [],
  // `[class]` and `[ngClass]` take an object with classes as keys, and
  // so does an input such as Material's `[panelClass]`, which hands it on
  // to them.
  classObjects: (node, name) =>
    name === "class" || node?.type === "BoundAttribute",
  staticStyles: true,
  attributeName(node) {
    if (node?.type === "BoundAttribute") return bindingName(node)
    return typeof node?.name === "string" ? node.name : ""
  },
  attributeValue: (node) =>
    node?.type === "BoundAttribute" ? bindingValue(node) : literalOf(node),
  spreadArgument: () => null,
  // A structural directive's own attributes (`*ngFor="let x of xs"`) sit
  // on the template it creates, which is no element.
  elementOf(node) {
    if (node?.type === "BoundAttribute") return elementOfBinding(node)
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
  contractNames: contractNamesOf,
}

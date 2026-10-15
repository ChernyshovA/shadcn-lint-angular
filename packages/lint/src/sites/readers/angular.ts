// @angular-eslint/template-parser hands over the Angular compiler's own
// template AST: a static `class` is a TextAttribute, a binding (`[class]`,
// `class="{{ x }}"`) a BoundAttribute whose value is an expression.

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

// An inline template written with `${x}` reaches the parser as source
// text. The interpolation and the token glued to it (no class, as in a JSX
// template literal) are blanked to spaces, so every offset stays put.
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

// The value as a literal over its quotes, where JSX and Vue place theirs,
// built once so every rule sees one node. Lines and columns are the
// parser's own count, so a finding lines up with its nodes and comments.
function literalOf(attribute: any) {
  const span = attribute?.valueSpan
  if (!span) return null
  let literal = literals.get(attribute)
  if (literal) return literal
  // `start` skips leading whitespace; `fullStart` is where the value begins.
  const start = span.fullStart ?? span.start
  const end = span.end
  const text: string = start.file?.content ?? ""
  const quote = text[start.offset - 1]
  const quoted = (quote === '"' || quote === "'") && text[end.offset] === quote
  const pad = quoted ? 1 : 0
  const value = withoutInterpolations(attribute.value)
  literal = {
    type: "AngularLiteral",
    value,
    masked: value !== attribute.value || attribute.masked === true,
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

// The parser's spans count a binding's text with entities decoded. Where
// the file spells it otherwise, offsets map back through the decoding; a
// value not decoded as the parser did is placed as a whole.
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

// The key as written (`class.active`, `style.width.px`): the parser hides
// the compiler's binding kind, since `type` is the node's class name.
function keyOf(attribute: any): string {
  const key = attribute?.keySpan
  const text: string = key?.start?.file?.content ?? ""
  return key && text
    ? text.slice(key.start.offset, key.end.offset).replace(/^bind-/, "")
    : (attribute?.name ?? "")
}

// A binding under the name of the static attribute it sets. `[className]`
// is the property the class attribute reflects.
function bindingName(attribute: any) {
  const key = keyOf(attribute)
  if (key.startsWith("class.") || key === "ngClass" || key === "className")
    return "class"
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

// `[class.a]` is the class `a`; `[style.color]="c"` is `{ color: c }`.
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
      // `[style.]` names no property, and sets none.
      const property = key.slice("style.".length).split(".")[0]
      if (!property) {
        values.set(attribute, null)
        return null
      }
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
// its inputs: the same node, reached twice, with the template as parent.
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
  // In the order written; a binding or an event has the value "".
  attributes: [string, string][]
  // Those a contract can name the element by: events not its own left out.
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

// What Angular matches a directive's selector against: the tag, static
// attributes (the parser keeps i18n's out), bindings and events, by their
// written names. An element in an ICU is matched by none.
export function selectorOf(element: any): ElementSelector | null {
  if (element?.type !== "Element" || element.icu) return null
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
  // The compiler matches every event, though an animation's (`(@fade.done)`,
  // `(animate.leave)`) or one on window, document or body is not the
  // element's own.
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

// The names a contract can match: the tag, then the selector's names less
// class and style. An <ng-container> renders no element to wear a class.
function contractNamesOf(element: any) {
  const selector = selectorOf(element)
  if (!selector?.tag || selector.tag === "ng-container") return null
  const names = new Set([selector.tag])
  for (const name of selector.names) {
    if (name !== "class" && name !== "style") names.add(name)
  }
  return [...names]
}

// Where an interpolation from `from` ends, as the compiler's expression
// parser finds it: the first `}}` outside a string, or past a `//` comment
// the next `}}`. -1 for one that never ends, which is text.
function interpolationEnd(value: string, from: number) {
  let quote: string | null = null
  let escapes = 0
  for (let i = from; i < value.length; i++) {
    const c = value[i]
    if (
      (c === "'" || c === '"' || c === "`") &&
      (quote === null || quote === c) &&
      escapes % 2 === 0
    ) {
      quote = quote === null ? c : null
    } else if (quote === null) {
      if (value.startsWith("}}", i)) return i
      if (value.startsWith("//", i)) return value.indexOf("}}", i)
    }
    escapes = c === "\\" ? escapes + 1 : 0
  }
  return -1
}

// `{{ x }}` in an ICU element's attribute, and the token glued to it,
// blanked to spaces: what the i18n runtime binds is no class written out.
function withoutBindings(value: string) {
  // UTF-16 units, as the offsets count them.
  const out = value.split("")
  for (let at = value.indexOf("{{"); at !== -1;) {
    const end = interpolationEnd(value, at + 2)
    if (end === -1) break
    let start = at
    while (start > 0 && /\S/.test(value[start - 1])) start--
    let stop = end + 2
    while (stop < value.length && /\S/.test(value[stop])) stop++
    out.fill(" ", start, stop)
    at = value.indexOf("{{", end + 2)
  }
  return out.join("")
}

const tagSet = (tags: string) => new Set(tags.split(","))

// The elements and attributes Angular's i18n runtime creates in an ICU
// case (walkIcuTree in @angular/core: VALID_ELEMENTS, VALID_ATTRS, the same
// in 19 to 22). Any other element is dropped with all it holds, any other
// attribute alone: <svg>, a custom element, `style`, a binding, an event.
const ICU_ELEMENTS = tagSet(
  "a,abbr,acronym,address,area,article,aside,audio,b,bdi,bdo,big,blockquote,br,caption,center,cite,code,col,colgroup,dd,del,details,dfn,dialog,dir,div,dl,dt,em,figcaption,figure,font,footer,h1,h2,h3,h4,h5,h6,header,hgroup,hr,i,img,ins,kbd,label,li,main,map,mark,menu,nav,ol,p,picture,pre,q,rp,rt,ruby,s,samp,section,small,source,span,strike,strong,sub,summary,sup,table,tbody,td,tfoot,th,thead,time,tr,track,tt,u,ul,var,video,wbr"
)
// The runtime parses a case as a document body (getInertBodyElement in
// @angular/core): these tags outside a <table> go, their content stays.
const TABLE_PARTS = tagSet("caption,col,colgroup,tbody,td,tfoot,th,thead,tr")

const ICU_ATTRIBUTES = tagSet(
  "abbr,accesskey,align,alt,aria-activedescendant,aria-atomic,aria-autocomplete,aria-busy,aria-checked,aria-colcount,aria-colindex,aria-colspan,aria-controls,aria-current,aria-describedby,aria-details,aria-disabled,aria-dropeffect,aria-errormessage,aria-expanded,aria-flowto,aria-grabbed,aria-haspopup,aria-hidden,aria-invalid,aria-keyshortcuts,aria-label,aria-labelledby,aria-level,aria-live,aria-modal,aria-multiline,aria-multiselectable,aria-orientation,aria-owns,aria-placeholder,aria-posinset,aria-pressed,aria-readonly,aria-relevant,aria-required,aria-roledescription,aria-rowcount,aria-rowindex,aria-rowspan,aria-selected,aria-setsize,aria-sort,aria-valuemax,aria-valuemin,aria-valuenow,aria-valuetext,autoplay,axis,background,bgcolor,border,cellpadding,cellspacing,cite,class,clear,color,cols,colspan,compact,controls,coords,datetime,default,dir,download,face,headers,height,hidden,href,hreflang,hspace,ismap,itemprop,itemscope,itemtype,kind,label,lang,language,longdesc,loop,media,muted,nohref,nowrap,open,poster,preload,rel,rev,role,rows,rowspan,rules,scope,scrolling,shape,size,sizes,span,src,srclang,srcset,start,summary,tabindex,target,title,translate,type,usemap,valign,value,vspace,width,xlink:href"
)

const held = new WeakMap<object, any[]>()

// Where a node of the compiler's HTML AST sits, as ESLint places the
// parser's own: lines from 1, columns and offsets from 0.
function placed(span: any) {
  return {
    range: [span.start.offset, span.end.offset],
    loc: {
      start: { line: span.start.line + 1, column: span.start.col },
      end: { line: span.end.line + 1, column: span.end.col },
    },
  }
}

// The attributes of elements in an ICU's cases (`{n, plural, =0
// {<span class="…">}}`), nested ICUs too. The parser keeps those elements
// only as text in the i18n message, so the compiler's HTML parser reads
// the ICU's span again, in the file's offsets. The runtime creates them
// with static attributes, named in lowercase as the browser parses them.
function icuAttributes(icu: any): any[] {
  let out = held.get(icu)
  if (out) return out
  out = []
  held.set(icu, out)
  const span = icu?.sourceSpan
  const file = span?.start?.file
  if (typeof file?.content !== "string") return out
  const angular = angularCompiler(file.url ?? "")
  if (!angular?.HtmlParser) return out
  let parsed: any
  try {
    parsed = new angular.HtmlParser().parse(file.content, file.url ?? "", {
      tokenizeExpansionForms: true,
      tokenizeBlocks: true,
      tokenizeLet: true,
      preserveLineEndings: true,
      range: {
        startPos: span.start.offset,
        startLine: span.start.line,
        startCol: span.start.col,
        endPos: span.end.offset,
      },
    })
  } catch {
    return out
  }
  if (parsed?.errors?.length) return out
  const attributes = out
  const visit = (nodes: any[], parent: any, table = false) => {
    for (const node of nodes ?? []) {
      if (Array.isArray(node?.cases)) {
        for (const branch of node.cases) visit(branch.expression, parent)
      } else if (typeof node?.name === "string" && Array.isArray(node.attrs)) {
        const tag = node.name.toLowerCase()
        if (!ICU_ELEMENTS.has(tag)) continue
        if (!table && TABLE_PARTS.has(tag)) {
          visit(node.children, parent, table)
          continue
        }
        const element = {
          type: "Element",
          icu: true,
          name: node.name,
          attributes: [] as any[],
          inputs: [],
          outputs: [],
          sourceSpan: node.sourceSpan,
          ...placed(node.sourceSpan),
          parent,
        }
        for (const attr of node.attrs) {
          const name = String(attr?.name ?? "").toLowerCase()
          if (!ICU_ATTRIBUTES.has(name)) continue
          const written = attr.value ?? ""
          const value = withoutBindings(written)
          const attribute = {
            type: "TextAttribute",
            name,
            value,
            masked: value !== written,
            sourceSpan: attr.sourceSpan,
            keySpan: attr.keySpan,
            valueSpan: attr.valueSpan,
            ...placed(attr.sourceSpan),
            parent: element,
          }
          element.attributes.push(attribute)
          attributes.push(attribute)
        }
        visit(node.children, element, table || tag === "table")
      } else if (Array.isArray(node?.children)) {
        // A block: `@if` in a case.
        visit(node.children, parent, table)
      }
    }
  }
  visit(parsed?.rootNodes, icu)
  return out
}

export const angularReader: TemplateReader = {
  attributes: ["TextAttribute", "BoundAttribute"],
  heldAttributes: { Icu: icuAttributes },
  revisited: ["BoundAttribute"],
  // The router adds these classes while the link is active.
  classAttributes: ["routerLinkActive"],
  // PrimeNG's StyleClass takes the element it toggles classes on:
  // `pStyleClass="@next"`. Its enterActiveClass and the rest are classes.
  notClassAttributes: ["pStyleClass"],
  spreads: [],
  // `[class]`, `[ngClass]` and inputs such as Material's `[panelClass]`,
  // which hand it on to them, take an object with classes as keys.
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
  // A custom element is a component its selector names, not an import: the
  // tag is not made a class name as Vue's <card-title> is, and the root is
  // lowercased, as HTML reads a tag, so <Card> resolves to no import.
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

// An Angular binding's value is the compiler's own expression AST:
// LiteralPrimitive, Conditional, LiteralMap. The walker and the style
// rules already read the ESTree shapes those mean, so the few that carry
// classes or styles become ESTree nodes, placed in the source, and every
// other expression becomes one opaque node the walker reports as
// unreadable, the way it treats a call it does not know.
//
// The template parser hands the AST over already parsed, and a `host`
// binding parses to the same types, so one adapter serves both. The
// nodes are built once per expression: every rule sees the same ones.

export type ExpressionSource = {
  // The file's text from `base` on: all of it for a template, the string
  // literal for a host binding.
  text: string
  base: number
  // A span offset of the expression to an offset in the file.
  at: (offset: number) => number
  // An offset in the file to ESLint's line and column.
  loc: (offset: number) => { line: number; column: number }
  // The text the parser read, decoded from the file's from `from` on,
  // when the two differ. `at` follows the decoding, but an
  // interpolation's spans do not.
  decoded?: { text: string; from: number }
  // A value that cannot be placed: every node spans all of it, and none
  // offers a rewrite.
  whole?: [number, number]
}

const placed = (
  node: any,
  from: number,
  to: number,
  source: ExpressionSource,
  parent: any
) => {
  node.range = [from, to]
  node.loc = { start: source.loc(from), end: source.loc(to) }
  node.parent = parent
  return node
}

// `[class.active]="on"` adds the class its key names, from `from` to `to`
// in the file.
export function classNameNode(
  name: string,
  from: number,
  to: number,
  source: ExpressionSource,
  parent: any
) {
  return placed(
    { type: "AngularLiteral", value: name },
    from,
    to,
    source,
    parent
  )
}

// `[style.color]="c"` is the style object `{ color: c }`, placed on the
// property name in the key.
export function styleObjectNode(
  property: string,
  from: number,
  to: number,
  source: ExpressionSource,
  parent: any,
  valueOf: (owner: any) => any
) {
  const object = placed({ type: "ObjectExpression" }, from, to, source, parent)
  const entry = placed(
    {
      type: "Property",
      kind: "init",
      computed: false,
      method: false,
      shorthand: false,
    },
    from,
    to,
    source,
    object
  )
  entry.key = placed(
    { type: "Literal", value: property, raw: property },
    from,
    to,
    source,
    entry
  )
  entry.value = valueOf(entry)
  object.properties = [entry]
  return object
}

const converted = new WeakMap<object, any>()

// The node's own class name: the template parser writes it into `type`,
// and an expression parsed outside it keeps the compiler's (a pipe's
// `type` is a number).
function kindOf(ast: any): string {
  return typeof ast?.type === "string"
    ? ast.type
    : (ast?.constructor?.name ?? "")
}

// Lines and columns as the template parser counts them, for nodes it
// did not place.
export function lineCounter(text: string) {
  const starts = [0]
  for (let i = text.indexOf("\n"); i !== -1; i = text.indexOf("\n", i + 1)) {
    starts.push(i + 1)
  }
  return (offset: number) => {
    let low = 0
    let high = starts.length - 1
    while (low < high) {
      const mid = (low + high + 1) >> 1
      if (starts[mid] <= offset) low = mid
      else high = mid - 1
    }
    return { line: low + 1, column: offset - starts[low] }
  }
}

export function estreeOf(
  ast: any,
  source: ExpressionSource,
  parent: any,
  clean: (value: string) => string = (value) => value
): any {
  if (!ast) return null
  const cached = converted.get(ast)
  if (cached) return cached

  const { whole } = source
  const place = (node: any, start: number, end: number, owner: any) =>
    whole
      ? placed(node, whole[0], whole[1], source, owner)
      : placed(node, source.at(start), source.at(end), source, owner)
  const spanned = (node: any, of: any, owner: any) =>
    place(node, of.sourceSpan.start, of.sourceSpan.end, owner)
  const literal = (value: unknown, of: any, owner: any) => {
    const node = spanned({ type: "Literal", value }, of, owner)
    node.raw = whole
      ? ""
      : source.text.slice(
          node.range[0] - source.base,
          node.range[1] - source.base
        )
    return node
  }
  const opaque = (of: any, owner: any) =>
    spanned({ type: "AngularExpression", expression: of }, of, owner)

  const convert = (ast: any, owner: any): any => {
    switch (kindOf(ast)) {
      case "ASTWithSource":
        return convert(ast.ast, owner)
      case "ParenthesizedExpression":
        return convert(ast.expression, owner)
      // `[class]=""` binds nothing.
      case "EmptyExpr":
        return literal(null, ast, owner)
      case "LiteralPrimitive":
        // `undefined` and `null` both clear a binding.
        return literal(
          typeof ast.value === "string"
            ? clean(ast.value)
            : ast.value === undefined
              ? null
              : ast.value,
          ast,
          owner
        )
      case "Conditional": {
        const node = spanned({ type: "ConditionalExpression" }, ast, owner)
        node.test = opaque(ast.condition, node)
        node.consequent = convert(ast.trueExp, node)
        node.alternate = convert(ast.falseExp, node)
        return node
      }
      case "Binary":
        if (["&&", "||", "??"].includes(ast.operation)) {
          const node = spanned({ type: "LogicalExpression" }, ast, owner)
          node.operator = ast.operation
          node.left = convert(ast.left, node)
          node.right = convert(ast.right, node)
          return node
        }
        return opaque(ast, owner)
      case "LiteralArray": {
        const node = spanned({ type: "ArrayExpression" }, ast, owner)
        node.elements = ast.expressions.map((e: any) => convert(e, node))
        return node
      }
      case "LiteralMap":
        return objectOf(ast, owner)
      case "Interpolation":
        return interpolationOf(ast, owner)
      case "TemplateLiteral": {
        const node = spanned({ type: "TemplateLiteral" }, ast, owner)
        node.quasis = ast.elements.map((element: any, i: number) => {
          const text = clean(element.text)
          return spanned(
            {
              type: "TemplateElement",
              value: { cooked: text, raw: text },
              tail: i === ast.elements.length - 1,
            },
            element,
            node
          )
        })
        node.expressions = ast.expressions.map((e: any) => convert(e, node))
        return node
      }
      default:
        return opaque(ast, owner)
    }
  }

  // `{ 'p-4 m-2': on, active }`: a key the source quotes is a string.
  // A compiler too old to place keys leaves them on the whole object.
  const objectOf = (ast: any, owner: any) => {
    const node = spanned({ type: "ObjectExpression" }, ast, owner)
    node.properties = ast.keys.map((key: any, i: number) => {
      const value = ast.values[i]
      if (key.kind === "spread") {
        const spread = place(
          { type: "SpreadElement" },
          (key.sourceSpan ?? ast.sourceSpan).start,
          value.sourceSpan.end,
          node
        )
        spread.argument = opaque(value, spread)
        return spread
      }
      const at = key.sourceSpan ?? ast.sourceSpan
      const property = place(
        {
          type: "Property",
          kind: "init",
          computed: false,
          method: false,
          shorthand: !!key.isShorthandInitialized,
        },
        at.start,
        key.isShorthandInitialized ? at.end : value.sourceSpan.end,
        node
      )
      property.key = key.quoted
        ? literal(clean(key.key), { sourceSpan: at }, property)
        : spanned(
            { type: "Identifier", name: key.key },
            { sourceSpan: at },
            property
          )
      property.value = key.isShorthandInitialized
        ? opaque(value, property)
        : convert(value, property)
      return property
    })
    return node
  }

  // `class="p-4 {{ tone }}"` is a template literal written in markup: the
  // text between the braces is its quasis, the bindings its expressions.
  // Only a template has one, and its spans are the file's own offsets.
  const interpolationOf = (ast: any, owner: any) => {
    const node = spanned({ type: "TemplateLiteral" }, ast, owner)
    node.quasis = []
    node.expressions = []
    if (whole || source.decoded) return decodedInterpolationOf(ast, node)
    const { text, base } = source
    const end = source.at(ast.sourceSpan.end)
    let cursor = source.at(ast.sourceSpan.start)
    ast.strings.forEach((string: string, i: number) => {
      const expression = ast.expressions[i]
      const from = expression ? source.at(expression.sourceSpan.start) : end
      const open = expression ? base + text.lastIndexOf("{{", from - base) : -1
      const stop = open >= cursor ? open : from
      const cooked = clean(string)
      node.quasis.push({
        type: "TemplateElement",
        value: { cooked, raw: cooked },
        tail: !expression,
        range: [cursor, stop],
        loc: { start: source.loc(cursor), end: source.loc(stop) },
        parent: node,
      })
      if (!expression) return
      node.expressions.push(convert(expression, node))
      const to = source.at(expression.sourceSpan.end)
      const close = text.indexOf("}}", to - base)
      cursor = close === -1 ? to : base + close + 2
    })
    return node
  }

  // Past entities the parser places the first expression in the file and
  // the next ones in the decoded text, so the braces are found again in
  // the decoded text, the way the parser splits it. Each expression is
  // placed on its braces, with no rewrite.
  const decodedInterpolationOf = (ast: any, node: any) => {
    const { decoded, ...file } = source
    const braces = decoded ? bracesIn(decoded.text, ast.strings) : null
    // Each quasi runs from the braces before it to the braces after it.
    const cuts = braces && [0, ...braces.flat(), decoded!.text.length]
    const range = (from: number, to: number): [number, number] =>
      cuts
        ? [
            source.at(decoded!.from + cuts[from]),
            source.at(decoded!.from + cuts[to]),
          ]
        : (whole ?? node.range)
    ast.strings.forEach((string: string, i: number) => {
      const [from, to] = range(2 * i, 2 * i + 1)
      const cooked = clean(string)
      node.quasis.push({
        type: "TemplateElement",
        value: { cooked, raw: cooked },
        tail: i === ast.expressions.length,
        range: [from, to],
        loc: { start: source.loc(from), end: source.loc(to) },
        parent: node,
      })
      const expression = ast.expressions[i]
      if (!expression) return
      const on = range(2 * i + 1, 2 * i + 2)
      node.expressions.push(
        estreeOf(expression, { ...file, whole: on }, node, clean)
      )
    })
    return node
  }

  const node = convert(ast, parent)
  converted.set(ast, node)
  return node
}

// Where the parser finds an interpolation's braces in `text`: the first
// `{{` past the text before it, and the first `}}` outside quotes after
// that. Null when the text around them is not the parser's.
function bracesIn(text: string, strings: string[]) {
  const out: [number, number][] = []
  let cursor = 0
  for (let i = 0; i < strings.length - 1; i++) {
    const open = text.indexOf("{{", cursor)
    if (open === -1 || text.slice(cursor, open) !== strings[i]) return null
    const close = closingBraces(text, open + 2)
    if (close === -1) return null
    out.push([open, close + 2])
    cursor = close + 2
  }
  return text.slice(cursor) === strings[strings.length - 1] ? out : null
}

function closingBraces(text: string, from: number) {
  let quote: string | null = null
  let escapes = 0
  for (let i = from; i < text.length; i++) {
    const c = text[i]
    if (
      (c === "'" || c === '"' || c === "`") &&
      (quote === null || quote === c) &&
      escapes % 2 === 0
    ) {
      quote = quote === null ? c : null
    } else if (quote === null) {
      if (text.startsWith("}}", i)) return i
      if (text.startsWith("//", i)) return text.indexOf("}}", i)
    }
    escapes = c === "\\" ? escapes + 1 : 0
  }
  return -1
}

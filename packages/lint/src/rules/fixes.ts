// A suggestion rewrites one class inside a literal's own source text,
// never re-serializing it, so quotes, escapes and entities survive. A
// class not found verbatim there gets no suggestion rather than a wrong
// one.

import { replaceClass } from "../grammar/classes"
import { isMarkupLiteral, readerFor } from "../sites/readers"
import { angularReader } from "../sites/readers/angular"

// A value whose bindings a reader blanked to spaces (`masked`), written
// out as the source spells it with those spaces in place. Null where the
// value is not the source less its bindings, as when an entity moved it.
function maskedSource(inner: string, value: string) {
  if (inner.length !== value.length) return null
  let out = ""
  for (let i = 0; i < inner.length; i++) {
    if (inner[i] === value[i]) out += inner[i]
    else if (value[i] === " ") out += " "
    else return null
  }
  return out
}

// Markup text is its own source: nothing is escaped, and the quotes, if
// the node has them at all, stay where they are.
function replaceInMarkup(
  node: any,
  context: any,
  token: string,
  replacement: string
) {
  const raw: string = context.sourceCode?.getText?.(node) ?? ""
  const quote = raw[0] === '"' || raw[0] === "'" ? raw[0] : ""
  const inner = quote ? raw.slice(1, -1) : raw
  if (quote && raw[raw.length - 1] !== quote) return null
  if (!node.masked) {
    const replaced = replaceClass(inner, token, replacement)
    return replaced === inner ? null : `${quote}${replaced}${quote}`
  }
  // The class is found where the bindings are blanked, so a token inside
  // one is never taken for it, and rewritten at the same place.
  const masked = maskedSource(inner, node.value)
  if (masked === null) return null
  const replaced = replaceClass(masked, token, replacement)
  if (replaced === masked) return null
  let start = 0
  while (masked[start] === replaced[start]) start++
  // The tail shared ends where the head does, in the shorter of the two.
  let end = 0
  while (
    end < Math.min(masked.length, replaced.length) - start &&
    masked[masked.length - 1 - end] === replaced[replaced.length - 1 - end]
  ) {
    end++
  }
  const text =
    inner.slice(0, start) +
    replaced.slice(start, replaced.length - end) +
    inner.slice(inner.length - end)
  return `${quote}${text}${quote}`
}

export function replaceInLiteral(
  node: any,
  context: any,
  token: string,
  replacement: string
) {
  if (isMarkupLiteral(node) && typeof node.value === "string") {
    return replaceInMarkup(node, context, token, replacement)
  }
  if (node?.type !== "Literal" || typeof node.value !== "string") return null
  const raw: string = node.raw ?? context.sourceCode?.getText?.(node) ?? ""
  const quote = raw[0]
  if ((quote !== '"' && quote !== "'") || raw[raw.length - 1] !== quote) {
    return null
  }
  const inner = raw.slice(1, -1)
  // Escapes and line continuations move classes between source and value;
  // a JSX attribute decodes entities without moving anything.
  const inJsx = node.parent?.type === "JSXAttribute"
  if (!inJsx && inner !== node.value) return null
  const replaced = replaceClass(inner, token, replacement)
  return replaced === inner ? null : `${quote}${replaced}${quote}`
}

// angular-eslint's processor lints an inline template as a file of its
// own and moves fixes back into the .ts, but not suggestions: applied
// there, one would rewrite the top of the file. The finding stays.
function isInlineAngularTemplate(context: any) {
  return (
    context.physicalFilename != null &&
    context.physicalFilename !== context.filename &&
    readerFor(context) === angularReader
  )
}

export function classSuggestion(
  node: any,
  context: any,
  token: string,
  replacement: string,
  messageId: string,
  data: Record<string, string>
) {
  if (isInlineAngularTemplate(context)) return null
  const text = replaceInLiteral(node, context, token, replacement)
  if (text === null) return null
  return {
    messageId,
    data,
    fix: (fixer: any) => fixer.replaceText(node, text),
  }
}

// Undefined rather than an empty list, so a report carries none.
export function classSuggestions(
  node: any,
  context: any,
  token: string,
  replacements: string[],
  messageId: string,
  key: string
) {
  const list = replacements
    .map((replacement) =>
      classSuggestion(node, context, token, replacement, messageId, {
        [key]: replacement,
      })
    )
    .filter((s) => s !== null)
  return list.length ? list : undefined
}

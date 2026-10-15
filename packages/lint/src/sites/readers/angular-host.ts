// `host` in @Component and @Directive: static `class` and `style`, and
// bindings whose strings the compiler parses as a template's. A script is
// otherwise JSX's, so this reader wraps the JSX one.

import * as path from "node:path"

import { warnOnce } from "../../project/warn"
import { angularCompiler, fileOfNode } from "./angular-compiler"
import {
  classNameNode,
  estreeOf,
  styleObjectNode,
  type ExpressionSource,
} from "./angular-expressions"
import type { TemplateReader } from "./types"

const DECORATORS = new Set(["Component", "Directive"])

function keyOf(property: any): string | null {
  if (property.computed) return null
  const key = property.key
  if (key?.type === "Identifier") return key.name
  return key?.type === "Literal" && typeof key.value === "string"
    ? key.value
    : null
}

function isHostOption(host: any) {
  if (host?.type !== "Property" || keyOf(host) !== "host") return false
  const config = host.parent
  const call = config?.parent
  return (
    config?.type === "ObjectExpression" &&
    call?.type === "CallExpression" &&
    call.arguments?.[0] === config &&
    call.callee?.type === "Identifier" &&
    DECORATORS.has(call.callee.name) &&
    call.parent?.type === "Decorator"
  )
}

function isHostObject(object: any) {
  const host = object?.parent
  return host?.value === object && isHostOption(host)
}

// A value as a warning can name it.
function shown(node: any) {
  if (node?.type === "Identifier") return `\`${node.name}\``
  return "an expression"
}

// What `host` holds but does not spell out may bind any class or style:
// say once per component that it is not checked.
function warnUnread(host: any, reason: string) {
  const declaration = host?.parent?.parent?.parent?.parent
  const name = declaration?.id?.name ?? "a component"
  const file = fileOfNode(host) ?? ""
  const relative = path.relative(process.cwd(), file)
  const where = (relative.startsWith("..") ? file : relative).replace(
    /\\/g,
    "/"
  )
  warnOnce(
    `angular-host:unread:${file}:${name}`,
    `The host of ${name} in ${where} cannot be read: ${reason}. The classes and styles it binds there are not checked.`
  )
}

// The `host` option itself: an object whose every key is written out.
function checkHostOption(property: any) {
  if (!isHostOption(property)) return
  const value = property.value
  if (value?.type !== "ObjectExpression") {
    warnUnread(property, `host is ${shown(value)}, not an object`)
    return
  }
  for (const entry of value.properties ?? []) {
    if (entry.type === "SpreadElement") {
      const spread = shown(entry.argument).replaceAll("`", "")
      warnUnread(property, `it spreads \`...${spread}\``)
      return
    }
    if (entry.computed) {
      warnUnread(property, "a key is computed")
      return
    }
  }
}

// What a host key sets, under the name a template attribute would have;
// "" for a key that sets nothing this plugin reads.
function nameOfKey(key: string) {
  if (key === "class" || key === "style") return key
  if (!key.startsWith("[") || !key.endsWith("]")) return ""
  const inner = key.slice(1, -1)
  if (inner === "class" || inner === "className" || inner.startsWith("class."))
    return "class"
  if (inner === "style" || inner.startsWith("style.")) return "style"
  if (inner.startsWith("attr.")) return inner.slice("attr.".length)
  return ""
}

type HostBinding = { name: string; key: string; element: any }

const bindings = new WeakMap<object, HostBinding | null>()
const elements = new WeakMap<object, any>()

export function hostBindingOf(property: any): HostBinding | null {
  if (property?.type !== "Property") return null
  const object = property.parent
  if (object?.type !== "ObjectExpression") return null
  let binding = bindings.get(property)
  if (binding !== undefined) return binding
  binding = null
  const key = isHostObject(object) ? keyOf(property) : null
  const name = key === null ? "" : nameOfKey(key)
  if (key !== null && name) {
    let element = elements.get(object)
    if (!element) {
      // The element the selector matches. It has no tag to name yet.
      element = { type: "AngularHost", host: object }
      elements.set(object, element)
    }
    binding = { name, key, element }
  }
  bindings.set(property, binding)
  return binding
}

// A value inside a host binding, or the binding's own string.
function inHostBinding(node: any) {
  for (let i = 0; node && i < 32; node = node.parent, i++) {
    if (node.type === "Property" && hostBindingOf(node)) return true
    if (node.type === "Decorator" || node.type === "Program") return false
  }
  return false
}

// The string a key or value spells, and, for each of its characters, the
// offset in the file it was written at: escapes and line continuations
// take more source than the text they stand for.
function stringSource(node: any) {
  let raw: string | null = null
  let value: string | null = null
  if (node?.type === "Literal" && typeof node.value === "string") {
    raw = typeof node.raw === "string" ? node.raw : null
    value = node.value
  } else if (
    node?.type === "TemplateLiteral" &&
    node.expressions.length === 0 &&
    typeof node.quasis[0]?.value?.cooked === "string"
  ) {
    raw = `\`${node.quasis[0].value.raw}\``
    value = node.quasis[0].value.cooked
  }
  if (raw === null || value === null || !node.range || !node.loc) return null
  const base: number = node.range[0]
  let offsets = cookedOffsets(raw, node.type === "TemplateLiteral")
  // A spelling this does not decode is placed as if it had no escapes.
  if (offsets.length !== value.length + 1) {
    offsets = Array.from({ length: value.length + 1 }, (_, i) =>
      Math.min(i + 1, raw!.length - 1)
    )
  }
  const start = node.loc.start
  const source: ExpressionSource = {
    text: raw,
    base,
    at: (offset) =>
      base + offsets[Math.max(0, Math.min(offset, offsets.length - 1))],
    loc(offset) {
      const before = raw!.slice(0, offset - base)
      const lines = before.split(/\r\n|[\r\n\u2028\u2029]/)
      return lines.length === 1
        ? { line: start.line, column: start.column + before.length }
        : {
            line: start.line + lines.length - 1,
            column: lines[lines.length - 1].length,
          }
    },
  }
  return { value, source }
}

// For each character of the string a quoted literal spells, its index in
// the literal; one more for the closing quote. A template literal spells
// each line ending it spans as LF.
function cookedOffsets(raw: string, template: boolean) {
  const out: number[] = []
  const end = raw.length - 1
  let i = 1
  while (i < end) {
    if (raw[i] !== "\\") {
      out.push(i)
      i += template && raw[i] === "\r" && raw[i + 1] === "\n" ? 2 : 1
      continue
    }
    const next = raw[i + 1]
    if (next === "\r") {
      i += raw[i + 2] === "\n" ? 3 : 2
    } else if (next === "\n" || next === "\u2028" || next === "\u2029") {
      i += 2
    } else if (next === "x") {
      out.push(i)
      i += 4
    } else if (next === "u" && raw[i + 2] === "{") {
      const close = raw.indexOf("}", i)
      const code = parseInt(raw.slice(i + 3, close), 16)
      out.push(i)
      if (code > 0xffff) out.push(i)
      i = close + 1
    } else if (next === "u") {
      out.push(i)
      i += 6
    } else {
      out.push(i)
      i += 2
    }
  }
  out.push(end)
  return out
}

function compilerFor(node: any) {
  const compiler = angularCompiler(fileOfNode(node))
  if (!compiler) {
    warnOnce(
      "angular-host:compiler",
      "Host binding values such as `[class]` and `[style.color]` in @Component and @Directive are read with @angular-eslint/bundled-angular-compiler, which angular-eslint installs. It could not be loaded, so they are not checked; the class or style property a key names, as in `[class.active]`, still is. Install angular-eslint."
    )
  }
  return compiler
}

// The expression a host binding's string holds, in the compiler's AST.
function parseBinding(key: string, value: string, node: any) {
  const angular = compilerFor(node)
  if (!angular) return null
  try {
    const source = new angular.ParseSourceFile(value, "host")
    const span = new angular.ParseSourceSpan(
      new angular.ParseLocation(source, 0, 0, 0),
      new angular.ParseLocation(source, value.length, 0, value.length)
    )
    const [property] =
      angular
        .makeBindingParser()
        .createBoundHostProperties({ [key]: value }, span) ?? []
    return property?.expression ?? null
  } catch {
    return null
  }
}

const values = new WeakMap<object, any>()

// A value no expression was read from, in place of the script's node.
const unreadValue = (node: any, parent: any) => ({
  type: "AngularExpression",
  expression: null,
  range: node.range,
  loc: node.loc,
  parent,
})

function hostValueOf(property: any) {
  if (values.has(property)) return values.get(property)
  const binding = hostBindingOf(property)
  let value: any = null
  if (binding?.key === "class" || binding?.key === "style") {
    // A static attribute is its string, or a constant the compiler
    // evaluates, as the walker follows one.
    value = property.value
  } else if (binding) {
    // A key names its class or style property whatever the value is, so
    // it is read without the compiler too.
    const inner = binding.key.slice(1, -1)
    const keyString = stringSource(property.key)
    const string = stringSource(property.value)
    const parsed = () =>
      string ? parseBinding(inner, string.value, property) : null
    if (inner.startsWith("class.") && keyString) {
      const at = keyString.source.at
      value = classNameNode(
        inner.slice("class.".length),
        at("[class.".length),
        at(binding.key.length - 1),
        keyString.source,
        property
      )
    } else if (inner.startsWith("style.") && !inner.split(".")[1]) {
      // `[style.]` names no property, and sets none.
    } else if (inner.startsWith("style.") && keyString) {
      const name = inner.slice("style.".length).split(".")[0]
      const at = keyString.source.at
      const ast = parsed()
      value = styleObjectNode(
        name,
        at("[style.".length),
        at("[style.".length + name.length),
        keyString.source,
        property,
        (owner) =>
          ast && string
            ? estreeOf(ast, string.source, owner)
            : unreadValue(property.value, owner)
      )
    } else {
      const ast = parsed()
      if (ast && string) value = estreeOf(ast, string.source, property)
    }
    if (!string && !inner.startsWith("class.")) {
      warnUnread(
        property.parent?.parent,
        `\`${binding.key}\` holds ${shown(property.value)}, not a string`
      )
    }
  }
  values.set(property, value)
  return value
}

const isHost = (element: any) => element?.type === "AngularHost"

// A script reader that also reads the host bindings of a component or
// a directive declared in the file.
export function withHostBindings(reader: TemplateReader): TemplateReader {
  const { classObjects, staticStyles, renderedElementOf } = reader
  return {
    ...reader,
    attributes: [...reader.attributes, "Property"],
    attributeName: (node) => {
      if (node?.type !== "Property") return reader.attributeName(node)
      const binding = hostBindingOf(node)
      if (!binding) checkHostOption(node)
      return binding?.name ?? ""
    },
    attributeValue: (node) =>
      node?.type === "Property"
        ? hostValueOf(node)
        : reader.attributeValue(node),
    sourceStrings: (node) =>
      node?.type === "Property" && hostBindingOf(node)
        ? [node.key, node.value]
        : (reader.sourceStrings?.(node) ?? []),
    elementOf: (node) =>
      node?.type === "Property"
        ? (hostBindingOf(node)?.element ?? null)
        : reader.elementOf(node),
    nameOf: (element) => (isHost(element) ? null : reader.nameOf(element)),
    parentElementOf: (element) =>
      isHost(element) ? null : reader.parentElementOf(element),
    ...(renderedElementOf
      ? {
          renderedElementOf: (element: any) =>
            isHost(element) ? undefined : renderedElementOf(element),
        }
      : {}),
    // `[class]="{ 'p-4': on }"` keys its classes, as a template does.
    classObjects: (node, name) =>
      hostBindingOf(node) !== null ||
      (typeof classObjects === "function"
        ? classObjects(node, name)
        : classObjects === true && name === "class"),
    staticStyles: (node) =>
      inHostBinding(node) ||
      (typeof staticStyles === "function"
        ? staticStyles(node)
        : staticStyles === true),
  }
}

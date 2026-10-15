// no-restyle in an Angular template. A template imports nothing a tag
// could be resolved through, so an element is the names on it a
// contract's pattern matches: its tag, an attribute, a binding. Each
// name stands for the directive in the template's scope under that
// selector, and the cva in that directive's file gives the variants, as
// a .tsx component's does. An input such as styleClass is judged by the
// contract of the directive that takes it.

import { propertyGroup } from "../grammar/categories"
import { normalizeClass, OPACITY_MODIFIER } from "../grammar/classes"
import {
  directiveOf,
  hostComponentOf,
  inputOwnersOf,
  type DirectiveClass,
  type DirectiveRef,
} from "../project/angular-directives"
import {
  angularGlobalClassesOf,
  angularHostClassesOf,
  angularOwnClassesOf,
  type OwnClasses,
} from "../project/angular-styles"
import {
  sizeNamesFor,
  variantDefinitionsOf,
  variantNamesFor,
} from "../project/variants"
import { DEFAULT_MERGE_FUNCTIONS, type ClassSite } from "../sites/collect"
import type { TemplateReader } from "../sites/readers"
import { selectorOf } from "../sites/readers/angular"
import type { compileContracts, ElementIdentity } from "./contracts"
import { fileOf } from "./messages"
import type { Judge, Subject } from "./no-restyle"

type Contracts = ReturnType<typeof compileContracts>

// What lands on the element itself: `class`, and `[class]`, `[class.x]`,
// `[ngClass]`, `[attr.class]` and `[className]`, which the reader names
// `class` (CLASS_BINDING in angular-partial.ts says the same of a
// directive's host), and
// the classes NgClass and routerLinkActive add to their element. An
// input such as styleClass, panelClass or enterActiveClass hands its
// classes to the directive that takes it, which puts them where it
// likes: inside its component, or on another element.
export const ON_ELEMENT = new Set(["class", "ngClass", "routerLinkActive"])

// What a class of the component's own styles may set and still be
// layout: the properties Tailwind's layout utilities set, those of the
// groups the grammar gives no appearance category (sr-only's padding and
// clip-path aside), with the longhands and shorthands that set nothing
// else. Anything else paints, or the grammar has it in an appearance
// category, as text-overflow is typography and border-spacing spacing.
const LAYOUT_PROPERTIES = new Set(
  [
    "align-content,align-items,align-self,appearance,aspect-ratio",
    "backface-visibility,block-size,border-collapse,bottom",
    "box-decoration-break,box-sizing,break-after,break-before,break-inside",
    "caption-side,clear,color-scheme,column-count,column-width,columns",
    "contain,container,container-name,container-type,content,cursor",
    "display,field-sizing,flex,flex-basis,flex-direction,flex-flow",
    "flex-grow,flex-shrink,flex-wrap,float,forced-color-adjust",
    "grid-area,grid-auto-columns,grid-auto-flow,grid-auto-rows",
    "grid-column,grid-column-end,grid-column-start,grid-row,grid-row-end",
    "grid-row-start,grid-template-columns,grid-template-rows,height",
    "inline-size,inset,inset-block,inset-block-end,inset-block-start",
    "inset-inline,inset-inline-end,inset-inline-start,isolation",
    "justify-content,justify-items,justify-self,left,margin,margin-block",
    "margin-block-end,margin-block-start,margin-bottom,margin-inline",
    "margin-inline-end,margin-inline-start,margin-left,margin-right",
    "margin-top,max-block-size,max-height,max-inline-size,max-width",
    "min-block-size,min-height,min-inline-size,min-width,object-fit",
    "object-position,order,overflow,overflow-wrap,overflow-x,overflow-y",
    "overscroll-behavior,overscroll-behavior-x,overscroll-behavior-y",
    "perspective,perspective-origin,place-content,place-items,place-self",
    "pointer-events,position,resize,right,rotate,scale,scroll-behavior",
    "scroll-margin,scroll-margin-block,scroll-margin-block-end",
    "scroll-margin-block-start,scroll-margin-bottom,scroll-margin-inline",
    "scroll-margin-inline-end,scroll-margin-inline-start,scroll-margin-left",
    "scroll-margin-right,scroll-margin-top,scroll-padding",
    "scroll-padding-block,scroll-padding-block-end",
    "scroll-padding-block-start,scroll-padding-bottom,scroll-padding-inline",
    "scroll-padding-inline-end,scroll-padding-inline-start",
    "scroll-padding-left,scroll-padding-right,scroll-padding-top",
    "scroll-snap-align,scroll-snap-stop,scroll-snap-type,scrollbar-gutter",
    "scrollbar-width,tab-size,table-layout,text-align,top,touch-action",
    "transform,transform-origin,transform-style,translate,user-select",
    "vertical-align,visibility,white-space,width,will-change,word-break",
    "z-index,zoom",
  ]
    .join(",")
    .split(",")
)

const VENDOR_PREFIX = /^-(?:webkit|moz|ms|o)-/

type Named = Subject & {
  // Whether the directive styles the element it is on.
  styles: boolean
  // Whether a directive the template imports was found for the name.
  found: boolean
  // Whether a cva gives it variants or sizes, which a message lists. A
  // cva beside it that gives neither, as HlmTooltip's places the arrow
  // of the tooltip it opens, is not the element's.
  varies: () => boolean
}

export function angularRestyle(
  context: any,
  reader: TemplateReader,
  contracts: Contracts,
  options: { multipleContracts?: string; mergeFunctions?: string[] }
) {
  const physical = fileOf(context)
  const template = context.filename ?? physical
  const every = options.multipleContracts === "all"
  // A directive that calls one of these builds its element's classes.
  const helpers = new Set([
    ...DEFAULT_MERGE_FUNCTIONS,
    ...(options.mergeFunctions ?? []),
  ])

  // A template's classes are also declared by its component's styles and
  // the project's global ones, and those on a component's element by the
  // styles of that component, `:host(.x)`, as no-unknown-classes reads
  // them. Styles that could not be read declare nothing a message could
  // name.
  let styles: OwnClasses[] | undefined
  const declares = (token: string, site: ClassSite) => {
    styles ??= [
      angularOwnClassesOf(template, physical),
      angularGlobalClassesOf(physical),
    ].filter((own): own is OwnClasses => !!own && !own.unread)
    const base = normalizeClass(token).replace(OPACITY_MODIFIER, "")
    if (!base) return false
    if (styles.some((own) => own.has(base))) return true
    if (!site.element || !ON_ELEMENT.has(site.attribute ?? "")) return false
    const selector = selectorOf(site.element)
    const component =
      selector && hostComponentOf(template, physical, selector, helpers)
    const host =
      component && angularHostClassesOf(component.file, component.name)
    return !!host && !host.unread && host.has(base)
  }

  // A class the component's own styles declare is read by what their
  // rules set, as an @utility is by its body: `.orders-card { max-width:
  // 40rem }` is layout. Only when every rule it is in sets layout alone,
  // not a custom property, which the component inside may read, nor what
  // cannot be read; and not where the global styles declare it too.
  // Null otherwise: the grammar cannot tell what it changes.
  let own: OwnClasses | undefined
  let global: OwnClasses | null | undefined
  const ownGroupOf = (token: string) => {
    own ??= angularOwnClassesOf(template, physical)
    if (global === undefined) global = angularGlobalClassesOf(physical)
    if (global?.has(token)) return null
    const properties = own.propertiesOf?.(token)
    if (!properties) return null
    const unprefixed = properties.map((p) => p.replace(VENDOR_PREFIX, ""))
    if (!unprefixed.every((p) => LAYOUT_PROPERTIES.has(p))) return null
    return propertyGroup(unprefixed[0] ?? "display")
  }

  // An element with the contracts its names match, or null.
  const judgedElement = (element: any) => {
    const names = reader.contractNames?.(element)
    if (!names) return null
    const matched = contracts.identitiesOf(names)
    return matched.length ? { tag: names[0], matched } : null
  }

  // The directive a name on an element stands for, or null.
  const directives = new WeakMap<object, Map<string, DirectiveRef | null>>()
  const directiveAt = (element: any, name: string) => {
    let byName = directives.get(element)
    if (!byName) {
      byName = new Map()
      directives.set(element, byName)
    }
    if (!byName.has(name)) {
      const selector = selectorOf(element)
      byName.set(
        name,
        selector
          ? directiveOf(template, physical, selector, name, helpers)
          : null
      )
    }
    return byName.get(name)!
  }

  // A broad pattern also matches directives that only behave: a trigger,
  // a tooltip. An element whose every matched name stands for one of
  // those attribute directives is no design-system component. A component
  // is one, drawn in its own template, and a name no imported directive
  // stands for may still be one that styles.
  const plain = new WeakMap<object, boolean>()
  const isPlain = (element: any, matched: readonly ElementIdentity[]) => {
    let known = plain.get(element)
    if (known === undefined) {
      known = matched.every(({ name }) => {
        const directive = directiveAt(element, name)
        return directive?.styles === false && !directive.component
      })
      plain.set(element, known)
    }
    return known
  }

  // An element around another that its contracts judge, or null.
  const judgedAround = (element: any) => {
    const judged = judgedElement(element)
    return judged && !isPlain(element, judged.matched) ? judged : null
  }

  // Where space around an element goes: margin when its own contracts
  // allow one, and the nearest element around it whose contracts take
  // the class, judged the way the element is.
  const around = (
    element: any,
    matched: readonly ElementIdentity[],
    token: string
  ) => {
    const places: string[] = []
    if (!contracts.decideElement(matched, "m-4", every)) {
      places.push("margin here")
    }
    const parent = reader.parentElementOf(element)
    let container: { name: string; direct: boolean } | null = null
    let direct = true
    for (let node = parent; node; node = reader.parentElementOf(node)) {
      const judged = judgedAround(node)
      if (judged && !contracts.decideElement(judged.matched, token, every)) {
        // Named after a name whose contract takes the class.
        const taker =
          judged.matched.find(
            (identity) => !contracts.decideElement([identity], token)
          ) ?? judged.matched[0]
        container = { name: shownAs(judged.tag, taker.name), direct }
        break
      }
      direct = false
    }
    if (!container?.direct) {
      const closed = parent ? judgedAround(parent) : null
      places.push(
        closed && contracts.decideElement(closed.matched, token, every)
          ? "gap on a plain wrapper around it"
          : "gap on the parent"
      )
    }
    if (container) places.push(`spacing on <${container.name}>`)
    return phrase(places)
  }

  // Whose an input on an element is, as the names on the element a
  // contract matches: those of each directive in the template's scope
  // that declares it, read from the project's sources or a library's
  // .d.ts. When that cannot be told, the component the tag names takes
  // it, when a contract matches the tag. A directive no contract
  // matches judges nothing.
  const owned = new WeakMap<object, Map<string, readonly ElementIdentity[]>>()
  const ownersOf = (
    element: any,
    input: string,
    judged: { tag: string; matched: readonly ElementIdentity[] }
  ) => {
    let byInput = owned.get(element)
    if (!byInput) {
      byInput = new Map()
      owned.set(element, byInput)
    }
    let found = byInput.get(input)
    if (!found) {
      const selector = selectorOf(element)
      const owners = selector
        ? inputOwnersOf(template, physical, selector, input, helpers)
        : null
      const names = new Set(
        owners ? owners.flatMap((owner) => owner.names) : [judged.tag]
      )
      found = judged.matched.filter((identity) => names.has(identity.name))
      byInput.set(input, found)
    }
    return found
  }

  // Each name on a site's element a contract matches judges the classes
  // that land on the element itself; an input's, the names of the
  // directives that take it.
  const judgeOf = (site: ClassSite): Judge | null => {
    const judged = judgedElement(site.element)
    if (!judged) return null
    const { tag } = judged
    const input = !ON_ELEMENT.has(site.attribute ?? "")
    const matched = input
      ? ownersOf(site.element, site.attribute ?? "", judged)
      : judged.matched
    if (!matched.length) return null
    const subjects = new Map<string, Named>()
    const subjectOf = (name: string) => {
      let subject = subjects.get(name)
      if (!subject) {
        const component = shownAs(tag, name)
        // The directive the name stands for holds the variants.
        const directive = directiveAt(site.element, name)
        let definitions: ReturnType<typeof definitionsOf> | undefined
        const read = () => (definitions ??= definitionsOf(directive))
        subject = {
          component,
          wrapper: null,
          around: (token) => around(site.element, matched, token),
          read,
          styles: directive?.styles === true,
          found: !!directive,
          varies: () => !!(read().variants.names ?? read().sizes.names),
        }
        subjects.set(name, subject)
      }
      return subject
    }
    return (token) => {
      let refused = contracts.decideElement(matched, token, every)
      if (
        refused &&
        !input &&
        refused.every(({ verdict }) => verdict.category === "unclassified")
      ) {
        const group = ownGroupOf(token)
        if (group)
          refused = contracts.decideElement(matched, token, every, group)
      }
      // An element only directives that style nothing name wears its
      // classes as a plain one; what it hands an input is the input's.
      if (!refused || (!input && isPlain(site.element, matched))) return null
      // Named after a directive whose cva gives its variants, hlmBtn
      // rather than the hlmDropdownMenuTrigger beside it, which styles the
      // element with the CDK's label and has none; else one that styles
      // the element, hlmBtn rather than the hlmPopoverTrigger beside it;
      // else one the template imports, past an input such as
      // hlmContextMenuTriggerData.
      const { verdict, name } =
        refused.find((refusal) => subjectOf(refusal.name).varies()) ??
        refused.find((refusal) => subjectOf(refusal.name).styles) ??
        refused.find((refusal) => subjectOf(refusal.name).found) ??
        refused[0]
      return { verdict, subject: subjectOf(name) }
    }
  }

  return { declares, judgeOf }
}

// A directive's variants or sizes: those of the cva variants.ts finds for
// its class, or in a file that declares no other directive, of the first
// cva in it, as in a single-file component.
function axisOf(directive: DirectiveClass, axis: "variant" | "size") {
  const read = axis === "variant" ? variantNamesFor : sizeNamesFor
  const own = read(directive.file, directive.name)
  if (own || !directive.sole) return own
  const other = axis === "variant" ? sizeNamesFor : variantNamesFor
  // The class uses a cva, without this axis.
  if (other(directive.file, directive.name)) return null
  const factory = variantDefinitionsOf(directive.file).find(
    (definition) => definition.source === "factory"
  )
  const values = factory?.axes[axis]
  return values?.length ? values : null
}

// Where a directive's variants and sizes are defined: its own cva, else
// that of a directive it hosts, as spartan's HlmInputGroupButton takes
// its variants from HlmButton. A message sends a new one to a file that
// holds a cva, never to one that holds none. A library's class, read
// from its .d.ts, has none to read.
function definitionsOf(found: DirectiveRef | null) {
  const directive = found && !found.compiled ? found : null
  const classes = directive ? [directive, ...directive.hosted] : []
  const axis = (name: "variant" | "size") => {
    for (const definer of classes) {
      const names = axisOf(definer, name)
      if (names) return { file: definer.file, names }
    }
    return null
  }
  const file =
    classes.find((definer) =>
      variantDefinitionsOf(definer.file).some(
        (definition) => definition.source === "factory"
      )
    )?.file ?? null
  return {
    known: !!directive,
    compiled: !!found?.compiled,
    variants: axis("variant") ?? { file, names: null },
    sizes: axis("size") ?? { file, names: null },
  }
}

// An element as a finding names it: `<button hlmBtn>` for a directive,
// `<p-button>` for a tag.
function shownAs(tag: string, name: string) {
  return name === tag ? tag : `${tag} ${name}`
}

// "margin here, gap on the parent, or spacing on <div hlmCard>".
function phrase(places: string[]) {
  const last = places.pop() ?? ""
  if (!places.length) return last
  if (places.length === 1) return `${places[0]} or ${last}`
  return `${places.join(", ")}, or ${last}`
}

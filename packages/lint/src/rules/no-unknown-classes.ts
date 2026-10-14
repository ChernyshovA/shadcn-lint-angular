// no-unknown-classes: a class Tailwind does not know generates no CSS and
// fails silently. The project's own Tailwind answers, through the worker
// in src/tailwind; without it, the cn grammar and the project's CSS do.
// See docs/rules/no-unknown-classes.md.

import { categoryOf } from "../grammar/categories"
import { isMarkerClass, normalizeClass, splitClasses } from "../grammar/classes"
import { didYouMean } from "../grammar/similar"
import { hostComponentOf } from "../project/angular-directives"
import {
  angularFileClassesOf,
  angularGlobalClassesOf,
  angularHostClassesOf,
  angularOwnClassesOf,
  type OwnClasses,
} from "../project/angular-styles"
import { projectClassifierFor } from "../project/namespaces"
import { isSfc, styleClassesOf } from "../project/parser"
import {
  colorTokensFor,
  knownClassesFor,
  tailwindEntryFor,
  tailwindPrefixFor,
  themeFileFor,
  utilityPrefixesOf,
  warnNoTailwindEntry,
} from "../project/theme"
import { warnOnce } from "../project/warn"
import {
  classSiteVisitors,
  DEFAULT_MERGE_FUNCTIONS,
  type ClassSite,
} from "../sites/collect"
import { readerFor } from "../sites/readers"
import { angularReader, selectorOf } from "../sites/readers/angular"
import { isAngularCode } from "../sites/readers/angular-code"
import { hostBindingOf } from "../sites/readers/angular-host"
import { unknownClasses } from "../tailwind/client"
import { ON_ELEMENT } from "./angular-restyle"
import { compileVocabularyPolicy, configErrorVisitors } from "./contracts"
import { classSuggestions } from "./fixes"
import { displayPath, fileOf, reporter } from "./messages"
import { colorValueOf } from "./no-raw-colors"
import { policySchema, recognitionSchema } from "./policy-schema"
import { withSettings } from "./settings"

// Styles that cannot be read settle every class in the template, and on
// the component's element in the templates that use it, so the rule says
// once per component that it is not checking there.
function warnUnread(context: any, own: OwnClasses) {
  const { unread } = own
  if (unread?.file) {
    warnOnce(
      `angular-styles:${unread.file}:${unread.component}`,
      `The styles of ${unread.component} in ${displayPath(unread.file, context)} cannot be read: ${unread.reason}${whereOf(unread.where, context)}. shadcn/no-unknown-classes is skipped in its template and in the classes of its element in others, since any class there may be one they declare.`
    )
  }
  return own
}

// Host bindings in the component's .ts are judged by the same styles.
function angularOwnClasses(context: any, filename: string, host = false) {
  return warnUnread(
    context,
    host
      ? angularFileClassesOf(filename)
      : angularOwnClassesOf(context.filename ?? filename, filename)
  )
}

// The global stylesheets of an Angular project serve every Angular file
// in it, and settle every class when they cannot be read. A React file in
// the same workspace is not styled by them.
function angularGlobalClasses(context: any, filename: string) {
  if (!isAngularCode(context)) return null
  const global = angularGlobalClassesOf(filename)
  const unread = global?.unread
  if (unread?.file) {
    warnOnce(
      `angular-global-styles:${unread.file}`,
      `The global styles ${displayPath(unread.file, context)} names cannot be read: ${unread.reason}${whereOf(unread.where, context)}. shadcn/no-unknown-classes is skipped in this project, since any class may be one they declare.`
    )
  }
  return global
}

const whereOf = (where: string | null, context: any) =>
  where ? ` in ${displayPath(where, context)}` : ""

const MESSAGES = {
  unknownClass:
    '"{{className}}" is not a class this project\'s Tailwind knows, so no CSS is generated for it. Fix the spelling, or declare it with @utility in {{file}}.',
  unknownClassSuggest:
    '"{{className}}" is not a class this project\'s Tailwind knows, so no CSS is generated for it. Did you mean "{{suggestion}}"?',
  // A host's element sits in the template of whichever component renders
  // it, so that component's styles reach it, and which one that is is
  // not known here.
  unknownHostClass:
    '"{{className}}" is not a class this project\'s Tailwind knows, so no CSS is generated for it. Fix the spelling, or declare it with @utility in {{file}}. If the stylesheet of a component that renders this host styles it, add it to allow.',
  unknownHostClassSuggest:
    '"{{className}}" is not a class this project\'s Tailwind knows, so no CSS is generated for it. Did you mean "{{suggestion}}"? If the stylesheet of a component that renders this host styles it, add it to allow.',
  unknownVariant:
    '"{{className}}" uses a variant this project\'s Tailwind does not know, so no CSS is generated for it. Use an existing variant, or declare it with @custom-variant in {{file}}.',
  useSuggestion: 'Replace with "{{suggestion}}".',
}

export const noUnknownClasses = {
  meta: {
    type: "problem" as const,
    hasSuggestions: true,
    docs: {
      description:
        "Disallow classes Tailwind does not know; no CSS is generated for them.",
      url: "https://github.com/shadcn-ui/lint/blob/main/docs/rules/no-unknown-classes.md",
    },
    schema: [
      {
        type: "object",
        properties: {
          ...policySchema,
          ...recognitionSchema,
        },
        additionalProperties: false,
      },
    ],
    messages: MESSAGES,
  },
  create(context: any) {
    const options = withSettings(context, context.options?.[0] ?? {})
    const emit = reporter(context, MESSAGES, {
      rule: "shadcn/no-unknown-classes",
      message: options.message,
    })
    const filename = fileOf(context)
    let policy: ReturnType<typeof compileVocabularyPolicy>
    try {
      policy = compileVocabularyPolicy(
        { ...options, uncheckedEntries: true, fromFile: filename },
        "shadcn/no-unknown-classes"
      )
    } catch (error) {
      return configErrorVisitors(context, error)
    }
    const { groupOf } = projectClassifierFor(filename)
    const known = knownClassesFor(filename)
    // A single-file component's own <style> block declares classes for
    // its template the way the theme CSS does for everything, and so do
    // an Angular component's styles.
    const ownClasses: { has: (name: string) => boolean } = isSfc(filename)
      ? styleClassesOf(context.sourceCode?.text ?? "")
      : readerFor(context) === angularReader
        ? angularOwnClasses(context, filename)
        : new Set<string>()
    const globalClasses = angularGlobalClasses(context, filename)
    const themeFile = themeFileFor(filename)
    const file = themeFile ? displayPath(themeFile, context) : "your theme CSS"
    // A theme file that does not import Tailwind knows no base utilities,
    // so the grammar answers instead of a half-built design system.
    const entry = tailwindEntryFor(filename)
    if (!entry) warnNoTailwindEntry(filename)
    const utilityPrefixes = utilityPrefixesOf(known.utilities)
    // Under prefix(tw), no-raw-colors leaves an unprefixed text-muted to
    // this rule: it is no more a Tailwind class than flex is.
    const prefix = tailwindPrefixFor(filename)
    const isTailwindColor = (token: string) =>
      (!prefix || token.startsWith(`${prefix}:`)) && isColor(token)

    // What the project's CSS settles without asking Tailwind.
    // A host binding's classes land on the component's own element.
    let hostClasses: OwnClasses | undefined
    const ownClassesOf = (site: { node: any }) =>
      hostBindingOf(site.node)
        ? (hostClasses ??= angularOwnClasses(context, filename, true))
        : ownClasses
    // A class on the element of a component the template uses may be one
    // that component's styles select on its host, `:host(.x)`. Finding the
    // component reads the template's scope, so it is asked only of a class
    // nothing else knows.
    const angular = readerFor(context) === angularReader
    const helpers = new Set([
      ...DEFAULT_MERGE_FUNCTIONS,
      ...(options.mergeFunctions ?? []),
    ])
    const hosts = new WeakMap<object, OwnClasses | null>()
    const hostedOn = (element: any) => {
      if (!hosts.has(element)) {
        const selector = selectorOf(element)
        const component =
          selector &&
          hostComponentOf(
            context.filename ?? filename,
            filename,
            selector,
            helpers
          )
        const classes =
          component && angularHostClassesOf(component.file, component.name)
        hosts.set(element, classes ? warnUnread(context, classes) : null)
      }
      return hosts.get(element)
    }
    const hostOf = (site: ClassSite) =>
      angular && site.element && ON_ELEMENT.has(site.attribute ?? "")
        ? (token: string) =>
            !!hostedOn(site.element)?.has(
              normalizeClass(token).replace(/\/[\w.%]+$/, "")
            )
        : () => false

    const settled = (token: string, own = ownClasses) => {
      const base = normalizeClass(token)
      if (!base) return true
      if (base.startsWith("[")) return true
      if (isMarkerClass(token)) return true
      const bare = base.replace(/\/[\w.%]+$/, "")
      return (
        known.classes.has(bare) || own.has(bare) || !!globalClasses?.has(bare)
      )
    }

    // Without Tailwind: the cn grammar plus @utility names.
    const knownByGrammar = (token: string) => {
      if (groupOf(token)) return true
      const bare = normalizeClass(token).replace(/\/[\w.%]+$/, "")
      if (known.utilities.has(bare)) return true
      return utilityPrefixes.some((prefix) => bare.startsWith(prefix))
    }

    const report = (
      node: any,
      token: string,
      suggestion: string | null,
      words: string | null,
      component: string,
      host: boolean,
      variantOnly = false
    ) => {
      emit(
        {
          node,
          messageId: suggestion
            ? host
              ? "unknownHostClassSuggest"
              : "unknownClassSuggest"
            : variantOnly
              ? "unknownVariant"
              : host
                ? "unknownHostClass"
                : "unknownClass",
          data: {
            className: token,
            component,
            file,
            suggestion: suggestion ?? "",
          },
          suggest: suggestion
            ? classSuggestions(
                node,
                context,
                token,
                [suggestion],
                "useSuggestion",
                "suggestion"
              )
            : undefined,
        },
        words
      )
    }

    const isColor = (token: string) => categoryOf(groupOf(token)) === "color"

    // Who owns a class the grammar files under a color that generates no
    // CSS: an undeclared token or a near-miss of one is no-raw-colors'
    // finding, a typo of another utility (text-smal) is this rule's.
    // no-raw-colors applies the same test, so it is reported once.
    let declared: ReturnType<typeof colorTokensFor> | undefined
    const ownsColorTypo = (token: string, suggestion: string | null) => {
      if (!suggestion || isColor(suggestion)) return false
      const value = colorValueOf(token)
      if (!value) return true
      declared ??= colorTokensFor(filename)
      return !declared || !didYouMean(value, declared)
    }

    return classSiteVisitors(context, options, (site) => {
      const own = ownClassesOf(site)
      const host = hostBindingOf(site.node) !== null
      const hosted = host ? () => false : hostOf(site)
      for (const { value, node } of site.vocabularyStrings) {
        const wordsFor = new Map<string, string | null>()
        const tokens = splitClasses(value).filter((token) => {
          if (settled(token, own)) return false
          const exemption = policy.decide(site.component, token)
          if (exemption.kind === "ok") return false
          wordsFor.set(token, exemption.message)
          return true
        })
        if (!tokens.length) continue
        // The worker tells a misspelled variant on a real color from a
        // utility that only looks like one, prefix and all.
        const asked = entry ? unknownClasses(entry, tokens) : null
        if (asked) {
          for (const { token, suggestion, baseKnown } of asked) {
            if (
              isTailwindColor(token) &&
              !baseKnown &&
              !ownsColorTypo(token, suggestion)
            )
              continue
            if (hosted(token)) continue
            report(
              node,
              token,
              suggestion,
              wordsFor.get(token) ?? null,
              site.component ?? "",
              host,
              baseKnown && token.includes(":")
            )
          }
          continue
        }
        for (const token of tokens) {
          if (!knownByGrammar(token) && !hosted(token))
            report(
              node,
              token,
              null,
              wordsFor.get(token) ?? null,
              site.component ?? "",
              host
            )
        }
      }
    })
  },
}

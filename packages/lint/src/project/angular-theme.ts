// An Angular app's Tailwind entry among its global stylesheets, the
// `styles` of angular.json or an Nx project.json. Angular's build hands
// each of them to Tailwind on its own, so the app's classes are those of
// the one that imports Tailwind together with the theme. A stylesheet
// that only imports Tailwind is not that one: `ng add tailwindcss` writes
// src/tailwind.css so, and spartan's CLI then writes the Tailwind imports,
// its preset and the theme into src/styles.scss.
//
// A Sass stylesheet is read as Tailwind's compiler reads it, as CSS, so
// it is taken only when nothing in it reads otherwise there: a `//`
// comment swallows what follows it, an interpolation breaks the rule it
// is in, `@use` and `@forward` load nothing, and a Sass partial cannot be
// imported. Such a stylesheet is said once, and the entry is found as
// before.

import * as fs from "node:fs"
import * as path from "node:path"

import { buildFailureOf } from "../tailwind/client"
import { isAngularFile } from "./angular-files"
import { angularProjectFor } from "./angular-workspace"
import { dirOf, memoize, mtimeOf } from "./fs"
import { parseImports, resolvesAsStylesheet, themeEntryRead } from "./theme"
import { warnOnce } from "./warn"

type Style = {
  file: string
  // Imports Tailwind, `tailwindcss` or one of its stylesheets, as
  // spartan's split theme.css and utilities.css.
  tailwind: boolean
  // Holds a theme for Tailwind, itself or through what it imports:
  // @theme, @plugin, @config, @utility or @custom-variant.
  theme: boolean
  tokens: number
  // Why Tailwind's compiler cannot read it as written.
  unread: string | null
}

type Analysis = {
  config: string
  // The styles of every project, for a file whose project names none.
  shared: boolean
  styles: Style[]
  // The global stylesheet that imports Tailwind with the theme.
  entry: Style | null
  // The others that do, which Tailwind builds on their own.
  rivals: Style[]
  // One that imports Tailwind but cannot be read as the entry, when no
  // other is.
  unread: Style | null
}

const LOADS_TAILWIND =
  /@(?:import|use|forward)\s+["']tailwindcss(?:\/[^"']*)?["']/
const SASS_LOADS_TAILWIND = /@(use|forward)\s+["']tailwindcss(?:\/[^"']*)?["']/
// A module Sass loads, which Tailwind's compiler keeps as written.
const SASS_MODULE =
  /@(use|forward)\s+["']([^"']+)["']|\b(meta\.load-css)\(\s*["']([^"']+)["']/g
const THEME_RULE = /@(?:theme|plugin|config|utility|custom-variant)\b/
const TAILWIND_FILE = /[\\/]node_modules[\\/]tailwindcss[\\/]/

function read(file: string) {
  try {
    return fs.readFileSync(file, "utf-8")
  } catch {
    return null
  }
}

// Block comments blanked, line breaks kept, so offsets and lines stay.
function withoutBlockComments(text: string) {
  return text.replace(/\/\*[\s\S]*?(?:\*\/|$)/g, (comment) =>
    comment.replace(/[^\n]/g, " ")
  )
}

const lineAt = (text: string, at: number) =>
  text.slice(0, at).split("\n").length

const CUSTOM_PROPERTY = /--[\w-]*\s*:/y

// The first `//` comment or `#{` interpolation outside strings and
// url(), in a text without block comments. Sass passes the value of a
// custom property through as written but for an interpolation, so a
// `//` there, `--docs: https://…`, is no comment.
function sassOnly(text: string) {
  // Where a value runs to the `;` or `}` that ends it.
  let custom = false
  let depth = 0
  let previous = ";"
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === '"' || c === "'") {
      i++
      while (i < text.length && text[i] !== c && text[i] !== "\n") {
        if (text[i] === "\\") i++
        i++
      }
    } else if (text.startsWith("url(", i)) {
      const end = text.indexOf(")", i)
      if (end === -1) break
      i = end
    } else if (c === "#" && text[i + 1] === "{") {
      return { kind: "interpolation" as const, at: i }
    } else if (custom) {
      if (c === "(" || c === "[" || c === "{") depth++
      else if ((c === ")" || c === "]" || c === "}") && depth) depth--
      else if (c === ";" || c === "}") custom = false
    } else if (c === "/" && text[i + 1] === "/") {
      return { kind: "comment" as const, at: i }
    } else if (c === "-" && (previous === ";" || previous === "{")) {
      CUSTOM_PROPERTY.lastIndex = i
      const name = CUSTOM_PROPERTY.exec(text)
      if (name) {
        custom = true
        depth = 0
        i += name[0].length - 1
      }
    }
    if (!/\s/.test(c)) previous = c
  }
  return null
}

function unreadOf(file: string, text: string): string | null {
  const extension = path.extname(file).toLowerCase()
  if (extension === ".css") return null
  if (extension !== ".scss") {
    return `it is written in ${extension === ".sass" ? "indented Sass" : extension === ".less" ? "Less" : `a ${extension} file`}`
  }
  const plain = withoutBlockComments(text)
  const use = SASS_LOADS_TAILWIND.exec(plain)
  if (use) {
    return `line ${lineAt(plain, use.index)} loads Tailwind with @${use[1]}, which only Sass follows`
  }
  const sass = sassOnly(plain)
  if (sass?.kind === "comment") {
    return `line ${lineAt(plain, sass.at)} has a // comment, which only Sass skips`
  }
  if (sass) {
    return `line ${lineAt(plain, sass.at)} has a Sass interpolation, #{…}`
  }
  // A built-in module, sass:math, holds no theme.
  for (const module of plain.matchAll(SASS_MODULE)) {
    const url = module[2] ?? module[4]
    if (url.startsWith("sass:")) continue
    return `line ${lineAt(plain, module.index)} loads "${url}" with ${module[1] ? `@${module[1]}` : module[3]}, which only Sass follows`
  }
  const dir = path.dirname(file)
  for (const spec of parseImports(text)) {
    // Tailwind loads its own stylesheets.
    if (spec === "tailwindcss" || spec.startsWith("tailwindcss/")) continue
    if (/^(?:https?:|data:)/.test(spec)) continue
    if (resolvesAsStylesheet(spec, dir)) continue
    const at = plain.indexOf(spec)
    return `line ${at === -1 ? 1 : lineAt(plain, at)} imports "${spec}", which names no stylesheet Tailwind can load, such as a Sass partial`
  }
  return null
}

function styleOf(file: string, root: string): Style | null {
  const text = read(file)
  if (text === null) return null
  const entry = themeEntryRead(file, root)
  const plain = withoutBlockComments(text)
  const tailwind = entry.tailwind || LOADS_TAILWIND.test(plain)
  let theme = THEME_RULE.test(plain)
  for (const imported of entry.files) {
    if (theme) break
    if (imported === file || TAILWIND_FILE.test(imported)) continue
    const css = read(imported)
    if (css !== null) theme = THEME_RULE.test(withoutBlockComments(css))
  }
  return {
    file,
    tailwind,
    theme,
    tokens: entry.tokens,
    unread: tailwind ? unreadOf(file, text) : null,
  }
}

// A Sass stylesheet that reads as CSS may still stop Tailwind's compiler,
// as an unclosed rule does, where the CSS entry found before builds. One
// whose Tailwind cannot be found says nothing of the stylesheet. Asked
// again when the file changes, or a few seconds on.
const builds = new Map<
  string,
  { at: number; mtime: number | null; failure: string | null }
>()
const REBUILD_AFTER = 5_000

function sassBuildFailure(file: string) {
  const mtime = mtimeOf(file)
  const known = builds.get(file)
  if (known && known.mtime === mtime && Date.now() - known.at < REBUILD_AFTER) {
    return known.failure
  }
  const reason = buildFailureOf(file)
  const failure =
    reason && !/^tailwindcss v4 could not be resolved/.test(reason)
      ? `building it stops with "${reason}"`
      : null
  builds.set(file, { at: Date.now(), mtime, failure })
  if (builds.size > 64) builds.delete(builds.keys().next().value!)
  return failure
}

function analyze(
  config: string,
  shared: boolean,
  files: string[],
  root: string
): Analysis {
  const styles = files
    .map((file) => styleOf(file, root))
    .filter((style): style is Style => style !== null)
  for (const style of styles) {
    if (!style.tailwind || !style.theme || style.unread) continue
    if (path.extname(style.file).toLowerCase() !== ".scss") continue
    style.unread = sassBuildFailure(style.file)
  }
  const themed = styles.filter(
    (style) => style.tailwind && style.theme && !style.unread
  )
  let entry: Style | null = null
  for (const style of themed) {
    if (!entry || style.tokens > entry.tokens) entry = style
  }
  const rivals = themed.filter((style) => style !== entry)
  const unread = entry
    ? null
    : (styles.find((style) => style.tailwind && style.unread) ?? null)
  return { config, shared, styles, entry, rivals, unread }
}

// Asked on every read of the theme, so answered once per directory for
// the duration of a lint burst.
function analysisFor(fromFile: string, root: string) {
  return memoize(`angular-entry:${dirOf(fromFile)}\u0000${root}`, () => {
    const project = angularProjectFor(fromFile)
    if (!project) return null
    const files = [
      ...new Set(
        project.styles.flatMap(({ file }) => (file ? [path.resolve(file)] : []))
      ),
    ]
    if (!files.length) return null
    const shared = project.shared === true
    return memoize(
      `angular-entry-styles:${project.config}\u0000${root}\u0000${shared}\u0000${files.join("\u0000")}`,
      () => analyze(project.config, shared, files, root)
    )
  })
}

const relativeTo = (root: string, file: string) =>
  path.relative(root, file).replace(/\\/g, "/")

// The global stylesheet that imports Tailwind with the theme, for an
// Angular file, and whether it is another project's: a library is styled
// by the apps that use it, and an app whose builder lists no styles, such
// as Analog's, imports its own. Null when there is none, or one that
// cannot be read as written: then the entry is found as for any project.
export function angularEntryFor(fromFile: string, root: string) {
  if (!isAngularFile(fromFile)) return null
  const analysis = analysisFor(fromFile, root)
  return analysis?.entry
    ? { file: analysis.entry.file, shared: analysis.shared }
    : null
}

// Whether a stylesheet holds a theme for Tailwind, itself or through what
// it imports.
export function holdsTheme(file: string, root: string) {
  return memoize(
    `angular-entry-theme:${file}\u0000${root}`,
    () => styleOf(file, root)?.theme ?? false
  )
}

// Whether the global stylesheet Tailwind is imported from cannot be read
// as written, which is said on its own.
export function angularEntryUnread(fromFile: string, root: string) {
  if (!isAngularFile(fromFile)) return false
  return Boolean(analysisFor(fromFile, root)?.unread)
}

// For an Angular file, once: the global stylesheet that imports Tailwind
// cannot be read as the entry, unless the settings or components.json
// name one, or the stylesheet the theme is read from holds none while
// another global stylesheet does.
export function checkAngularTheme(
  fromFile: string,
  root: string,
  themeFile: string | null,
  named: boolean
) {
  if (!isAngularFile(fromFile)) return
  const analysis = analysisFor(fromFile, root)
  if (!analysis) return
  memoize(
    `angular-entry-check:${analysis.config}\u0000${dirOf(fromFile)}\u0000${root}\u0000${themeFile}\u0000${named}`,
    () => {
      warnAbout(analysis, root, themeFile, named)
      return true
    }
  )
}

function warnAbout(
  analysis: Analysis,
  root: string,
  themeFile: string | null,
  named: boolean
) {
  const config = relativeTo(root, analysis.config)
  if (analysis.unread && !named) {
    const { file, theme, unread } = analysis.unread
    warnOnce(
      `angular-entry-unread:${file}`,
      `${relativeTo(root, file)} imports Tailwind${theme ? " and holds the theme" : ""}, but Tailwind's compiler cannot read it as written: ${unread}. ${
        themeFile
          ? `The theme is read from ${relativeTo(root, themeFile)} instead.`
          : "So no-unknown-classes reads classes with the grammar bundled with @shadcn/lint, and the project's theme is not read."
      } Import Tailwind and the theme from a CSS file among the styles of ${config}, or set settings.shadcn.entryPoint to one.`
    )
    return
  }
  if (!themeFile) return
  if (
    !named &&
    analysis.rivals.length &&
    [analysis.entry, ...analysis.rivals].some((s) => s?.file === themeFile)
  ) {
    warnRivals(analysis, root, config, themeFile)
    return
  }
  if (named) {
    const text = read(themeFile)
    const unread = text === null ? null : unreadOf(themeFile, text)
    if (unread) {
      warnOnce(
        `angular-entry-named-unread:${themeFile}`,
        `${relativeTo(root, themeFile)}, the Tailwind entry the settings or components.json name, is read as Tailwind's compiler reads it, as CSS, and it cannot be read so as written: ${unread}. What follows there is misread. Import Tailwind and the theme from a CSS file, and name that instead.`
      )
      return
    }
  }
  const own = analysis.styles.find((style) => style.file === themeFile)
  const themed = own ?? styleOf(themeFile, root)
  if (!themed || themed.theme) return
  const elsewhere = analysis.styles.find(
    (style) => style.theme && style.file !== themeFile
  )
  if (!elsewhere) return
  warnOnce(
    `angular-entry-theme:${themeFile}:${elsewhere.file}`,
    `The theme is read from ${relativeTo(root, themeFile)}, which holds no @theme, @plugin, @utility or @custom-variant, while ${relativeTo(root, elsewhere.file)} among the styles of ${config} does. Tailwind builds each global stylesheet on its own, so the app's classes come from the one that imports Tailwind with the theme: ${
      elsewhere.tailwind && !elsewhere.unread
        ? `set settings.shadcn.entryPoint to ${relativeTo(root, elsewhere.file)}.`
        : "import both from one stylesheet, and set settings.shadcn.entryPoint to it if it is not found."
    }`
  )
}

const listed = (names: string[]) =>
  names.length > 2
    ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`
    : names.join(" and ")

// Of several global stylesheets that import Tailwind with a theme, the
// app's classes are one's: the one that declares the most tokens is
// taken, and that is said once. A project that names none of its own
// takes them from every project, the theme found under its package
// first, and which app it is built for is written nowhere the linter
// reads.
function warnRivals(
  analysis: Analysis,
  root: string,
  config: string,
  themeFile: string
) {
  const files = analysis.styles
    .filter(
      (style) => style === analysis.entry || analysis.rivals.includes(style)
    )
    .map((style) => relativeTo(root, style.file))
  const chosen = relativeTo(root, themeFile)
  warnOnce(
    `angular-entry-rivals:${analysis.shared}:${chosen}:${files.join("\u0000")}`,
    analysis.shared
      ? `A project that names no global styles of its own, as a library styled by the apps that use it, takes those of every project in the workspace, and ${listed(files)} among them each import Tailwind with a theme. The theme of its files is read from ${chosen}. Set settings.shadcn.entryPoint to the entry of the app it is built for.`
      : `${listed(files)} among the styles of ${config} each import Tailwind with a theme, and Tailwind builds each on its own. The theme is read from ${chosen}, which declares the most tokens. Set settings.shadcn.entryPoint to the one the app's classes come from.`
  )
}

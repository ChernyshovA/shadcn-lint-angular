// The Angular project a file belongs to, as its workspace configures it:
// angular.json, or an Nx workspace's project.json files. A project's
// global stylesheets are the `styles` of the targets that build it
// (`architect` in angular.json), a path or { input } from the workspace
// root, and its `stylePreprocessorOptions.includePaths` serve every Sass
// import.

import * as fs from "node:fs"
import * as path from "node:path"

import { dirOf, findUp, isFile, memoize, mtimeOf } from "./fs"
import { readJsonc } from "./resolve"
import { warnOnce } from "./warn"

export type AngularProject = {
  // angular.json, or the project.json of an Nx project.
  config: string
  root: string
  // Stylesheets as a config writes them, the file a path names, and the
  // workspace root a package name resolves from (angular-styles.ts).
  styles: { input: string; file: string | null; config: string; dir: string }[]
  includes: string[]
  // The styles of every project, for one that names none of its own.
  shared?: boolean
}

type Workspace = {
  config: string
  dir: string
  projects: AngularProject[]
  // Whether the scan for project.json files stopped short of a directory
  // too deep to enter.
  deep: boolean
}

const SKIP_DIRS = new Set(["node_modules", "dist", "build", "coverage", "tmp"])

// How far an Nx workspace is scanned for project.json files.
const MAX_SCAN_DEPTH = 5
const MAX_PROJECT_FILES = 500

type Scan = { files: string[]; deep: boolean; many: boolean }

function projectFiles(dir: string, depth: number, scan: Scan) {
  if (depth > MAX_SCAN_DEPTH) {
    scan.deep = true
    return
  }
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (scan.many) return
    if (entry.name.startsWith(".")) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) projectFiles(full, depth + 1, scan)
    } else if (entry.name === "project.json") {
      if (scan.files.length >= MAX_PROJECT_FILES) scan.many = true
      else scan.files.push(full)
    }
  }
}

// A style entry that names a file from the workspace root. Any other is
// a package's, read as a stylesheet by angular-styles.ts.
function resolveStyle(dir: string, input: string) {
  const file = path.resolve(dir, input)
  return isFile(file) ? file : null
}

// A target that runs tests, whose styles only its test bed loads.
const TEST_RUNNER = /karma|jest|vitest|test/i

const ANGULAR_BUILDER = /angular|ngx-build-plus/

const isObject = (value: unknown): value is Record<string, any> =>
  !!value && typeof value === "object" && !Array.isArray(value)

// What a config holds where Angular takes something else is skipped, by
// where it is, so that it is said once and the rest is read.
type Skipped = string[]

function projectOf(
  config: string,
  dir: string,
  root: string,
  json: any,
  skipped: Skipped,
  at: string,
  angularOnly = false
): AngularProject {
  const styles: AngularProject["styles"] = []
  const includes = new Set<string>()
  const key = json?.architect !== undefined ? "architect" : "targets"
  const targets = json?.[key]
  if (targets !== undefined && !isObject(targets)) {
    skipped.push(`${at}${key} (not an object)`)
  }
  for (const [name, target] of Object.entries(
    isObject(targets) ? targets : {}
  )) {
    // An Nx workspace also holds React or Node projects, whose styles
    // this file does not speak for.
    const builder = String(target?.builder ?? target?.executor ?? "")
    if (angularOnly && !ANGULAR_BUILDER.test(builder)) continue
    if (name === "test" || TEST_RUNNER.test(builder)) continue
    const options = target?.options
    const where = `${at}${key}.${name}.options`
    if (options?.styles !== undefined && !Array.isArray(options.styles)) {
      skipped.push(`${where}.styles (not a list)`)
    }
    const entries = Array.isArray(options?.styles) ? options.styles : []
    entries.forEach((entry: any, i: number) => {
      const input = typeof entry === "string" ? entry : entry?.input
      if (typeof input !== "string") {
        skipped.push(`${where}.styles[${i}] (not a path or { input })`)
        return
      }
      if (styles.some((s) => s.input === input)) return
      styles.push({ input, file: resolveStyle(dir, input), config, dir })
    })
    const paths = options?.stylePreprocessorOptions?.includePaths
    if (paths !== undefined && !Array.isArray(paths)) {
      skipped.push(
        `${where}.stylePreprocessorOptions.includePaths (not a list)`
      )
    }
    ;(Array.isArray(paths) ? paths : []).forEach((include: any, i: number) => {
      if (typeof include === "string") includes.add(path.resolve(dir, include))
      else
        skipped.push(
          `${where}.stylePreprocessorOptions.includePaths[${i}] (not a string)`
        )
    })
  }
  return { config, root, styles, includes: [...includes] }
}

let workspaceReads = 0

// How many times a workspace config was read, for tests.
export function workspaceReadsForTests() {
  return workspaceReads
}

function readWorkspace(config: string, skipped: Skipped): Workspace {
  workspaceReads++
  const dir = path.dirname(config)
  if (path.basename(config) === "angular.json") {
    const json = readJsonc(config, { bom: true })
    if (!isObject(json)) throw new Error("it is not a JSON object")
    const projects: AngularProject[] = []
    if (json.projects !== undefined && !isObject(json.projects)) {
      skipped.push("projects (not an object)")
    }
    for (const [name, project] of Object.entries(
      isObject(json.projects) ? json.projects : {}
    )) {
      const at = `projects.${name}.`
      // Nx's own angular.json names a project by its directory, a string
      // this file does not read; one that is no object holds no root, and
      // taking the workspace's for it would make every file its.
      if (!isObject(project)) {
        skipped.push(`projects.${name} (not an object)`)
        continue
      }
      const root = project.root ?? ""
      if (typeof root !== "string") {
        skipped.push(`${at}root (not a string)`)
        continue
      }
      projects.push(
        projectOf(config, dir, path.resolve(dir, root), project, skipped, at)
      )
    }
    return { config, dir, projects, deep: false }
  }
  const scan: Scan = { files: [], deep: false, many: false }
  projectFiles(dir, 0, scan)
  if (scan.many) {
    warnOnce(
      `angular-workspace-many:${config}`,
      `${shownPath(config)} is an Nx workspace with more than ${MAX_PROJECT_FILES} project.json files. Those past the first ${MAX_PROJECT_FILES} are not read, nor the global styles their projects name.`
    )
  }
  const projects: AngularProject[] = []
  for (const file of scan.files.sort()) {
    const json = readJsonc(file, { bom: true })
    const at = path.relative(dir, file).replace(/\\/g, "/")
    if (!isObject(json)) {
      skipped.push(`${at} (not a JSON object)`)
      continue
    }
    projects.push(
      projectOf(file, dir, path.dirname(file), json, skipped, `${at}: `, true)
    )
  }
  return { config, dir, projects, deep: scan.deep }
}

// A config as a warning names it: from the working directory when it is
// under it.
function shownPath(config: string) {
  const relative = path.relative(process.cwd(), config)
  return (relative.startsWith("..") ? config : relative).replace(/\\/g, "/")
}

const workspaces = new Map<
  string,
  { at: number; stamp: number | null; workspace: Workspace }
>()
const WORKSPACE_TTL = 5000

function workspaceFor(fromFile: string) {
  const dir = dirOf(fromFile)
  const config = findUp(dir, "angular.json") ?? findUp(dir, "nx.json")
  if (!config) return null
  // An Nx workspace is rescanned every few seconds, so a project.json
  // added or changed mid-session is picked up.
  const stamp = mtimeOf(config)
  const cached = workspaces.get(config)
  if (
    cached &&
    cached.stamp === stamp &&
    Date.now() - cached.at < WORKSPACE_TTL
  ) {
    return cached.workspace
  }
  const skipped: Skipped = []
  const where = shownPath(config)
  let workspace: Workspace
  try {
    workspace = readWorkspace(config, skipped)
  } catch (error) {
    // Whatever else a config holds, linting goes on without it.
    warnOnce(
      `angular-workspace:${config}`,
      `${where} cannot be read: ${error instanceof Error ? error.message : String(error)}. The global styles it names are not read.`
    )
    workspace = {
      config,
      dir: path.dirname(config),
      projects: [],
      deep: false,
    }
  }
  if (skipped.length) {
    warnOnce(
      `angular-workspace:${config}`,
      `${where} has fields that are not read, since they are not what Angular takes there: ${skipped.join(", ")}.`
    )
  }
  workspaces.set(config, { at: Date.now(), stamp, workspace })
  return workspace
}

// A file whose own project.json lies deeper than an Nx workspace is
// scanned: its project's styles are not read, and that is said once.
function warnUnscanned(workspace: Workspace, file: string) {
  const own = findUp(path.dirname(file), "project.json")
  if (!own || !within(workspace.dir, own)) return
  // One added since the last scan is read with the next.
  const depth = path
    .relative(workspace.dir, path.dirname(own))
    .split(/[\\/]/)
    .filter(Boolean).length
  if (depth <= MAX_SCAN_DEPTH) return
  warnOnce(
    `angular-workspace-deep:${own}`,
    `${shownPath(own)} is more than ${MAX_SCAN_DEPTH} directories below ${shownPath(workspace.config)}, past where an Nx workspace is read, so the global styles its project names are not read.`
  )
}

const within = (root: string, file: string) => {
  const relative = path.relative(root, file)
  return !relative.startsWith("..") && !path.isAbsolute(relative)
}

// Whether a project holds a file: under its root, and, for one rooted at
// the workspace, as `ng new` writes it ("root": ""), not in a package of
// its own below it, such as a React app beside the Angular one with its
// own package.json.
function holds(workspace: Workspace, project: AngularProject, file: string) {
  if (!within(project.root, file)) return false
  if (project.root !== workspace.dir) return true
  const own = findUp(path.dirname(file), "package.json")
  return (
    !own || path.dirname(own) === workspace.dir || !within(workspace.dir, own)
  )
}

// Whether an Nx project.json is an Angular project's: a target an
// Angular builder or executor runs, or the `prefix` of its components'
// selectors, which Nx's Angular generators write for an application and
// for a library, one that is not buildable having no target of
// Angular's.
function isAngularProjectJson(json: any) {
  if (!isObject(json)) return false
  if (typeof json.prefix === "string") return true
  const targets = json.architect !== undefined ? json.architect : json.targets
  return (
    isObject(targets) &&
    Object.values(targets).some((target: any) =>
      ANGULAR_BUILDER.test(String(target?.builder ?? target?.executor ?? ""))
    )
  )
}

// A directory the scan for project.json files does not enter.
const unscanned = (relative: string) =>
  relative
    .split(/[\\/]/)
    .some((part) => part.startsWith(".") || SKIP_DIRS.has(part))

// The nearest project.json above a directory, up to the workspace's,
// and whether it is an Angular project's.
function inAngularNxProject(dir: string, top: string) {
  return memoize(`angular-nx-project:${dir}`, () => {
    for (let at = dir; within(top, at); at = path.dirname(at)) {
      const file = path.join(at, "project.json")
      if (isFile(file) && !unscanned(path.relative(top, at))) {
        return isAngularProjectJson(readJsonc(file, { bom: true }))
      }
      if (at === top || path.dirname(at) === at) break
    }
    return false
  })
}

// Whether a file lies in an Angular project: under the root of a project
// of angular.json, short of a package of its own below a root project,
// or of the nearest Nx project.json when that one is Angular's, so a
// React app beside an Angular one, or inside it, is its own. In an Nx
// workspace only the project.json files above the file are read, not the
// workspace, and as deep as the file lies.
export function inAngularProject(fromFile: string) {
  const dir = dirOf(fromFile)
  const config = findUp(dir, "angular.json") ?? findUp(dir, "nx.json")
  if (!config) return false
  if (path.basename(config) === "nx.json") {
    return inAngularNxProject(dir, path.dirname(config))
  }
  const file = path.resolve(fromFile)
  const workspace = workspaceFor(fromFile)
  return !!workspace?.projects.some((project) =>
    holds(workspace, project, file)
  )
}

// The project whose root holds the file, the deepest one. A library
// that names no global styles of its own is styled by the applications
// that use it, so its file sees every project's.
export function angularProjectFor(fromFile: string): AngularProject | null {
  const workspace = workspaceFor(fromFile)
  if (!workspace) return null
  const file = path.resolve(fromFile)
  if (workspace.deep) warnUnscanned(workspace, file)
  let own: AngularProject | null = null
  for (const project of workspace.projects) {
    if (!holds(workspace, project, file)) continue
    if (!own || project.root.length > own.root.length) own = project
  }
  if (own?.styles.length) return own
  const styles: AngularProject["styles"] = []
  const includes = new Set<string>(own?.includes ?? [])
  for (const project of workspace.projects) {
    for (const style of project.styles) {
      if (!styles.some((s) => s.input === style.input && s.file === style.file))
        styles.push(style)
    }
    for (const include of project.includes) includes.add(include)
  }
  if (!styles.length && !own) return null
  return {
    config: own?.config ?? workspace.config,
    root: own?.root ?? workspace.dir,
    styles,
    includes: [...includes],
    shared: true,
  }
}

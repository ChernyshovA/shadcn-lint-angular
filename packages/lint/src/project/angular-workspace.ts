// The Angular project a file belongs to, as its workspace configures it:
// angular.json, or an Nx workspace's project.json files. A project's
// global stylesheets are the `styles` of its targets (`architect` in
// angular.json), a path or { input } from the workspace root, and its
// `stylePreprocessorOptions.includePaths` serve every Sass import.

import * as fs from "node:fs"
import { createRequire } from "node:module"
import * as path from "node:path"

import { dirOf, findUp, isFile, mtimeOf } from "./fs"
import { readJsonc } from "./resolve"

export type AngularProject = {
  // angular.json, or the project.json of an Nx project.
  config: string
  root: string
  // Stylesheets as a config writes them, and where they resolve.
  styles: { input: string; file: string | null; config: string }[]
  includes: string[]
}

type Workspace = { config: string; dir: string; projects: AngularProject[] }

const SKIP_DIRS = new Set(["node_modules", "dist", "build", "coverage", "tmp"])

function projectFiles(dir: string, depth: number, out: string[]) {
  if (depth > 5 || out.length > 500) return
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) projectFiles(full, depth + 1, out)
    } else if (entry.name === "project.json") {
      out.push(full)
    }
  }
}

// Angular resolves a style entry from the workspace root, then as a
// package.
function resolveStyle(dir: string, input: string) {
  const file = path.resolve(dir, input)
  if (isFile(file)) return file
  try {
    return createRequire(path.join(dir, "package.json")).resolve(input)
  } catch {
    return null
  }
}

const ANGULAR_BUILDER = /angular|ngx-build-plus/

function projectOf(
  config: string,
  dir: string,
  root: string,
  json: any,
  angularOnly = false
): AngularProject {
  const styles: AngularProject["styles"] = []
  const includes = new Set<string>()
  const targets = json?.architect ?? json?.targets
  for (const target of Object.values(targets ?? {}) as any[]) {
    // An Nx workspace also holds React or Node projects, whose styles
    // this file does not speak for.
    const builder = target?.builder ?? target?.executor
    if (angularOnly && !ANGULAR_BUILDER.test(builder ?? "")) continue
    const options = target?.options
    const entries = Array.isArray(options?.styles) ? options.styles : []
    for (const entry of entries) {
      const input = typeof entry === "string" ? entry : entry?.input
      if (typeof input !== "string" || styles.some((s) => s.input === input)) {
        continue
      }
      styles.push({ input, file: resolveStyle(dir, input), config })
    }
    const paths = options?.stylePreprocessorOptions?.includePaths
    for (const include of Array.isArray(paths) ? paths : []) {
      if (typeof include === "string") includes.add(path.resolve(dir, include))
    }
  }
  return { config, root, styles, includes: [...includes] }
}

function readWorkspace(config: string): Workspace {
  const dir = path.dirname(config)
  if (path.basename(config) === "angular.json") {
    const json = readJsonc(config)
    const projects = Object.values(json?.projects ?? {}).map((project: any) =>
      projectOf(config, dir, path.resolve(dir, project?.root ?? ""), project)
    )
    return { config, dir, projects }
  }
  const files: string[] = []
  projectFiles(dir, 0, files)
  const projects = files
    .sort()
    .map((file) =>
      projectOf(file, dir, path.dirname(file), readJsonc(file), true)
    )
  return { config, dir, projects }
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
  const workspace = readWorkspace(config)
  workspaces.set(config, { at: Date.now(), stamp, workspace })
  return workspace
}

const within = (root: string, file: string) => {
  const relative = path.relative(root, file)
  return !relative.startsWith("..") && !path.isAbsolute(relative)
}

// The project whose root holds the file, the deepest one. A library
// that names no global styles of its own is styled by the applications
// that use it, so its file sees every project's.
export function angularProjectFor(fromFile: string): AngularProject | null {
  const workspace = workspaceFor(fromFile)
  if (!workspace) return null
  const file = path.resolve(fromFile)
  let own: AngularProject | null = null
  for (const project of workspace.projects) {
    if (!within(project.root, file)) continue
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
  }
}

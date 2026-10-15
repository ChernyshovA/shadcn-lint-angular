// Copies the root README and LICENSE into the package for publishing.
// Relative links are rewritten to raw GitHub URLs: npm resolves them
// against the repository directory, where they do not exist, and the
// tarball carries no assets of its own.
import * as fs from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"

const RAW =
  "https://raw.githubusercontent.com/ChernyshovA/shadcn-lint-angular/main/"

const PKG_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const ROOT = path.resolve(PKG_DIR, "../..")

const readme = fs
  .readFileSync(path.join(ROOT, "README.md"), "utf-8")
  .replace(
    /(src|href)="\.\/([^"]+)"/g,
    (_, attribute, file) => `${attribute}="${RAW}${file}"`
  )
  .replace(/\]\(\.\/([^)]+)\)/g, (_, file) => `](${RAW}${file})`)

fs.writeFileSync(path.join(PKG_DIR, "README.md"), readme)
fs.copyFileSync(path.join(ROOT, "LICENSE"), path.join(PKG_DIR, "LICENSE"))

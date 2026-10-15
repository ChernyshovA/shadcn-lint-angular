// An editor's ESLint server keeps running while the compiler is
// installed.

import { expect, it, vi } from "vitest"

const installed = vi.hoisted(() => ({ compiler: null as any }))

// Nothing installed but what a test puts there.
vi.mock("node:module", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:module")>()
  const createRequire = () => {
    const require: any = (id: string) => {
      if (
        id === "@angular-eslint/bundled-angular-compiler" &&
        installed.compiler
      )
        return installed.compiler
      throw new Error(`Cannot find module '${id}'`)
    }
    require.resolve = (id: string) => {
      throw new Error(`Cannot find module '${id}'`)
    }
    return require
  }
  return { ...real, default: { ...real, createRequire }, createRequire }
})

const { angularCompiler } =
  await import("../src/sites/readers/angular-compiler")

it("looks for a compiler again a while after it found none", () => {
  vi.useFakeTimers()
  try {
    expect(angularCompiler("/app/src/a.html")).toBeNull()
    installed.compiler = { makeBindingParser() {} }
    // Within a lint burst, the same directory is not looked in again.
    expect(angularCompiler("/app/src/b.html")).toBeNull()
    vi.advanceTimersByTime(5001)
    expect(angularCompiler("/app/src/c.html")).toBe(installed.compiler)
    // Found, it stays.
    installed.compiler = null
    vi.advanceTimersByTime(60_000)
    expect(angularCompiler("/app/src/d.html")).not.toBeNull()
  } finally {
    vi.useRealTimers()
  }
})

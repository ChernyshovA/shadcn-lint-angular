// A test stands in a compiler for angular-compiler.ts, or its absence
// with null; undefined puts the real one back. Each test file that uses
// it mocks the module with `mockAngularCompiler`.

const stub: { compiler: any } = { compiler: undefined }

export function setAngularCompilerForTests(compiler: any) {
  stub.compiler = compiler
}

export async function mockAngularCompiler(
  importOriginal: () => Promise<
    typeof import("../src/sites/readers/angular-compiler")
  >
) {
  const real = await importOriginal()
  return {
    ...real,
    angularCompiler: (file: string | null | undefined) =>
      stub.compiler !== undefined ? stub.compiler : real.angularCompiler(file),
  }
}

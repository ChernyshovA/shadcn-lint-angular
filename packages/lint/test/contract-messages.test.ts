import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

import { resetWarnings, setWarningSink } from "../src/project/warn"
import { compileContracts } from "../src/rules/contracts"
import { checkMessage, reporter } from "../src/rules/messages"
import { PAGE } from "./helpers"

const warnings: string[] = []

beforeEach(() => {
  warnings.length = 0
  resetWarnings()
  setWarningSink((message) => warnings.push(message))
})

afterEach(() => {
  resetWarnings()
  setWarningSink((message) => console.warn(message))
})

describe("contract message validation", () => {
  test("warns at compilation without changing the verdict or literal typo", () => {
    const contracts = compileContracts(
      [
        {
          pattern: "^Button$",
          allow: ["layout"],
          deny: ["w-*"],
          message: "Use {{varaints|none}} for {{component}}.",
        },
      ],
      { fromFile: PAGE }
    )

    expect(warnings).toEqual([
      '[shadcn-lint-angular] Unknown message placeholder "{{varaints}}" in contract "^Button$". Did you mean "{{variants}}"? It will remain literal.',
    ])

    const verdict = contracts.decide("Button", "w-full")
    expect(verdict.kind).toBe("denied")
    expect(contracts.decide("Button", "mt-4")).toEqual({ kind: "ok" })
    if (verdict.kind === "ok") {
      throw new Error("Expected a finding")
    }
    const report = vi.fn()
    reporter({ report }, {})(
      {
        messageId: "deniedClass",
        data: { component: "Button", variants: "default, outline" },
      },
      verdict.message
    )
    expect(report.mock.calls[0][0].message).toBe(
      "Use {{varaints|none}} for Button."
    )
  })

  test("checks table values once per pattern and key across compiled options", () => {
    compileContracts([
      {
        pattern: "^NeverRendered$",
        message: {
          color: "Use {{varaints}}.",
          default: "Choose {{varaints|none}}.",
        },
      },
    ])
    compileContracts([
      { pattern: "^NeverRendered$", message: "Select {{varaints}}." },
    ])
    expect(warnings).toHaveLength(1)

    compileContracts([
      { pattern: "^AnotherComponent$", message: "Select {{varaints}}." },
    ])
    expect(warnings).toHaveLength(2)
    expect(warnings[1]).toContain('contract "^AnotherComponent$"')
  })

  test("accepts supported slots, literal text, and ambiguous near matches", () => {
    checkMessage(
      "{{component}} {{className}} {{category}} {{variants}} {{file}} " +
        "{{wrapper}} {{sizes|none}} {{entries|none}} " +
        "{{around}} {{where}} {{variantsSuffix}} " +
        "{{example}} {{nope|x}} {{literal braces}} {{sire}}",
      "^Button$"
    )
    // "sire" is equally close to "file" and "sizes".
    expect(warnings).toEqual([])
  })

  test("recognizes placeholder whitespace and suggests the correct case", () => {
    checkMessage("Choose {{ Variants | none }}.", "^Button$")
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('"{{Variants}}"')
    expect(warnings[0]).toContain('Did you mean "{{variants}}"?')
  })
})

describe("literal message placeholders", () => {
  test("keeps inherited names literal", () => {
    const report = vi.fn()
    const message = "{{constructor}} {{toString}} {{__proto__}} {{unknown|x}}"
    reporter({ report }, {})(
      { messageId: "appearanceClass", data: { component: "Button" } },
      message
    )
    expect(report.mock.calls[0][0].message).toBe(message)
  })

  test("fills own slots and empty fallbacks while absent slots stay literal", () => {
    const report = vi.fn()
    reporter({ report }, {})(
      {
        messageId: "appearanceClass",
        data: {
          component: "Button",
          variants: "",
          wrapper: null,
          around: "use gap on the parent",
          where: "in the component",
          variantsSuffix: "",
        },
      },
      "{{component}} {{variants|none}} {{wrapper|direct}} " +
        "{{sizes|none}} {{entries|none}} {{around}} {{where}}{{variantsSuffix}}"
    )
    expect(report.mock.calls[0][0].message).toBe(
      "Button none direct {{sizes|none}} {{entries|none}} " +
        "use gap on the parent in the component"
    )
  })
})

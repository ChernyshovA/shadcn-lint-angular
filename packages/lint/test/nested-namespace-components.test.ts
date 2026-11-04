import { describe, test } from "vitest"

import { noRestyle } from "../src/rules/no-restyle"
import { createTester, PAGE } from "./helpers"

const tester = createTester()
const rule = noRestyle as any
const kit = `import * as UI from "@/components/kit"`

// A component reached through two namespace levels gets the same
// findings as the one-level form.
describe("nested namespace components", () => {
  test("<UI.Button.Button> is judged as Button", () => {
    tester.run("no-restyle", rule, {
      valid: [
        {
          filename: PAGE,
          code: `${kit}\nexport const A = () => <UI.Button.Button className="mt-4">Go</UI.Button.Button>`,
          options: [{ allow: ["layout"] }],
        },
      ],
      invalid: [
        {
          filename: PAGE,
          code: `${kit}\nexport const A = () => <UI.Button.Button className="bg-primary">Go</UI.Button.Button>`,
          options: [{ allow: ["layout"] }],
          errors: [{ messageId: "appearanceClassWithVariants" }],
        },
        {
          filename: PAGE,
          code: `${kit}\nexport const A = () => <UI.Dialog.DialogTrigger className="bg-primary">Go</UI.Dialog.DialogTrigger>`,
          options: [{ allow: ["layout"] }],
          errors: 1,
        },
      ],
    })
  })
})

import { describe, expect, it } from "vitest"

import { lintSfc, summarize, SVELTE_PAGE } from "./sfc-helpers"

const script = (body = "") => `<script lang="ts">
  import * as Card from "$lib/components/ui/card";
  import { Button } from "$lib/components/ui/button";
  import { cn } from "$lib/utils";
  let { active, tone, class: className, ...restProps } = $props();
  ${body}
</script>
`

const lint = (markup: string, body?: string) =>
  lintSfc(script(body) + markup, SVELTE_PAGE)

const found = (markup: string, body?: string) =>
  lint(markup, body).map((m) => `${m.ruleId}: ${m.message.split(".")[0]}`)

describe("Svelte templates", () => {
  it("reads an SVG color attribute spelled with a hyphen", () => {
    expect(
      found(
        `<svg><stop stop-color="#ff0000" /><feFlood flood-color="red" /></svg>`
      )
    ).toEqual([
      `shadcn/no-raw-colors: stop-color="#ff0000" hardcodes a color`,
      `shadcn/no-raw-colors: flood-color="red" hardcodes a color`,
    ])
  })

  it("reports the probe from the issue the way a .tsx file does", () => {
    const messages = lint(
      `<div class="bg-red-50 text-red-800 p-[13px]" style="color: red">x</div>`
    )
    expect(messages.map((m) => m.ruleId)).toEqual([
      "shadcn/no-raw-colors",
      "shadcn/no-raw-colors",
      "shadcn/no-arbitrary-values",
      "shadcn/no-inline-styles",
    ])
  })

  it("names a component after its file, through a namespace import", () => {
    expect(found(`<Card.Title class="text-2xl">Hi</Card.Title>`)).toEqual([
      `shadcn/no-restyle: "text-2xl" is not allowed on <CardTitle>: <CardTitle> owns its typography`,
    ])
    const [message] = lint(`<Card.Title class="text-2xl">Hi</Card.Title>`)
    expect(message.message).toContain(
      "src/lib/components/ui/card/card-title.svelte"
    )
  })

  it("lists the sizes a tv() in the module script declares", () => {
    const [message] = lint(`<Button class="p-4">x</Button>`)
    expect(message.ruleId).toBe("shadcn/no-restyle")
    expect(message.message).toContain("Use a size (default, sm, lg)")
    expect(message.message).toContain(
      "src/lib/components/ui/button/button.svelte"
    )
  })

  it("allows layout on a component and variants by prop", () => {
    expect(
      found(
        `<Card.Root class="mt-4 flex"><Button variant="link">x</Button></Card.Root>`
      )
    ).toEqual([])
  })

  it("reads text and mustache parts as one template", () => {
    expect(
      found(
        `<Card.Root class="mt-4 {active ? 'bg-primary' : ''}">x</Card.Root>`
      )
    ).toEqual([
      `shadcn/no-restyle: "bg-primary" is not allowed on <Card>: <Card> owns its color`,
    ])
    // A glued interpolation is not a class anyone wrote.
    expect(found(`<Card.Root class="p-{tone}">x</Card.Root>`)).toEqual([
      "shadcn/require-static-classes: Dynamically built className on <Card> cannot be checked",
    ])
  })

  it("resolves an identifier in the template to the script", () => {
    expect(
      found(
        `<Card.Content class={cn(base, "flex")}>x</Card.Content>`,
        `const base = "text-lg";`
      )
    ).toEqual([
      `shadcn/no-restyle: "text-lg" is not allowed on <CardContent>: <CardContent> owns its typography`,
    ])
  })

  it("reads arrays and objects the way clsx does", () => {
    expect(
      found(
        `<div class={["flex", active && "text-[#123456]", { "bg-red-500": active }]}></div>`
      )
    ).toEqual([
      `shadcn/no-arbitrary-values: "text-[#123456]" hardcodes a color and no declared theme color is close to it`,
      `shadcn/no-raw-colors: "bg-red-500" uses the raw Tailwind palette`,
    ])
  })

  it("reads class: directives", () => {
    expect(found(`<Button class:bg-primary={active}>x</Button>`)).toEqual([
      `shadcn/no-restyle: "bg-primary" is not allowed on <Button>: <Button> owns its color`,
    ])
    expect(found(`<div class:flex={active}></div>`)).toEqual([])
  })

  it("reads style attributes and style: directives", () => {
    expect(
      found(
        `<div style="color: red; --tone: #fff; --size: {tone}px" style:background-color={tone} style:--chart={"#123456"} style:--gap={tone}></div>`
      )
    ).toEqual([
      "shadcn/no-inline-styles: Inline style sets color",
      "shadcn/no-inline-styles: Custom property --tone hardcodes a color",
      "shadcn/no-inline-styles: Inline style sets background-color",
      "shadcn/no-inline-styles: Custom property --chart hardcodes a color",
    ])
  })

  it("accepts a color function over one theme variable", () => {
    expect(
      found(
        `<svg><path fill="oklch(var(--primary-oklch))" stroke="oklch(var(--border-oklch) / 0.2)" /></svg><div style="--tone: oklch(var(--ct-oklch)); --edge: oklch(var(--x, 0.5 0.1 200))"></div>`
      )
    ).toEqual([
      "shadcn/no-inline-styles: Custom property --edge hardcodes a color",
    ])
  })

  it("keeps a ; inside a quoted or parenthesized style value", () => {
    expect(
      found(
        `<div style="--label: 'x; color: red'; background: url(data:image/png;base64,AAAA); --tone: #fff"></div>`
      )
    ).toEqual([
      "shadcn/no-inline-styles: Inline style sets background",
      "shadcn/no-inline-styles: Custom property --tone hardcodes a color",
    ])
  })

  it("accepts the received class prop and a forwarded spread", () => {
    expect(
      found(`<Button class={cn("mt-2", className)} {...restProps}>x</Button>`)
    ).toEqual([])
  })

  it("reads a shorthand attribute the way its long form is read", () => {
    const body = `const contentClass = "text-lg";`
    const long = found(
      `<Card.Content contentClass={contentClass}>x</Card.Content>`,
      body
    )
    expect(long).toEqual([
      `shadcn/no-restyle: "text-lg" is not allowed on <CardContent>: <CardContent> owns its typography`,
    ])
    expect(
      found(`<Card.Content {contentClass}>x</Card.Content>`, body)
    ).toEqual(long)
  })

  it("reads a shorthand style attribute", () => {
    const body = `const style = { color: "red" };`
    const long = found(`<div style={style}></div>`, body)
    expect(long).toEqual(["shadcn/no-inline-styles: Inline style sets color"])
    expect(found(`<div {style}></div>`, body)).toEqual(long)
  })

  it("accepts the received class prop as a shorthand", () => {
    expect(found(`<Button className={className}>x</Button>`)).toEqual([])
    expect(found(`<Button {className}>x</Button>`)).toEqual([])
  })

  it("hands an object over through a shorthand attribute", () => {
    const body = `const theme = { className: "w-full" };`
    const long = found(
      `<Button theme={theme} class={theme.className}>x</Button>`,
      body
    )
    expect(long).toEqual([
      "shadcn/require-static-classes: Dynamically built className on <Button> cannot be checked",
    ])
    expect(
      found(`<Button {theme} class={theme.className}>x</Button>`, body)
    ).toEqual(long)
  })

  it("leaves dynamic elements to the vocabulary rules", () => {
    expect(
      found(`<svelte:element this={tone} class="bg-red-500 flex" />`)
    ).toEqual([
      `shadcn/no-raw-colors: "bg-red-500" uses the raw Tailwind palette`,
    ])
  })

  it("rewrites unquoted markup text in a suggestion", () => {
    const [message] = lint(`<div class="flex p-[13px]"></div>`)
    const code = script() + `<div class="flex p-[13px]"></div>`
    const [suggestion] = message.suggestions ?? []
    const { range, text } = suggestion.fix
    expect(code.slice(0, range[0]) + text + code.slice(range[1])).toBe(
      script() + `<div class="flex p-3.25"></div>`
    )
  })

  it("points a finding at the class text", () => {
    const [message] = lint(`<Card.Title class="text-2xl">Hi</Card.Title>`)
    const line = (
      script() + `<Card.Title class="text-2xl">Hi</Card.Title>`
    ).split("\n")[message.line - 1]
    expect(line.slice(message.column - 1, message.endColumn! - 1)).toBe(
      "text-2xl"
    )
  })

  it("knows the classes its own style block declares", () => {
    const rules = { "shadcn/no-unknown-classes": "error" }
    const code = `<div class="box flex-cols"></div>\n<style>\n.box { color: red }\n</style>\n`
    expect(
      lintSfc(code, SVELTE_PAGE, rules).map((m) => m.message.split(" ")[0])
    ).toEqual([`"flex-cols"`])
  })

  it("still lints the script block", () => {
    expect(
      summarize(
        lint("", `const chip = cn("bg-red-500");`).filter(
          (m) => m.ruleId === "shadcn/no-raw-colors"
        )
      )
    ).toHaveLength(1)
  })
})

describe("nested namespace components", () => {
  const ui = `import * as UI from "$lib/components/ui";`

  it("judges <UI.Button.Root> the way <Button> is judged", () => {
    const nested = found(`<UI.Button.Root class="p-4 bg-red-500" />`, ui)
    expect(nested).toEqual(found(`<Button class="p-4 bg-red-500" />`))
    expect(nested.length).toBeGreaterThan(0)
    expect(
      found(`<UI.Card.Title class="text-2xl">Hi</UI.Card.Title>`, ui)
    ).toEqual(found(`<Card.Title class="text-2xl">Hi</Card.Title>`))
  })
})

describe("CSS custom properties passed to a component", () => {
  it('reads <Button --tone="red"> like a style declaration', () => {
    expect(found(`<Button --tone="red">Save</Button>`)).toEqual([
      "shadcn/no-inline-styles: Custom property --tone hardcodes a color",
    ])
    expect(
      found(`<Button --tone="oklch(0.6 0.1 20)" --size={tone}>Save</Button>`)
    ).toEqual([
      "shadcn/no-inline-styles: Custom property --tone hardcodes a color",
    ])
  })

  it("accepts a token or a dynamic value", () => {
    expect(
      found(
        `<Button --tone="var(--color-primary)" --gap="4px" --ring={tone}>Save</Button>`
      )
    ).toEqual([])
  })
})

describe("Svelte 5 runes", () => {
  const runes =
    'let active = $state(true);\n  let width = $state(40);\n  const classes = $derived(active ? "p-4" : "p-2");\n  const box = $derived(`width: ${width}px`);'

  it("resolves a $derived class value the way a const resolves", () => {
    expect(found(`<Button class={classes}>Save</Button>`, runes)).toEqual([
      `shadcn/no-restyle: "p-4" is not allowed on <Button>: <Button> owns its spacing`,
      `shadcn/no-restyle: "p-2" is not allowed on <Button>: <Button> owns its spacing`,
    ])
  })

  it("reads a $derived style string property by property", () => {
    expect(found(`<div style={box}></div>`, runes)).toEqual([
      "shadcn/no-inline-styles: Inline style sets width",
    ])
    expect(
      found(
        `<div style={tint}></div>`,
        "const tint = $derived(`color: ${active ? 'red' : 'blue'}`);"
      )
    ).toEqual(["shadcn/no-inline-styles: Inline style sets color"])
  })

  it("leaves $derived.by unread", () => {
    expect(
      found(
        `<Button class={classes}>Save</Button><div style={box}></div>`,
        "const classes = $derived.by(() => 'p-4');\n  const box = $derived.by(() => 'width: 4px');"
      )
    ).toEqual([
      "shadcn/require-static-classes: Dynamically built className on <Button> cannot be checked",
      "shadcn/no-inline-styles: Dynamic style object cannot be checked",
    ])
  })
})

describe("SVG color attributes in Svelte markup", () => {
  it("reads the hyphenated stop-color and flood-color names", () => {
    expect(
      found(
        `<svg><linearGradient id="g"><stop stop-color="#f00" /></linearGradient><filter id="f"><feFlood flood-color="#00f" /></filter></svg>`
      )
    ).toEqual([
      `shadcn/no-raw-colors: stop-color="#f00" hardcodes a color`,
      `shadcn/no-raw-colors: flood-color="#00f" hardcodes a color`,
    ])
    expect(found(`<svg><stop stop-color="currentColor" /></svg>`)).toEqual([])
  })
})

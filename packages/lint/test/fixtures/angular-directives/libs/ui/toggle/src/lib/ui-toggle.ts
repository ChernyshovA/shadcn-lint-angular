import { computed, Directive, input } from "@angular/core"
import { cva } from "class-variance-authority"

export const toggleVariants = cva("inline-flex", {
  variants: { variant: { default: "bg-transparent", outline: "border" } },
})

// The class reaches its cva through a helper: the file's only directive
// still owns it.
const toggleClasses = (variant: "default" | "outline") =>
  toggleVariants({ variant })

@Directive({ selector: "[uiToggle]", host: { "[class]": "classes()" } })
export class UiToggle {
  readonly variant = input<"default" | "outline">("default")
  protected readonly classes = computed(() => toggleClasses(this.variant()))
}

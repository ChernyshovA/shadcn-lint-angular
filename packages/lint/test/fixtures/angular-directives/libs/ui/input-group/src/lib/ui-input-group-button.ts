import { UiButton } from "@acme/ui/button"
import { classes } from "@acme/ui/utils"
import { Directive, input } from "@angular/core"
import { cva } from "class-variance-authority"

const inputGroupButtonVariants = cva("shadow-none", {
  variants: { size: { xs: "h-6 px-2", sm: "h-8 px-3" } },
})

// Its variant comes from the button it hosts; only its sizes are its own.
@Directive({
  selector: "button[uiInputGroupButton]",
  hostDirectives: [{ directive: UiButton, inputs: ["variant"] }],
})
export class UiInputGroupButton {
  readonly size = input<"xs" | "sm">("xs")

  constructor() {
    classes(() => inputGroupButtonVariants({ size: this.size() }))
  }
}

// Nothing of its own: the button it hosts styles it.
@Directive({
  selector: "button[uiInputGroupAction]",
  hostDirectives: [UiButton],
})
export class UiInputGroupAction {}

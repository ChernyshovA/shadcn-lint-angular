import { Directive, input } from "@angular/core"
import { classes } from "@acme/ui/utils"
import { cva, type VariantProps } from "class-variance-authority"

export const buttonVariants = cva("inline-flex items-center", {
  variants: {
    variant: {
      default: "bg-primary",
      outline: "border",
      ghost: "hover:bg-accent",
    },
    size: { default: "h-9 px-4", sm: "h-8 px-3", lg: "h-10 px-6" },
  },
  defaultVariants: { variant: "default", size: "default" },
})

export type ButtonVariants = VariantProps<typeof buttonVariants>

@Directive({
  selector: "button[uiBtn], a[uiBtn]",
  host: { "data-slot": "button" },
})
export class UiButton {
  readonly variant = input<ButtonVariants["variant"]>("default")
  readonly size = input<ButtonVariants["size"]>("default")

  constructor() {
    classes(() => buttonVariants({ variant: this.variant(), size: this.size() }))
  }
}

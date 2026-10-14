import { Component, Directive } from "@angular/core"
import { cva } from "class-variance-authority"

export const cardVariants = cva("rounded-xl border", {
  variants: { variant: { default: "bg-card", outline: "bg-transparent" } },
})

@Component({
  selector: "ui-card",
  templateUrl: "./ui-card.html",
  host: { "[class]": "classes" },
})
export class UiCard {
  protected readonly classes = cardVariants()
}

export const cardContentVariants = cva("px-6", {
  variants: { size: { default: "py-6", sm: "py-4" } },
})

@Directive({ selector: "[uiCardContent]", host: { "[class]": "classes" } })
export class UiCardContent {
  protected readonly classes = cardContentVariants()
}

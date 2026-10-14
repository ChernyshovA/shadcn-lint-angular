import { provideBrnTooltipDefaultOptions } from "@acme/brain/tooltip"
import { hlm } from "@acme/ui/utils"
import { Directive, input } from "@angular/core"
import { cva } from "class-variance-authority"

// As spartan's HlmTooltip: its cva places the arrow of the tooltip it
// opens, and gives the element it is on no variant or size. Its helper
// calls, in its providers and at module level, build the classes of that
// tooltip, not of its element.
export const DEFAULT_TOOLTIP_CONTENT_CLASSES = hlm("bg-foreground text-background")

export const tooltipPositionVariants = cva("absolute", {
  variants: {
    position: { top: "bottom-0", bottom: "-top-2.5" },
  },
})

@Directive({
  selector: "[uiTooltip]",
  providers: [
    provideBrnTooltipDefaultOptions({
      tooltipContentClasses: DEFAULT_TOOLTIP_CONTENT_CLASSES,
      arrowClasses: (position: "top" | "bottom") =>
        hlm(tooltipPositionVariants({ position })),
    }),
  ],
})
export class UiTooltip {
  readonly uiTooltip = input<string>()
}

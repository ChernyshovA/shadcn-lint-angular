import { Directive, input } from "@angular/core"

// Opens a popover: it does not style the element it is on.
@Directive({ selector: "[uiPopoverTrigger]" })
export class UiPopoverTrigger {
  readonly uiPopoverTrigger = input<unknown>()
}

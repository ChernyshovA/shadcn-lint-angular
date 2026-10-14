import { classes } from "@acme/ui/utils"
import { Directive } from "@angular/core"

// Styles its element with no cva: it has no variants to offer.
@Directive({ selector: "input[uiInput]" })
export class UiInput {
  constructor() {
    classes(() => "h-9 rounded-md border")
  }
}

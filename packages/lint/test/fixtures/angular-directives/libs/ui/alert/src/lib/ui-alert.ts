import { classes, hlm } from "@acme/ui/utils"
import { Directive, input } from "@angular/core"

// As spartan's helm: its constructor gives its element classes a helper
// builds.
@Directive({ selector: "[uiAlert]" })
export class UiAlert {
  readonly tone = input<string>("")

  constructor() {
    classes(() => hlm("rounded-lg border", this.tone()))
  }
}

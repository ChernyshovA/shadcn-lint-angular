import { Directive, Input, input } from "@angular/core"

const OPTIONS = { alias: "tone" }

// Each takes the element's class into an input of its own, under the
// public name class, and puts it where it likes: Material's MatMenu on
// its panel through panelClass, spartan's brain overlays through
// className. None styles its element otherwise.
@Directive({ selector: "ui-menu" })
export class UiMenu {
  @Input("class") panelClass = ""
}

@Directive({ selector: "ui-sheet" })
export class UiSheet {
  readonly userClass = input("", { alias: "class" })
}

@Directive({ selector: "ui-toast", inputs: ["toastClass: class"] })
export class UiToast {
  toastClass = ""
}

// Exposes the class input of the directive it hosts on its own element.
@Directive({
  selector: "ui-dialog",
  hostDirectives: [{ directive: UiSheet, inputs: ["class"] }],
})
export class UiDialog {}

// Hosts it without exposing it: the element's class never reaches it.
@Directive({ selector: "ui-drawer", hostDirectives: [UiSheet] })
export class UiDrawer {}

// An input whose public name is not written out: it may be class.
@Directive({ selector: "ui-opaque" })
export class UiOpaque {
  readonly tone = input("", OPTIONS)
}

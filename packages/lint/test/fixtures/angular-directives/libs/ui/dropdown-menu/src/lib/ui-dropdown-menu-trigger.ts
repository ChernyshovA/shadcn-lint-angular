import { Directive, input } from "@angular/core"

// As the CDK's CdkMenuTrigger: its host labels the element, so it styles
// it, and it has no cva.
@Directive({
  selector: "[uiMenuTriggerBase]",
  host: { class: "ui-menu-trigger" },
})
export class UiMenuTriggerBase {}

// As spartan's HlmDropdownMenuTrigger, which hosts CdkMenuTrigger.
@Directive({
  selector: "[uiDropdownMenuTrigger]",
  hostDirectives: [UiMenuTriggerBase],
})
export class UiDropdownMenuTrigger {
  readonly uiDropdownMenuTrigger = input<unknown>()
}

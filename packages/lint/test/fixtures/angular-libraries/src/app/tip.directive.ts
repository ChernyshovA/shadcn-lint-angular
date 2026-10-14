import { Directive, Input, input } from "@angular/core"

@Directive({})
export class AppTipBase {
  readonly baseClass = input.required<string>({ alias: "appBaseClass" })
}

// A host directive needs no selector.
@Directive({})
export class AppHint {
  readonly hintClass = input("")
}

@Directive({
  selector: "[appTip]",
  inputs: ["tone: appTipTone", { name: "edgeClass", alias: "appEdgeClass" }],
  hostDirectives: [{ directive: AppHint, inputs: ["hintClass: appHintClass"] }],
})
export class AppTip extends AppTipBase {
  readonly tipClass = input("", { alias: "appTipClass" })
  @Input("appTipPanelClass") panelClass = ""
  @Input() set arrowClass(value: string) {}
  tone = ""
  edgeClass = ""
}

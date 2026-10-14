import { Component, input, model } from "@angular/core"

@Component({ selector: "app-chip", template: "<ng-content />" })
export class AppChip {
  readonly labelClass = input("")
  readonly selected = model(false)
}

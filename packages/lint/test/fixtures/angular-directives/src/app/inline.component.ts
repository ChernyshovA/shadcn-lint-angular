import { Component } from "@angular/core"
import { UiButtonImports } from "@acme/ui/button"

@Component({
  selector: "app-inline",
  imports: [...UiButtonImports],
  template: `<button uiBtn class="bg-pink-500">Save</button>`,
})
export class InlineComponent {}

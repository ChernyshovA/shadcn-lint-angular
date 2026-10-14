import { Component } from "@angular/core"

// Components that style nothing on their element: they draw themselves
// in their templates.
@Component({
  selector: "ui-panel",
  template: `<section class="rounded-xl border p-6"><ng-content /></section>`,
})
export class UiPanel {}

@Component({
  selector: "button[uiFab]",
  template: `<span class="rounded-full p-2"><ng-content /></span>`,
})
export class UiFab {}

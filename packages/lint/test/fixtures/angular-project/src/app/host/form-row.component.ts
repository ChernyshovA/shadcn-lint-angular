import { Component } from "@angular/core"

@Component({
  selector: "app-form-row",
  template: `<div class="row-inner"><ng-content></ng-content></div>`,
  styleUrl: "./form-row.component.scss",
  host: { class: "grid" },
})
export class FormRowComponent {}

import { Component } from "@angular/core"

import { FormRowComponent } from "./form-row.component"
import { OpaqueComponent } from "./opaque.component"

@Component({
  selector: "app-parent",
  templateUrl: "./parent.component.html",
  imports: [FormRowComponent, OpaqueComponent],
})
export class ParentComponent {}

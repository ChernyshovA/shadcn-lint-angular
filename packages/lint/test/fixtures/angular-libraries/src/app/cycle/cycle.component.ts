import { Component } from "@angular/core"

import { CycleAModule } from "./cycle-a.module"

@Component({
  selector: "app-cycle",
  templateUrl: "./cycle.component.html",
  imports: [CycleAModule],
})
export class CycleComponent {}

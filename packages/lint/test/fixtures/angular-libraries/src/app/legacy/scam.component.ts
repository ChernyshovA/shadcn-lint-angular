import { Component, NgModule } from "@angular/core"

import { TipsModule } from "./tips.module"

// A component and the module that declares it, in one file.
@Component({
  selector: "app-scam",
  templateUrl: "./scam.component.html",
  standalone: false,
})
export class ScamComponent {}

const DECLARED = [ScamComponent]

@NgModule({ declarations: [...DECLARED], imports: [TipsModule.forRoot()] })
export class ScamModule {}

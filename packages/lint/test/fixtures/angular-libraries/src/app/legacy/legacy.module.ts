import { NgModule } from "@angular/core"

import { CheckComponent } from "./check/check.component"
import { SharedModule } from "./shared.module"

@NgModule({
  declarations: [CheckComponent],
  imports: [SharedModule],
  exports: [CheckComponent],
})
export class LegacyModule {}

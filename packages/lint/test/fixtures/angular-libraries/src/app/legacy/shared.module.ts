import { NgModule } from "@angular/core"
import { MatIconModule } from "@angular/material/icon"
import { MatTooltipModule } from "@angular/material/tooltip"

@NgModule({
  imports: [MatTooltipModule, MatIconModule],
  exports: [MatTooltipModule, MatIconModule],
})
export class SharedModule {}

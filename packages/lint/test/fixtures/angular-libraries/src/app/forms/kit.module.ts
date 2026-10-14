import { NgModule } from "@angular/core"
import { MatSelectModule } from "@angular/material/select"
import { MatTooltipModule } from "@angular/material/tooltip"

const MAT = [MatSelectModule, MatTooltipModule]

// What it imports and exports, written as a constant.
@NgModule({ imports: MAT, exports: MAT })
export class KitModule {}

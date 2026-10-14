import { NgModule } from "@angular/core"

import { AppChip } from "../chip.component"
import { CycleBModule } from "./cycle-b.module"

@NgModule({ imports: [AppChip], exports: [AppChip, CycleBModule] })
export class CycleAModule {}

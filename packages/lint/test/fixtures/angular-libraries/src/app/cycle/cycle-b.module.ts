import { NgModule } from "@angular/core"

import { CycleAModule } from "./cycle-a.module"

// Exports the module that exports it.
@NgModule({ exports: [CycleAModule] })
export class CycleBModule {}

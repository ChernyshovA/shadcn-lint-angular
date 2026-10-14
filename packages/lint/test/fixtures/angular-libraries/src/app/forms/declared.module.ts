import { NgModule } from "@angular/core"

import { DeclaredComponent } from "./declared.component"
import { MATERIAL } from "./material"

const DECLARED = [DeclaredComponent]

// What it declares and imports, written as constants, one of them
// another file's.
@NgModule({ declarations: DECLARED, imports: MATERIAL })
export class DeclaredModule {}

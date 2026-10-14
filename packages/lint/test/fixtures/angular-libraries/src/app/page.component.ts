import { Component } from "@angular/core"
import { MatButtonModule } from "@angular/material/button"
import { MatIconModule } from "@angular/material/icon"
import { MatSelectModule } from "@angular/material/select"
import { MatTooltipModule } from "@angular/material/tooltip"
import { KitImports } from "acme-kit"
import { ButtonModule } from "primeng/button"
import { DialogModule } from "primeng/dialog"
import { StyleClass } from "primeng/styleclass"
import { TooltipModule } from "primeng/tooltip"
import { SplitModule } from "split-kit"

import { AppChip } from "./chip.component"
import { AppOdd } from "./odd.directive"
import { AppTip } from "./tip.directive"

@Component({
  selector: "app-page",
  templateUrl: "./page.component.html",
  imports: [
    MatButtonModule,
    MatIconModule,
    MatSelectModule,
    MatTooltipModule,
    KitImports,
    ButtonModule,
    DialogModule,
    StyleClass,
    TooltipModule,
    SplitModule,
    AppChip,
    AppOdd,
    AppTip,
  ],
})
export class PageComponent {}

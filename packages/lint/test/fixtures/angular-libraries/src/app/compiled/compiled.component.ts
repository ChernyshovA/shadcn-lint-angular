import { Component } from "@angular/core"
import { BrnAlertDialogTrigger } from "@spartan-ng/brain/alert-dialog"
import {
  BrnDialogClose,
  BrnDialogContent,
  BrnDialogOverlay,
  BrnDialogTrigger,
} from "@spartan-ng/brain/dialog"
import { BrnRadio } from "@spartan-ng/brain/radio-group"
import { FutureTip } from "future-kit"
import { ButtonModule } from "primeng/button"
import { DialogModule } from "primeng/dialog"
import { StyleClass } from "primeng/styleclass"
import { TooltipModule } from "primeng/tooltip"
import { TornTip } from "torn-kit"
import { TypedTip } from "typed-kit"

import {
  KitBind,
  KitDialogContent,
  KitDialogOverlay,
  KitDialogTrigger,
  KitTyped,
} from "./hosts"

@Component({
  selector: "app-compiled",
  templateUrl: "./compiled.component.html",
  imports: [
    BrnAlertDialogTrigger,
    BrnDialogClose,
    BrnDialogContent,
    BrnDialogOverlay,
    BrnDialogTrigger,
    BrnRadio,
    FutureTip,
    ButtonModule,
    DialogModule,
    StyleClass,
    TooltipModule,
    TornTip,
    TypedTip,
    KitBind,
    KitDialogContent,
    KitDialogOverlay,
    KitDialogTrigger,
    KitTyped,
  ],
})
export class CompiledComponent {}

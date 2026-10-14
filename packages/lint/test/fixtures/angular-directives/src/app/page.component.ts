import { UiAlert } from "@acme/ui/alert"
import { UiBanner } from "@acme/ui/banner"
import { UiButtonImports } from "@acme/ui/button"
import { UiCard, UiCardContent } from "@acme/ui/card"
import { UiChip } from "@acme/ui/chip"
import { UiDropdownMenuTrigger } from "@acme/ui/dropdown-menu"
import { UiInput } from "@acme/ui/input"
import { UiInputGroupAction, UiInputGroupButton } from "@acme/ui/input-group"
import {
  UiDialog,
  UiDrawer,
  UiMenu,
  UiOpaque,
  UiSheet,
  UiToast,
} from "@acme/ui/menu"
import { UiFab, UiPanel } from "@acme/ui/panel"
import { UiPopoverTrigger } from "@acme/ui/popover"
import { UiToggle } from "@acme/ui/toggle"
import { UiTooltip } from "@acme/ui/tooltip"
import { Component } from "@angular/core"

import { Badge } from "./badge.directive"
import { MultiSelect } from "./multi-select.directive"

@Component({
  selector: "app-page",
  templateUrl: "./page.component.html",
  imports: [
    UiAlert,
    UiBanner,
    UiButtonImports,
    UiCard,
    UiCardContent,
    UiChip,
    UiDialog,
    UiDrawer,
    UiDropdownMenuTrigger,
    UiInput,
    UiInputGroupAction,
    UiInputGroupButton,
    UiMenu,
    UiOpaque,
    UiFab,
    UiPanel,
    UiPopoverTrigger,
    UiSheet,
    UiToast,
    UiToggle,
    UiTooltip,
    Badge,
    MultiSelect,
  ],
})
export class PageComponent {}

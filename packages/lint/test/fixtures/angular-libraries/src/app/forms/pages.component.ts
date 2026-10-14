import { Component } from "@angular/core"
import { MatSelectModule } from "@angular/material/select"
import { MatTooltipModule } from "@angular/material/tooltip"

import { KitHinted, KitKeyed, KitSpaced, KitSpread } from "./directives"
import { KitModule } from "./kit.module"
import { KitImported, KitLocal, KitRouted, KitTpl } from "./selectors"
import {
  KitBound,
  KitDeep,
  KitHostConstant,
  KitHostsLibrary,
  KitTrigger,
} from "./styles"

@Component({
  selector: "app-modules",
  templateUrl: "./modules.component.html",
  imports: [KitModule],
})
export class ModulesComponent {}

@Component({
  selector: "app-selectors",
  templateUrl: "./selectors.component.html",
  imports: [KitLocal, KitTpl, KitRouted],
})
export class SelectorsComponent {}

@Component({
  selector: "app-unread-selector",
  templateUrl: "./unread-selector.component.html",
  imports: [KitLocal, KitImported],
})
export class UnreadSelectorComponent {}

@Component({
  selector: "app-directives",
  templateUrl: "./directives.component.html",
  imports: [KitHinted, KitSpread, KitKeyed, KitSpaced],
})
export class DirectivesComponent {}

const SHARED = { imports: [MatSelectModule] }

// A spread can carry `imports`.
@Component({
  ...SHARED,
  selector: "app-spread",
  templateUrl: "./spread.component.html",
  standalone: true,
})
export class SpreadComponent {}

const MAT = [MatSelectModule]

// Only a module's forRoot() and the like give what they are called on.
@Component({
  selector: "app-concat",
  templateUrl: "./concat.component.html",
  imports: [...MAT.concat([MatTooltipModule])],
})
export class ConcatComponent {}

@Component({
  selector: "app-styles",
  templateUrl: "./styles.component.html",
  imports: [KitTrigger, KitHostsLibrary, KitHostConstant, KitBound, KitDeep],
})
export class StylesComponent {}

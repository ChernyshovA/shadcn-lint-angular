import { Directive, HostBinding } from "@angular/core"
import { MatTooltip } from "@angular/material/tooltip"

const HOST = { class: "kit-host" }
const CLASS = "class"

// Only behaves: a trigger.
@Directive({ selector: "[kitTrigger]" })
export class KitTrigger {}

// Hosts a library's directive, whose .d.ts does not say whether it
// styles its element.
@Directive({ selector: "[kitHostsLibrary]", hostDirectives: [MatTooltip] })
export class KitHostsLibrary {}

// What it binds on its element, through constants.
@Directive({ selector: "[kitHostConstant]", host: HOST })
export class KitHostConstant {}

@Directive({ selector: "[kitBound]" })
export class KitBound {
  @HostBinding(CLASS) bound = "kit-bound"
}

@Directive({ host: { class: "kit-styled" } })
export class KitStyled {}

@Directive({ hostDirectives: [KitStyled] })
export class KitMiddle {}

// Styles through what it hosts, two levels down.
@Directive({ selector: "[kitDeep]", hostDirectives: [KitMiddle] })
export class KitDeep {}

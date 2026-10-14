import { Directive } from "@angular/core"
import {
  BrnDialogContent,
  BrnDialogOverlay,
  BrnDialogTrigger,
} from "@spartan-ng/brain/dialog"
import { Bind } from "primeng/bind"
import { TypedTip } from "typed-kit"

// As spartan's helm trigger: hosts brain's, and styles nothing itself.
@Directive({
  selector: "button[kitDialogTrigger]",
  hostDirectives: [{ directive: BrnDialogTrigger, inputs: ["id"] }],
})
export class KitDialogTrigger {}

// Hosts PrimeNG's Bind, whose host binds the element's class.
@Directive({ selector: "[kitBind]", hostDirectives: [Bind] })
export class KitBind {}

// Hosts a directive whose package ships no JavaScript here.
@Directive({ selector: "[kitTyped]", hostDirectives: [TypedTip] })
export class KitTyped {}

// As spartan's HlmDialogPortal: exposes the class input of brain's
// BrnDialogContent on its own element, which so takes the element's
// class.
@Directive({
  selector: "[kitDialogContent]",
  hostDirectives: [{ directive: BrnDialogContent, inputs: ["class"] }],
})
export class KitDialogContent {}

// Hosts BrnDialogOverlay without exposing its class input, which so
// never takes the element's.
@Directive({ selector: "[kitDialogOverlay]", hostDirectives: [BrnDialogOverlay] })
export class KitDialogOverlay {}

import * as core from "@angular/core"
import { Component, Directive, input } from "@angular/core"

import { AppHint } from "../tip.directive"

const STANDALONE = { standalone: true }
const HOSTS = [{ directive: AppHint, inputs: ["hintClass: kitHintClass"] }]
const KEY = "keyClass"

// Its hostDirectives as a constant: what they expose is read through it.
@Directive({ selector: "[kitHinted]", hostDirectives: HOSTS })
export class KitHinted {}

// A spread can carry any option, inputs among them.
@Component({ ...STANDALONE, selector: "kit-spread", template: "" })
export class KitSpread {}

// An input under a computed key: its name is not read.
@Component({ selector: "kit-keyed", template: "" })
export class KitKeyed {
  readonly [KEY] = input("")
}

// Inputs through a namespace import of @angular/core.
@Component({ selector: "kit-spaced", template: "" })
export class KitSpaced {
  @core.Input() spaceClass = ""
  readonly tintClass = core.input("")
  readonly toneClass = core.input.required<string>()
}

import { Component } from "@angular/core"

import { base } from "./base"

@Component({
  selector: "app-inline-read",
  template: `<div class="pair-own pair-unknown"></div>`,
  styles: `.pair-own { display: block; }`,
})
export class InlineRead {}

// No template for the processor to hand over, so no number of its own.
@Component({
  selector: "app-inline-empty",
  template: "",
})
export class InlineEmpty {}

@Component({
  ...base,
  selector: "app-inline-spread",
  template: `<div class="pair-anything"></div>`,
})
export class InlineSpread {}

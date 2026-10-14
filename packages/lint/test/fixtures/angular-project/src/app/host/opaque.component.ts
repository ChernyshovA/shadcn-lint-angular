import { Component } from "@angular/core"

const shared = ":host(.opaque-x) { display: block; }"

@Component({
  selector: "app-opaque",
  template: `<ng-content></ng-content>`,
  styles: [shared],
})
export class OpaqueComponent {}

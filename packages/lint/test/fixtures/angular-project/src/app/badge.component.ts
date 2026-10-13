import { Component } from "@angular/core"

@Component({
  selector: "app-badge",
  template: "<ng-content />",
  styleUrl: "./badge.component.scss",
  host: {
    class: "badge inline-flex",
    "[class.badge-active]": "active",
    "[class.badge-actve]": "active",
  },
})
export class BadgeComponent {
  active = false
}

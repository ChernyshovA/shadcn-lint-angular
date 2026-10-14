import { Component } from "@angular/core"

// Declared by no NgModule this can find.
@Component({
  selector: "app-orphan",
  templateUrl: "./orphan.component.html",
  standalone: false,
})
export class OrphanComponent {}

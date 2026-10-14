import { Component } from "@angular/core"

// Standalone and importing nothing: no directive matches its elements.
@Component({
  selector: "app-bare",
  templateUrl: "./bare.component.html",
  standalone: true,
})
export class BareComponent {}

import { Component } from "@angular/core"
import { MatIconModule } from "@angular/material/icon"
import { BrokenModule } from "broken-kit"
import { GarbledCard } from "garbled-kit"

@Component({
  selector: "app-broken",
  templateUrl: "./broken.component.html",
  imports: [BrokenModule, GarbledCard, MatIconModule],
})
export class BrokenComponent {}

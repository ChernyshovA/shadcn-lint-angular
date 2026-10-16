import { Component } from "@angular/core"

@Component({
  selector: "app-inline-style",
  template: `<style>
      .inline-own {
      }
    </style>
    <p class="inline-own inline-not"></p>`,
})
export class InlineStyleComponent {}

import { hlm } from "@acme/ui/utils"
import { Directive, input } from "@angular/core"

// Builds its element's classes with a helper in a method, which its host
// binds.
@Directive({ selector: "[uiBanner]", host: { "[attr.data-tone]": "tone()" } })
export class UiBanner {
  readonly tone = input<string>("")

  protected classesFor(tone: string) {
    return hlm("p-4", tone)
  }
}

import { hlm } from "@acme/ui/utils"
import { computed, Directive, input } from "@angular/core"

// Styles its element through a helper settings.shadcn.mergeFunctions
// names, with no cva of its own.
@Directive({ selector: "[uiChip]", host: { "[attr.data-chip]": "true" } })
export class UiChip {
  readonly tone = input<string>("")
  readonly computedClass = computed(() => hlm("rounded-full", this.tone()))
}

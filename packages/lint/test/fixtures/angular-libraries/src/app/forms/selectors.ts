import { Component, Input, input } from "@angular/core"

import { KIT_SELECTOR } from "./selector"

const SELECTOR = "kit-local"
const PREFIX = "kit"

@Component({ selector: SELECTOR, template: "" })
export class KitLocal {
  @Input() localClass = ""
}

@Component({ selector: `${PREFIX}-tpl`, template: "" })
export class KitTpl {
  readonly tplClass = input("")
}

// No selector: routed, or created from code, and matched by no element.
@Component({ template: "" })
export class KitRouted {
  readonly routedClass = input("")
}

// Another file's constant: which elements it matches is not read.
@Component({ selector: KIT_SELECTOR, template: "" })
export class KitImported {
  readonly importedClass = input("")
}

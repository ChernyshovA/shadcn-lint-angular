import { Directive, Input } from "@angular/core"

const NAME = "appOddClass"

// An input named by a constant: which name it takes is not read.
@Directive({ selector: "[appOdd]" })
export class AppOdd {
  @Input(NAME) oddClass = ""
}

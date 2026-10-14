import { Directive } from "@angular/core"

// Adds behavior to a <ui-select> whose component, compiled into a
// library, is not read: it is not the component its tag stands for.
@Directive({ selector: "ui-select[multiple]" })
export class MultiSelect {}

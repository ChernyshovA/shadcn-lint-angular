---
"@shadcn/lint": minor
---

Tell whether a directive or component an Angular library publishes compiled styles its element from the partial declaration its JavaScript carries (`ɵɵngDeclareDirective`, `ɵɵngDeclareComponent`, as the Angular linker reads it): a static class or a binding of `class` in its `host`, in a directive it hosts, or in a class it extends. `no-restyle` leaves alone an element whose matched names stand only for attribute directives that style nothing, never a component, which draws itself in its template, such as PrimeNG's `pTooltip` or spartan's brain triggers installed from npm; a library whose JavaScript is not installed, or none of whose declarations can be read, still counts as one that may style, and the latter is said once per package.

import { Directive, HostAttributeToken, inject } from "@angular/core"
import { cva } from "class-variance-authority"

const badgeVariants = cva("rounded-md", {
  variants: { variant: { default: "bg-primary", muted: "bg-muted" } },
})

@Directive({ selector: "[appBadge]" })
export class Badge {
  private readonly own = inject(new HostAttributeToken("class"), {
    optional: true,
  })
  readonly classes = [badgeVariants(), this.own]
}

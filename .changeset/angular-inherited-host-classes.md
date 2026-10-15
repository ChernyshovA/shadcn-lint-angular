---
"@shadcn/lint": patch
---

Count an Angular directive as one that styles its element in `no-restyle` when a class it extends does, in the project or in a library, and when its `host`, its `@HostBinding` or a library's partial declaration binds `[attr.class]` or `[className]`. A library's class that declares no directive, a helper or an `@Injectable`, adds nothing, as Angular's inheritance passes it. A mixin's `extends Mixin(Base)` may style it. In a template, `[className]` sets the element's class, as `[attr.class]` does.

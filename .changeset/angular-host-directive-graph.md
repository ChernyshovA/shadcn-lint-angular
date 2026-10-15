---
"@shadcn/lint": patch
---

Read each directive once when telling whether an Angular directive styles its element through the `hostDirectives` it hosts: directives that host the same one, or host each other in a loop, no longer take time that grows with every path between them, and a loop of directives none of which styles is read as one that does not.

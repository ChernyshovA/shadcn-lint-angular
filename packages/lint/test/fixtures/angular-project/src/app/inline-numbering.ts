import { Component } from "@angular/core"

// angular-eslint's processor hands over only these templates, and numbers
// them in this order: a quoted key, a decorator with a second argument, a
// template given by shorthand and the second `template` of a decorator are
// not handed over, and a component nested in a function is.

@Component({
  selector: "app-quoted",
  "template": `<div class="quoted-own"></div>`,
  styles: [".quoted-own {}"],
})
export class Quoted {}

// @ts-expect-error: one argument
@Component({ template: `<div class="two-own"></div>`, styles: [".two-own {}"] }, {})
export class TwoArguments {}

const template = `<div class="short-own"></div>`
@Component({ template, styles: [".short-own {}"] })
export class Shorthand {}

@Component({
  selector: "app-first",
  template: ``,
  // eslint-disable-next-line no-dupe-keys
  template: `<div class="dupe-own"></div>`,
  styles: [".dupe-own {}"],
})
export class FirstTemplate {}

export function make() {
  @Component({
    template: `<div class="nested-own nested-unknown"></div>`,
    styles: [".nested-own {}"],
  })
  class Nested {}
  return Nested
}

@Component({
  template: `<div class="last-own last-unknown"></div>`,
  styles: [".last-own {}"],
})
export class Last {}

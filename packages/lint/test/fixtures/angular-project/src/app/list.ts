import { Component } from "@angular/core"

const shared = ".list-shared { display: block; }"

@Component({
  selector: "app-list",
  templateUrl: "./list.html",
  styleUrls: ["./list.css"],
  styles: [".list-inline { display: block; }", `.list-backtick { gap: 0; }`],
})
export class List {}

@Component({
  selector: "app-list-opaque",
  templateUrl: "./list-opaque.html",
  styles: [shared],
})
export class ListOpaque {}

@Component({
  selector: "app-list-inline",
  template: `<div class="list-own list-unknown"></div>`,
  styles: `.list-own { display: block; }`,
})
export class ListInline {}

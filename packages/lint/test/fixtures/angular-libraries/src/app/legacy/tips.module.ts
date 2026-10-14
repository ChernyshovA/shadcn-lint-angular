import { NgModule, type ModuleWithProviders } from "@angular/core"

import { AppTip } from "../tip.directive"

@NgModule({ imports: [AppTip], exports: [AppTip] })
export class TipsModule {
  static forRoot(): ModuleWithProviders<TipsModule> {
    return { ngModule: TipsModule }
  }
}

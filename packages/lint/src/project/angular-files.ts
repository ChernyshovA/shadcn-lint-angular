// Which files the rules found to be Angular code as they started on them
// (rules/settings.ts): templates, scripts that import Angular, and the
// other scripts of an Angular project (sites/readers/angular-code.ts).
// What this plugin reads from a project the Angular way, by a file's path
// alone, such as the theme an app's global styles hold or spartan's
// components.json, it reads for those files only, so a React, Vue or
// Svelte file in the same workspace lints as it does without it.

// The files linted last: a file asks while it is linted.
const LIMIT = 256
const angular = new Map<string, boolean>()

export function noteAngularCode(file: string, isAngular: boolean) {
  if (!file) return
  angular.delete(file)
  angular.set(file, isAngular)
  if (angular.size > LIMIT) angular.delete(angular.keys().next().value!)
}

export function isAngularFile(file: string) {
  return angular.get(file) === true
}

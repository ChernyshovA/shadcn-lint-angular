// The files the rules found to be Angular code as they started on them.
// What is read from a project the Angular way by path alone (an app's
// global styles, spartan's components.json) is read for these only, so a
// React, Vue or Svelte file beside them lints as if Angular were absent.

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

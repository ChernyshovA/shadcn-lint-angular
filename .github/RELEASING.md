# Releasing

Releases use [Changesets](https://github.com/changesets/changesets) and
are published by hand:

1. Run `pnpm changeset` with each change, choose a version bump, and
   write a changelog entry. Include the generated file with the change.
2. Run `pnpm changeset version` to apply the bumps to `package.json` and
   `CHANGELOG.md`, and commit the result.
3. Run the [install test](../CONTRIBUTING.md#install-test).
4. Run `pnpm run release` signed in to npm. It type checks, tests, runs
   the corpus check, and publishes; Changesets tags the release
   `shadcn-lint-angular@<version>`.
5. Push the commit and that tag only. A plain `--tags` would also push
   the `@shadcn/lint@*` tags that come with upstream:

   ```bash
   git push origin main shadcn-lint-angular@<version>
   ```

`packages/evals` stays private and is never versioned or published.

## Syncing with upstream

Merge `upstream/main` (`https://github.com/shadcn-ui/lint`) rather than
rebasing. Its changesets name `@shadcn/lint`: delete them, and describe
what the sync brings in a changeset of this package. Keep this package's
`name`, `version`, and `CHANGELOG.md` where they conflict. Then update the
upstream commit or version that the README's "Differences from
@shadcn/lint" and the changelog name.

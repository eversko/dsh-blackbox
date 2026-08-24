# Release runbook

Releases are manual, tag-only, and protected by the `npm-release` GitHub environment.

## One-time setup

1. Confirm the `@eversko` npm organization and package publishing access.
2. Create the `npm-release` GitHub environment and require a reviewer.
3. Create a short-lived granular `NPM_TOKEN` limited to `@eversko/dsh-blackbox` for the first publication only.
4. Tag the exact commit as `v0.1.0` and run **Publish DSH Black Box** with `bootstrap` enabled.
5. Configure npm trusted publishing for organization `eversko`, repository `dsh-blackbox`, workflow `publish.yml`, and environment `npm-release`.
6. Delete the bootstrap token and remove the `NPM_TOKEN` environment secret.

## Every release

1. Update `version` and `CHANGELOG.md`.
2. Run `npm ci`, `npm test`, `npm audit --audit-level=moderate`, and `npm publish --dry-run --ignore-scripts` in this directory.
3. Merge the reviewed release commit and create the exact `v<version>` tag.
4. Run **Publish DSH Black Box** with `bootstrap` disabled.
5. Verify the npm package page shows provenance and install the published tarball in a clean consumer.

References: [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) and [npm provenance](https://docs.npmjs.com/generating-provenance-statements/).

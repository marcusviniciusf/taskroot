# Contributing

## Development setup

- Install Node.js 22.14 or newer.
- Clone the repository and run `npm install`.
- Make a focused change and add regression coverage.
- Run `npm test`, `npm pack --dry-run`, and a local install smoke test.

## Pull requests

- Explain the user-visible behavior and any data-format changes.
- Keep existing task IDs and JSON files compatible where possible.
- Never include private task backlogs, credentials, or generated package archives.

## Releases

The first package version (`0.1.0`) must be published by an authenticated npm
maintainer because npm trusted publishing can only be configured after the package
exists. Publish `0.1.0` from the repository with `npm publish --access public`,
verify the package, then publish the matching GitHub Release. The workflow skips
that first release to avoid publishing the same version twice.

For later versions, configure npm Trusted Publishing for `marcusviniciusf/taskroot`
and `.github/workflows/publish.yml` when preparing the next release. Update
`package.json` and `CHANGELOG.md`, create a version tag, and publish a GitHub
Release after CI passes. GitHub Actions publishes through OIDC and generates npm
provenance for the public package.

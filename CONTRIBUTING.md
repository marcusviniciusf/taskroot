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

Releases use GitHub Actions and npm trusted publishing. Update `package.json` and
`CHANGELOG.md`, create a version tag, and publish a GitHub Release after CI passes.

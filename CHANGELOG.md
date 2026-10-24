# Changelog

## 0.1.0

- Add atomic JSON writes and a lock around local mutations.
- Validate project prefixes, task documents, arguments, IDs, and dependencies.
- Add status history, task details and editing, filters, and JSON output.
- Add case-insensitive title and description search to `list` and `next`.
- Version task and milestone documents, accept legacy files, and reject unknown schema versions.
- Recover locks left by exited processes while preserving locks owned by active processes.
- Follow the system language for CLI output, with Portuguese and English support and a `TASKROOT_LANG` override.
- Format task, readiness, summary, and milestone output as aligned tables.
- Split file storage and validation rules into separate modules.
- Document dependencies, milestones, JSON output, and coding-agent workflows with a runnable demo.
- Expand CLI help to cover all commands and filters.
- Prepare the `taskroot` package for npm.

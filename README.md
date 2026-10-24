# Taskroot

Taskroot is a small, local-first backlog for developers and coding agents. It stores ordinary JSON files in your project, keeps them versionable with Git, and needs no runtime dependencies.

## Requirements

- Node.js 22 or newer
- macOS, Linux, or Windows

## Install

```sh
npm install --global taskroot
tasks --help
```

The package is named `taskroot` and installs both `tasks` and `taskroot` commands.

## Quick start

Run this from a repository root:

```sh
tasks init shop --prefix SHOP --repo acme/shop
tasks new shop --title "Add catalog endpoint" --priority high --phase A
tasks new shop --title "Build search page" --priority medium --depends SHOP-001
tasks next
```

Use `taskroot help` or `tasks --help` for the full CLI summary.

`next` shows `SHOP-001` as ready and `SHOP-002` waiting for its dependency. Finish the first task, then the search page becomes ready:

```sh
tasks status SHOP-001 in_progress
tasks done SHOP-001 --evidence "API contract merged in PR #42"
tasks next
```

Replay the workflow with the [executable demo](examples/demo.mjs): run `node examples/demo.mjs` from a clone. It also shows milestone progress and JSON output, then removes its temporary backlog.

## Milestones

Create a shared `tasks/milestones.json` file to group work across projects:

```json
{
  "M1": {
    "name": "Search MVP",
    "goal": "Let customers find products"
  }
}
```

Assign tasks with `--milestone M1`, then run `tasks milestones` to see progress and dependency state. The executable demo includes this setup.

Taskroot finds the nearest ancestor `tasks/` directory containing project files. You can set `TASKS_DIR` to use a specific backlog root.

```text
tasks/
  milestones.json             # optional shared milestones
  app/
    tasks.json                # project metadata and tasks
```

Each project has a unique alphanumeric prefix. IDs use `<PREFIX>-NNN`. Commit `tasks/` with your source repository to review backlog changes alongside code.

## Commands

| Command | Description |
| --- | --- |
| `tasks init <project> [--prefix APP] [--project name] [--repo name]` | Create a project backlog. |
| `tasks new <project> --title "..."` | Create a task. Accepts `--description`, `--status`, `--priority`, `--phase`, `--milestone`, `--depends`, and `--repo`. |
| `tasks list [--all] [--project name] [--status pending] [--priority high] [--milestone M1]` | List tasks and counts. By default, hides completed and cancelled tasks. |
| `tasks next [--limit 10] [--project name] [--status pending] [--priority high] [--milestone M1]` | Show ready tasks, ordered by priority. |
| `tasks show <ID>` | Show task details and status history. |
| `tasks edit <ID> [--title "..."] [--description "..."] [--status ...]` | Update task fields, including priority, phase, milestone, dependencies, and repo. Use `--depends ""` to clear dependencies. |
| `tasks status <ID> <status> [--evidence "..."]` | Change status and record evidence. |
| `tasks done <ID> [--evidence "..."]` | Complete a task. |
| `tasks milestones` | Show milestone progress and tasks without milestones. |
| `tasks check` | Validate project data, IDs, dependencies, cycles, and fields. |

Statuses: `pending`, `in_progress`, `blocked`, `completed`, `cancelled`. Priorities: `high`, `medium`, `low`.

Add `--json` to commands for structured output. JSON results use `{ "ok", "command", "data" }`; errors use `{ "ok": false, "command", "error": { "message" } }`.

## Safe local writes

Mutating commands coordinate through a lock in the backlog root and replace JSON files atomically. If a process is stopped while holding the lock, it may need manual recovery. Check the PID in `tasks/.tasks.lock` and confirm no Taskroot command is running before removing it. Commands time out after ten seconds instead of overwriting data.

This lock coordinates Taskroot processes using this version. Editors and older versions do not participate. Network filesystems have not been validated.

## Agent setup

Add this short instruction to a repository's `AGENTS.md`:

```text
Project backlog lives in tasks/.
Before coding, run tasks next --json and tasks show <ID> --json.
Work on a ready task and keep existing task IDs unchanged.
After tests pass, run tasks done <ID> --evidence "tests passed".
Run tasks check before closing work.
```

## Development

```sh
npm install
npm test
npm pack --dry-run
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution steps and [CHANGELOG.md](CHANGELOG.md) for release notes.

# Taskroot

Taskroot is a local-first backlog for developers and coding agents. It stores ordinary JSON files in your repository, tracks dependencies between tasks, and has no runtime dependencies.

The CLI prints aligned tables for task lists, readiness, summaries, and milestones. Messages follow the system language in Portuguese or English.

## Requirements

- Node.js 22 or newer
- macOS, Linux, or Windows

## Install

```sh
npm install --global taskroot
tasks --help
```

The npm package is named `taskroot` and installs both `tasks` and `taskroot` commands.

## Quick start

Run these commands from a repository root:

```sh
tasks init shop --prefix SHOP --repo acme/shop
tasks new shop --title "Add catalog endpoint" --priority high --phase A
tasks new shop --title "Build search page" --priority medium --depends SHOP-001
tasks next
```

`next` lists ready tasks first and shows tasks waiting on dependencies in a separate table. After the endpoint is complete, the search page becomes ready:

```sh
tasks status SHOP-001 in_progress
tasks done SHOP-001 --evidence "API contract merged in PR #42"
tasks next
```

Search task titles and descriptions with `--search`. Search is case-insensitive and combines with the existing filters:

```sh
tasks list --all --search "catalog"
tasks next --priority high --search "API"
```

The [executable demo](examples/demo.mjs) runs this workflow with dependencies, milestones, JSON output, and status history. Run `node examples/demo.mjs` from a clone; it creates and removes a temporary backlog.

## Projects and milestones

Taskroot finds the nearest ancestor `tasks/` directory containing project files. Set `TASKS_DIR` to choose a specific backlog root.

```text
tasks/
  milestones.json             # optional shared milestones
  shop/
    tasks.json                # project metadata and tasks
```

Create milestones in `tasks/milestones.json`:

```json
{
  "schema_version": 1,
  "milestones": {
    "M1": {
      "name": "Search MVP",
      "goal": "Let customers find products"
    }
  }
}
```

Assign tasks with `--milestone M1`, then run `tasks milestones` to see progress and dependency state. Each project uses a unique alphanumeric prefix; generated IDs follow `<PREFIX>-NNN`. Commit `tasks/` with your source so backlog changes can be reviewed alongside code.

## Data format and compatibility

New project files include `"schema_version": 1`. Existing unversioned `tasks.json` files remain readable and receive version 1 on their next successful write. Taskroot rejects files that declare an unsupported version.

Legacy flat `milestones.json` files remain readable. New milestone files use the versioned envelope shown above. Run `tasks check` to validate task files, IDs, dependencies, cycles, and milestone references.

## Commands

| Command | Description |
| --- | --- |
| `tasks init <project> [--prefix APP] [--project name] [--repo name]` | Create a project backlog. |
| `tasks new <project> --title "..."` | Create a task. Accepts `--description`, `--status`, `--priority`, `--phase`, `--milestone`, `--depends`, and `--repo`. |
| `tasks list [--all] [--project name] [--status pending] [--priority high] [--milestone M1] [--search text]` | List tasks and counts. Hides completed and cancelled tasks by default. Search checks title and description. |
| `tasks next [--limit 10] [--project name] [--status pending] [--priority high] [--milestone M1] [--search text]` | Show ready tasks and tasks blocked by dependencies, ordered by priority. |
| `tasks show <ID>` | Show task details and status history. |
| `tasks edit <ID> [options]` | Update title, description, status, priority, phase, milestone, dependencies, repo, or evidence. Use `--depends ""` to clear dependencies. |
| `tasks status <ID> <status> [--evidence "..."]` | Change status and record evidence. |
| `tasks done <ID> [--evidence "..."]` | Complete a task. |
| `tasks milestones` | Show milestone progress and tasks without milestones. |
| `tasks check` | Validate project data, IDs, dependencies, cycles, and fields. |

Statuses: `pending`, `in_progress`, `blocked`, `completed`, `cancelled`. Priorities: `high`, `medium`, `low`.

Add `--json` for structured output. JSON values keep canonical status and priority names regardless of the CLI language. Successful results use `{ "ok", "command", "data" }`; errors use `{ "ok": false, "command", "error": { "message" } }`.

## CLI language

Taskroot follows `LC_ALL`, `LC_MESSAGES`, or `LANG`, then the runtime's system locale. It supports Portuguese and English. Set `TASKROOT_LANG` to override the detected language:

```sh
TASKROOT_LANG=pt tasks --help
TASKROOT_LANG=en tasks --help
```

The README and examples use English; CLI labels and messages are localized without changing stored JSON values.

## Safe local writes

Mutating commands coordinate through a PID lock in the backlog root and replace JSON files atomically. Taskroot recovers a lock when its recorded process has exited, and preserves locks owned by active processes. Commands wait up to ten seconds before reporting a lock conflict.

The lock coordinates Taskroot processes using this version. Editors and older versions do not participate. Network filesystems have not been validated.

## Agent setup

Add this instruction to a repository's `AGENTS.md`:

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

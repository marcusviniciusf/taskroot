import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../bin/tasks.mjs", import.meta.url));
const root = mkdtempSync(join(tmpdir(), "taskroot-demo-"));
const env = { ...process.env, TASKS_DIR: root };
writeFileSync(join(root, "milestones.json"), JSON.stringify({
  M1: { name: "Search MVP", goal: "Let customers find products" },
}));

function run(...args) {
  const result = spawnSync(process.execPath, [cli, ...args], { env, encoding: "utf8" });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`tasks ${args.join(" ")} exited with ${result.status}`);
}

try {
  run("init", "shop", "--prefix", "SHOP", "--repo", "acme/shop");
  run("new", "shop", "--title", "Add catalog endpoint", "--priority", "high", "--phase", "A", "--milestone", "M1");
  run("new", "shop", "--title", "Build search page", "--priority", "medium", "--depends", "SHOP-001", "--milestone", "M1");
  run("next");
  run("milestones");
  run("status", "SHOP-001", "in_progress");
  run("done", "SHOP-001", "--evidence", "API contract merged in PR #42");
  run("next");
  run("milestones");
  run("show", "SHOP-002", "--json");
  run("list", "--project", "shop", "--status", "pending", "--json");
  run("check");
} finally {
  rmSync(root, { recursive: true, force: true });
}

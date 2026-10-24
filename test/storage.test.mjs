import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { withRootLock, writeJsonAtomic } from "../lib/storage.mjs";

const cli = fileURLToPath(new URL("../bin/tasks.mjs", import.meta.url));
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "tasks-storage-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "app"));
  writeFileSync(join(root, "app", "tasks.json"), JSON.stringify({ prefix: "APP", tasks: [] }));
  return root;
}
function run(root, ...args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], {
      env: { ...process.env, TASKS_DIR: root },
    });
    let output = "";
    child.stdout.on("data", chunk => { output += chunk; });
    child.stderr.on("data", chunk => { output += chunk; });
    child.on("error", reject);
    child.on("close", code => resolve({ code, output }));
  });
}
function read(root) {
  return JSON.parse(readFileSync(join(root, "app", "tasks.json"), "utf8"));
}

test("concurrent creations preserve every task and generate unique IDs", async t => {
  const root = fixture(t);
  const results = await Promise.all(Array.from({ length: 30 }, (_, i) =>
    run(root, "new", "app", "--title", `Task ${i}`)));
  for (const result of results) assert.equal(result.code, 0, result.output);
  const { tasks } = read(root);
  assert.equal(tasks.length, 30);
  assert.equal(new Set(tasks.map(task => task.id)).size, 30);
  assert.equal(new Set(tasks.map(task => task.title)).size, 30);
  const check = await run(root, "check");
  assert.equal(check.code, 0, check.output);
  assert.deepEqual(readdirSync(root), ["app"]);
});

test("concurrent completions do not overwrite other task updates", async t => {
  const root = fixture(t);
  for (let i = 0; i < 8; i++) {
    const result = await run(root, "new", "app", "--title", `Task ${i}`);
    assert.equal(result.code, 0, result.output);
  }
  const results = await Promise.all(read(root).tasks.map(task => run(root, "done", task.id)));
  for (const result of results) assert.equal(result.code, 0, result.output);
  assert.ok(read(root).tasks.every(task => task.status === "completed"));
});

test("invalid commands release the lock and leave data unchanged", async t => {
  const root = fixture(t);
  const invalid = await run(root, "new", "app");
  assert.equal(invalid.code, 1);
  assert.equal(read(root).tasks.length, 0);
  assert.deepEqual(readdirSync(root), ["app"]);
  const valid = await run(root, "new", "app", "--title", "Valid");
  assert.equal(valid.code, 0, valid.output);
});

test("existing locks time out without deleting the owner's lock", t => {
  const root = fixture(t);
  const lock = join(root, ".tasks.lock");
  writeFileSync(lock, "owner\n");
  assert.throws(() => withRootLock(root, () => assert.fail("must not run"), { timeoutMs: 25 }), /backlog ocupado/);
  assert.equal(readFileSync(lock, "utf8"), "owner\n");
});

test("failed serialization preserves the original file and cleans temporary files", t => {
  const root = fixture(t);
  const file = join(root, "app", "tasks.json");
  const original = readFileSync(file, "utf8");
  assert.throws(() => writeJsonAtomic(file, { invalid: 1n }), TypeError);
  assert.equal(readFileSync(file, "utf8"), original);
  assert.deepEqual(readdirSync(join(root, "app")), ["tasks.json"]);
});

test("parallel initialization cannot overwrite an existing project", async t => {
  const root = fixture(t);
  const results = await Promise.all([
    run(root, "init", "other", "--prefix", "ONE"),
    run(root, "init", "other", "--prefix", "TWO"),
  ]);
  assert.deepEqual(results.map(result => result.code).sort(), [0, 1]);
  const data = JSON.parse(readFileSync(join(root, "other", "tasks.json"), "utf8"));
  assert.ok(["ONE", "TWO"].includes(data.prefix));
  assert.deepEqual(data.tasks, []);
});

test("initialization rejects duplicate prefixes and traversal project names", async t => {
  const root = fixture(t);
  const duplicate = await run(root, "init", "other", "--prefix", "app");
  assert.equal(duplicate.code, 1);
  assert.match(duplicate.output, /prefixo duplicado/);
  const traversal = await run(root, "init", "../outside");
  assert.equal(traversal.code, 1);
  assert.equal(readFileSync(join(root, "app", "tasks.json"), "utf8").includes("outside"), false);
});

test("creation rejects missing or blank titles without changing data", async t => {
  const root = fixture(t);
  for (const args of [["--title"], ["--title", "   "]]) {
    const result = await run(root, "new", "app", ...args);
    assert.equal(result.code, 1);
  }
  assert.equal(read(root).tasks.length, 0);
});

test("check reports invalid dependency shapes without crashing", async t => {
  const root = fixture(t);
  const document = read(root);
  document.tasks.push({ id: "APP-001", title: "Broken", status: "pending", depends_on: 42 });
  writeFileSync(join(root, "app", "tasks.json"), JSON.stringify(document));
  const result = await run(root, "check");
  assert.equal(result.code, 1);
  assert.match(result.output, /depends_on deve ser uma lista/);
  assert.doesNotMatch(result.output, /TypeError/);
});

test("check reports duplicate IDs and prefixes across projects", async t => {
  const root = fixture(t);
  const app = read(root);
  app.tasks.push({ id: "APP-001", title: "One", status: "pending" });
  writeFileSync(join(root, "app", "tasks.json"), JSON.stringify(app));
  mkdirSync(join(root, "other"));
  writeFileSync(join(root, "other", "tasks.json"), JSON.stringify({ prefix: "app", tasks: [
    { id: "app-001", title: "Duplicate", status: "pending" },
  ] }));
  const result = await run(root, "check");
  assert.equal(result.code, 1);
  assert.match(result.output, /prefixo duplicado APP/);
  assert.match(result.output, /id duplicado/);
});

test("case-insensitive completed dependencies are ready in next and milestones", async t => {
  const root = fixture(t);
  const document = read(root);
  document.tasks = [
    { id: "app-001", title: "Prerequisite", status: "completed" },
    { id: "APP-002", title: "Follow up", status: "pending", depends_on: ["APP-001"] },
  ];
  writeFileSync(join(root, "app", "tasks.json"), JSON.stringify(document));
  const next = await run(root, "next");
  assert.equal(next.code, 0, next.output);
  assert.match(next.output, /prontas para comecar: 1/);
  assert.doesNotMatch(next.output, /bloqueadas por dependencia/);
});

test("reopening a completed task archives evidence and clears completion date", async t => {
  const root = fixture(t);
  const created = await run(root, "new", "app", "--title", "Review");
  assert.equal(created.code, 0, created.output);
  const completed = await run(root, "done", "APP-001", "--evidence", "CI passed");
  assert.equal(completed.code, 0, completed.output);
  const reopened = await run(root, "status", "APP-001", "pending");
  assert.equal(reopened.code, 0, reopened.output);
  const task = read(root).tasks[0];
  assert.equal(task.status, "pending");
  assert.equal("completed_at" in task, false);
  assert.equal("evidence" in task, false);
  assert.equal(task.history.at(-1).evidence, "CI passed");
});

test("show, edit, filters, and JSON output expose structured task data", async t => {
  const root = fixture(t);
  const created = await run(root, "new", "app", "--title", "Review");
  assert.equal(created.code, 0, created.output);
  const edited = await run(root, "edit", "APP-001", "--title", "Reviewed", "--priority", "high");
  assert.equal(edited.code, 0, edited.output);
  const shown = await run(root, "show", "APP-001", "--json");
  assert.equal(shown.code, 0, shown.output);
  const payload = JSON.parse(shown.output);
  assert.equal(payload.ok, true);
  assert.equal(payload.command, "show");
  assert.equal(payload.data.title, "Reviewed");
  const filtered = await run(root, "list", "--priority", "high", "--json");
  assert.equal(JSON.parse(filtered.output).data.projects[0].tasks.length, 1);
});

test("JSON mode keeps validation failures machine-readable", async t => {
  const root = fixture(t);
  const invalidOption = await run(root, "list", "--priority", "urgent", "--json");
  assert.equal(invalidOption.code, 1);
  const optionError = JSON.parse(invalidOption.output);
  assert.equal(optionError.ok, false);
  assert.match(optionError.error.message, /prioridade invalida/);

  const document = read(root);
  document.tasks.push({ id: "APP-001", title: "Broken", status: "pending", depends_on: 42 });
  writeFileSync(join(root, "app", "tasks.json"), JSON.stringify(document));
  const check = await run(root, "check", "--json");
  assert.equal(check.code, 1);
  const payload = JSON.parse(check.output);
  assert.equal(payload.ok, false);
  assert.match(payload.data.errors[0], /depends_on/);
});

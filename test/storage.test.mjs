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
  return runWithEnv(root, {}, ...args);
}
function runWithEnv(root, envOverrides, ...args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], {
      env: { ...process.env, TASKS_DIR: root, TASKROOT_LANG: "pt", ...envOverrides },
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

test("active locks time out without deleting the owner's lock", t => {
  const root = fixture(t);
  const lock = join(root, ".tasks.lock");
  const owner = `${process.pid}\n`;
  writeFileSync(lock, owner);
  assert.throws(() => withRootLock(root, () => assert.fail("must not run"), { timeoutMs: 25 }), /locked|bloqueado/i);
  assert.equal(readFileSync(lock, "utf8"), owner);
});

test("stale locks from exited processes are recovered", async t => {
  const root = fixture(t);
  const owner = spawn(process.execPath, ["-e", "process.exit(0)"]);
  await new Promise((resolve, reject) => {
    owner.once("error", reject);
    owner.once("close", resolve);
  });
  const lock = join(root, ".tasks.lock");
  writeFileSync(lock, `${owner.pid}\n`);
  assert.equal(withRootLock(root, () => "recovered", { timeoutMs: 100 }), "recovered");
  assert.equal(readdirSync(root).includes(".tasks.lock"), false);
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

test("new projects use schema version 1 and legacy projects migrate on write", async t => {
  const root = fixture(t);
  const initialized = await run(root, "init", "other", "--prefix", "OTH");
  assert.equal(initialized.code, 0, initialized.output);
  assert.equal(JSON.parse(readFileSync(join(root, "other", "tasks.json"), "utf8")).schema_version, 1);

  assert.equal("schema_version" in read(root), false);
  const created = await run(root, "new", "app", "--title", "Migrated task");
  assert.equal(created.code, 0, created.output);
  assert.equal(read(root).schema_version, 1);
});

test("versioned and legacy milestone documents load; unsupported schemas fail", async t => {
  const root = fixture(t);
  const file = join(root, "milestones.json");
  writeFileSync(file, JSON.stringify({ M1: { name: "Legacy milestone" } }));
  const legacy = await run(root, "milestones", "--json");
  assert.equal(legacy.code, 0, legacy.output);
  assert.equal(JSON.parse(legacy.output).data.milestones[0].id, "M1");

  writeFileSync(file, JSON.stringify({ schema_version: 1, milestones: { M2: { name: "Versioned milestone" } } }));
  const versioned = await run(root, "milestones", "--json");
  assert.equal(versioned.code, 0, versioned.output);
  assert.equal(JSON.parse(versioned.output).data.milestones[0].id, "M2");

  writeFileSync(file, JSON.stringify({ schema_version: 2, milestones: {} }));
  const unsupported = await run(root, "check", "--json");
  assert.equal(unsupported.code, 1);
  assert.match(JSON.parse(unsupported.output).error.message, /versão de esquema 2/);
});

test("milestone table labels task status and readiness separately", async t => {
  const root = fixture(t);
  writeFileSync(join(root, "milestones.json"), JSON.stringify({
    schema_version: 1,
    milestones: { M1: { name: "First milestone" } },
  }));
  const document = read(root);
  document.tasks = [{ id: "APP-001", title: "Prepare release", status: "pending", milestone: "M1" }];
  writeFileSync(join(root, "app", "tasks.json"), JSON.stringify(document));

  const result = await run(root, "milestones");
  assert.equal(result.code, 0, result.output);
  assert.match(result.output, /\| ID\s+\| STATUS\s+\| TÍTULO\s+\| SITUAÇÃO\s+\|/);
  assert.match(result.output, /0\/1 concluídas, 1 em aberto/);
  assert.match(result.output, /pronta/);
});

test("unsupported task schema fails with a structured error", async t => {
  const root = fixture(t);
  const document = read(root);
  document.schema_version = 2;
  writeFileSync(join(root, "app", "tasks.json"), JSON.stringify(document));
  const result = await run(root, "list", "--json");
  assert.equal(result.code, 1);
  assert.match(JSON.parse(result.output).error.message, /versão de esquema 2/);
});

test("initialization rejects duplicate prefixes and traversal project names", async t => {
  const root = fixture(t);
  const duplicate = await run(root, "init", "other", "--prefix", "app");
  assert.equal(duplicate.code, 1);
  assert.match(duplicate.output, /prefixo APP já pertence/);
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
  assert.match(result.output, /Prefixo duplicado APP/);
  assert.match(result.output, /ID duplicado/);
});

test("case-insensitive completed dependencies are ready in next", async t => {
  const root = fixture(t);
  const document = read(root);
  document.tasks = [
    { id: "app-001", title: "Prerequisite", status: "completed" },
    { id: "APP-002", title: "Follow up", status: "pending", depends_on: ["APP-001"] },
  ];
  writeFileSync(join(root, "app", "tasks.json"), JSON.stringify(document));
  const next = await run(root, "next");
  assert.equal(next.code, 0, next.output);
  assert.match(next.output, /Prontas para começar: 1/);
  assert.doesNotMatch(next.output, /Bloqueadas por dependência/);
});

test("list and next print task rows as tables", async t => {
  const root = fixture(t);
  const created = await run(root, "new", "app", "--title", "Review tasks", "--phase", "A", "--priority", "high");
  assert.equal(created.code, 0, created.output);

  const listed = await run(root, "list", "--all");
  assert.equal(listed.code, 0, listed.output);
  assert.match(listed.output, /\| ID\s+\| STATUS\s+\| FASE\s+\| PRIORIDADE\s+\| MARCO\s+\| TÍTULO\s+\| DEPENDÊNCIAS\s+\|/);
  assert.match(listed.output, /\| APP-001\s+\| pendente\s+\| A\s+\| alta\s+\|/);
  assert.match(listed.output, /Review tasks/);

  const next = await run(root, "next");
  assert.equal(next.code, 0, next.output);
  assert.match(next.output, /\| ID\s+\| STATUS\s+\| PRIORIDADE\s+\| PROJETO\/REPO\s+\| FASE\s+\| TÍTULO\s+\|/);
  assert.match(next.output, /\| APP-001\s+\| pendente\s+\| alta\s+\| app\/\?\s+\| A\s+\| Review tasks/);
});

test("search matches title and description case-insensitively and composes with filters", async t => {
  const root = fixture(t);
  const document = read(root);
  document.tasks = [
    { id: "APP-001", title: "Improve CLI tables", description: "Align terminal output", status: "pending", priority: "high" },
    { id: "APP-002", title: "Document JSON output", description: "CLI examples in README", status: "pending", priority: "medium" },
    { id: "APP-003", title: "Old CLI guide", description: "README archive", status: "completed", priority: "low" },
  ];
  writeFileSync(join(root, "app", "tasks.json"), JSON.stringify(document));

  const listed = await run(root, "list", "--all", "--search", "cli", "--json");
  assert.equal(listed.code, 0, listed.output);
  assert.deepEqual(JSON.parse(listed.output).data.projects[0].tasks.map(task => task.id), ["APP-001", "APP-002", "APP-003"]);

  const next = await run(root, "next", "--search", "readme", "--priority", "medium", "--status", "pending", "--json");
  assert.equal(next.code, 0, next.output);
  assert.deepEqual(JSON.parse(next.output).data.ready.map(task => task.id), ["APP-002"]);

  const empty = await run(root, "list", "--search=", "--json");
  assert.equal(empty.code, 1);
  assert.match(JSON.parse(empty.output).error.message, /--search exige um texto não vazio/);
});

test("help follows the system language and supports a manual override", async t => {
  const root = fixture(t);
  const portuguese = await runWithEnv(root, { LC_ALL: "pt_BR.UTF-8", TASKROOT_LANG: "" }, "--help");
  assert.equal(portuguese.code, 0, portuguese.output);
  assert.match(portuguese.output, /\nUso\n/);
  assert.match(portuguese.output, /\nComandos\n/);
  assert.match(portuguese.output, /Cria uma tarefa com ID automático/);

  const english = await runWithEnv(root, { LC_ALL: "en_BR.UTF-8", TASKROOT_LANG: "" }, "--help");
  assert.equal(english.code, 0, english.output);
  assert.match(english.output, /\nUsage\n/);
  assert.match(english.output, /\nCommands\n/);
  assert.match(english.output, /Creates a task with an automatic ID/);

  const override = await runWithEnv(root, { LC_ALL: "en_US.UTF-8", TASKROOT_LANG: "pt-BR" }, "--help");
  assert.match(override.output, /\nUso\n/);

  const englishTask = await runWithEnv(root, { LC_ALL: "en_US.UTF-8", TASKROOT_LANG: "" }, "new", "app", "--title", "English task");
  assert.equal(englishTask.code, 0, englishTask.output);
  const englishTable = await runWithEnv(root, { LC_ALL: "en_US.UTF-8", TASKROOT_LANG: "" }, "list", "--all");
  assert.equal(englishTable.code, 0, englishTable.output);
  assert.match(englishTable.output, /\| ID\s+\| STATUS\s+\| PHASE\s+\| PRIORITY\s+\| MILESTONE\s+\| TITLE\s+\| DEPENDENCIES\s+\|/);
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
  assert.match(optionError.error.message, /Prioridade inválida/);

  const document = read(root);
  document.tasks.push({ id: "APP-001", title: "Broken", status: "pending", depends_on: 42 });
  writeFileSync(join(root, "app", "tasks.json"), JSON.stringify(document));
  const check = await run(root, "check", "--json");
  assert.equal(check.code, 1);
  const payload = JSON.parse(check.output);
  assert.equal(payload.ok, false);
  assert.match(payload.data.errors[0], /depends_on/);
});

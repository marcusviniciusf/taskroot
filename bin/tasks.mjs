#!/usr/bin/env node
// Backlog CLI — sem dependencias. Le os dados de <cwd>/tasks (ou TASKS_DIR).
// Cada projeto e uma pasta com tasks.json e um "prefix" proprio.
// Uso: tasks <comando> [args]

import {
  readFileSync,
  readdirSync,
  existsSync,
  mkdirSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { withRootLock, writeJsonAtomic } from "../lib/storage.mjs";
import { CommandExit, DONE, PRIORITIES, RANK, READY_OK, STATUSES, autoPrefix, documentProblems, inferPrefix, nextId, normalizeId, requireText, validateArgs, validateProjectName } from "../lib/validation.mjs";

const today = () => new Date().toISOString().slice(0, 10);

function hasProjects(root) {
  try {
    return readdirSync(root, { withFileTypes: true }).some(
      (d) => d.isDirectory() && existsSync(join(root, d.name, "tasks.json")),
    );
  } catch {
    return false;
  }
}

// Sobe do cwd ate achar uma pasta tasks/ com projetos; TASKS_DIR tem prioridade.
function resolveRoot() {
  if (process.env.TASKS_DIR) return process.env.TASKS_DIR;
  let dir = process.cwd();
  for (;;) {
    const cand = join(dir, "tasks");
    if (hasProjects(cand)) return cand;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return join(process.cwd(), "tasks");
}

const ROOT = resolveRoot();

function projectDirs() {
  if (!existsSync(ROOT)) return [];
  return readdirSync(ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(ROOT, d.name, "tasks.json")))
    .map((d) => d.name)
    .sort();
}

function load() {
  const db = {};
  for (const name of projectDirs()) {
    const file = join(ROOT, name, "tasks.json");
    let data;
    try {
      data = JSON.parse(readFileSync(file, "utf8"));
    } catch (error) {
      throw new Error(`${file}: JSON invalido (${error.message})`);
    }
    if (!data || typeof data !== "object" || Array.isArray(data))
      throw new Error(`${file}: documento deve ser um objeto JSON`);
    if (!Array.isArray(data.tasks))
      throw new Error(`${file}: tasks deve ser um array`);
    db[name] = { file, data };
  }
  return db;
}

function save(entry) {
  entry.data.updated_at = today();
  writeJsonAtomic(entry.file, entry.data);
}

const MILESTONES_FILE = join(ROOT, "milestones.json");

function loadMilestones() {
  if (!existsSync(MILESTONES_FILE)) return {};
  let data;
  try {
    data = JSON.parse(readFileSync(MILESTONES_FILE, "utf8"));
  } catch (error) {
    throw new Error(`${MILESTONES_FILE}: JSON invalido (${error.message})`);
  }
  if (!data || typeof data !== "object" || Array.isArray(data))
    throw new Error(`${MILESTONES_FILE}: documento deve ser um objeto JSON`);
  for (const [id, milestone] of Object.entries(data)) {
    if (!milestone || typeof milestone !== "object" || Array.isArray(milestone))
      throw new Error(`${MILESTONES_FILE}: ${id} deve ser um objeto`);
  }
  return data;
}

function allTasks(db) {
  const out = [];
  for (const [proj, { data }] of Object.entries(db)) {
    for (const t of data.tasks || []) out.push({ proj, t, repo: t?.repo || data.repo });
  }
  return out;
}

function findTask(db, id) {
  const up = normalizeId(id);
  const matches = allTasks(db).filter((x) => normalizeId(x.t.id) === up);
  return matches.length === 1 ? matches[0] : undefined;
}

function parseArgs(argv) {
  const flags = {};
  const pos = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const [k, inline] = a.slice(2).split(/=(.*)/s);
      if (Object.hasOwn(flags, k)) {
        console.error(`opcao repetida: --${k}`);
        throw new CommandExit(1);
      }
      if (inline !== undefined) flags[k] = inline;
      else if (argv[i + 1] && !argv[i + 1].startsWith("--")) flags[k] = argv[++i];
      else flags[k] = true;
    } else pos.push(a);
  }
  return { flags, pos };
}

function counts(db) {
  const per = {};
  for (const [proj, { data }] of Object.entries(db)) {
    const c = {};
    for (const t of data.tasks || []) c[t.status] = (c[t.status] || 0) + 1;
    per[proj] = { total: (data.tasks || []).length, ...c };
  }
  return per;
}

function cmdList(db, { flags }) {
  const onlyPending = !flags.all && !flags.status;
  const projects = [];
  if (flags.project && !Object.hasOwn(db, flags.project)) {
    console.error(`projeto desconhecido: ${flags.project}`);
    throw new CommandExit(1);
  }
  for (const [proj, { data }] of Object.entries(db)) {
    const tasks = (data.tasks || []).filter(
      (t) =>
        (!flags.project || proj === flags.project) &&
        (!flags.status || t.status === flags.status) &&
        (!flags.priority || t.priority === flags.priority) &&
        (!onlyPending || (t.status !== DONE && t.status !== "cancelled")) &&
        (!flags.milestone || t.milestone === flags.milestone),
    );
    if (!tasks.length) continue;
    projects.push({ project: proj, repo: data.repo ?? null, total: data.tasks.length, tasks });
    console.log(
      `\n${proj.toUpperCase()}  (${data.repo || "?"})  ${tasks.length} de ${(data.tasks || []).length}`,
    );
    for (const t of tasks) {
      const dep = t.depends_on?.length ? ` deps=${t.depends_on.join(",")}` : "";
      const ms = t.milestone ? `${t.milestone} ` : "";
      console.log(
        `  ${ms}${t.id} [${t.status}] [${t.phase ?? "-"}] ${t.priority ?? "-"}  ${t.title}${dep}`,
      );
    }
  }
  const per = counts(db);
  if (!Object.keys(per).length) {
    console.log(`sem projetos em ${ROOT} (rode: tasks init <projeto>)`);
    return { projects: [], summary: per };
  }
  console.log("\nresumo:");
  for (const [proj, c] of Object.entries(per)) {
    console.log(
      `  ${proj.padEnd(9)} total ${c.total} | pending ${c.pending || 0} | in_progress ${c.in_progress || 0} | blocked ${c.blocked || 0} | done ${c.completed || 0}`,
    );
  }
  return { projects, summary: per };
}

function cmdNext(db, { flags }) {
  const limit = Number(flags.limit || 10);
  if (flags.project && !Object.hasOwn(db, flags.project)) {
    console.error(`projeto desconhecido: ${flags.project}`);
    throw new CommandExit(1);
  }
  const done = new Set(allTasks(db).filter((x) => x.t.status === DONE).map((x) => normalizeId(x.t.id)));
  const all = allTasks(db);
  const ready = [];
  const waiting = [];
  for (const x of all) {
    if (!READY_OK.includes(x.t.status)) continue;
    if (flags.project && x.proj !== flags.project) continue;
    if (flags.status && x.t.status !== flags.status) continue;
    if (flags.priority && x.t.priority !== flags.priority) continue;
    if (flags.milestone && x.t.milestone !== flags.milestone) continue;
    const missing = (x.t.depends_on || []).filter((d) => !done.has(normalizeId(d)));
    (missing.length ? waiting : ready).push({ ...x, missing });
  }
  const rank = (x) => [RANK[x.t.priority] ?? 9, String(x.t.phase || ""), String(x.t.id)];
  ready.sort((a, b) => {
    const [pa, pha, ia] = rank(a);
    const [pb, phb, ib] = rank(b);
    return pa - pb || pha.localeCompare(phb) || ia.localeCompare(ib);
  });

  console.log(`prontas para comecar: ${ready.length}`);
  for (const x of ready.slice(0, limit)) {
    console.log(
      `  ${x.t.id} [${x.proj}/${x.repo || "?"}] [${x.t.phase ?? "-"}] ${x.t.priority ?? "-"}  ${x.t.title}`,
    );
  }
  if (waiting.length) {
    console.log(`\nbloqueadas por dependencia: ${waiting.length}`);
    for (const x of waiting.slice(0, limit)) {
      console.log(`  ${x.t.id}  falta: ${x.missing.join(",")}  (${x.t.title})`);
    }
  }
  return {
    ready: ready.slice(0, limit).map(x => ({ project: x.proj, repo: x.repo ?? null, ...x.t })),
    waiting: waiting.slice(0, limit).map(x => ({ project: x.proj, repo: x.repo ?? null, task: x.t, missing: x.missing })),
    total_ready: ready.length,
    total_waiting: waiting.length,
  };
}

function cmdNew(db, { flags, pos }) {
  const proj = pos[0];
  if (!proj || !db[proj]) {
    console.error(`projeto invalido. use: ${projectDirs().join(", ") || "(nenhum, rode tasks init)"}`);
    throw new CommandExit(1);
  }
  validateProjectName(proj);
  if (flags.title === undefined) {
    console.error('faltou --title "..."');
    throw new CommandExit(1);
  }
  const title = requireText(flags.title, "title");
  const id = nextId(db, proj);
  const dependsText = flags.depends === undefined ? "" : requireText(flags.depends, "depends");
  const depends = dependsText ? dependsText.split(",").map((s) => s.trim().toUpperCase()) : [];
  if (depends.some(id => !id)) {
    console.error("--depends contem um ID vazio");
    throw new CommandExit(1);
  }
  for (const d of depends) {
    if (!findTask(db, d)) {
      console.error(`dependencia inexistente: ${d}`);
      throw new CommandExit(1);
    }
  }
  const milestones = loadMilestones();
  const milestoneValue = flags.milestone ?? pos[1];
  const milestone = milestoneValue === undefined ? undefined : requireText(milestoneValue, "milestone");
  if (milestone && Object.keys(milestones).length && !milestones[milestone]) {
    console.error(`milestone invalido: ${milestone} (${Object.keys(milestones).join(", ")})`);
    throw new CommandExit(1);
  }
  const task = {
    id,
    title,
    description: flags.description === undefined ? "" : requireText(flags.description, "description", { allowEmpty: true }),
    status: flags.status === undefined ? "pending" : requireText(flags.status, "status"),
    priority: flags.priority === undefined ? "medium" : requireText(flags.priority, "priority"),
    phase: flags.phase === undefined ? "A" : requireText(flags.phase, "phase"),
    ...(milestone ? { milestone } : {}),
    ...(flags.repo === undefined ? {} : { repo: requireText(flags.repo, "repo") }),
    ...(flags.status === "completed" ? { completed_at: today() } : {}),
    created_at: today(),
    updated_at: today(),
    ...(depends.length ? { depends_on: depends } : {}),
  };
  if (!STATUSES.includes(task.status)) {
    console.error(`status invalido: ${task.status} (${STATUSES.join(", ")})`);
    throw new CommandExit(1);
  }
  if (!PRIORITIES.includes(task.priority)) {
    console.error(`prioridade invalida: ${task.priority} (${PRIORITIES.join(", ")})`);
    throw new CommandExit(1);
  }
  db[proj].data.tasks.push(task);
  const problems = documentProblems(db, milestones);
  if (problems.length) {
    db[proj].data.tasks.pop();
    console.error(problems.join("\n"));
    throw new CommandExit(1);
  }
  save(db[proj]);
  console.log(`criada ${id} em ${proj}: ${title}`);
  return task;
}

function cmdInit(db, { flags, pos }) {
  const proj = pos[0];
  if (!proj) {
    console.error("uso: tasks init <projeto> [--prefix APP] [--repo nome] [--project \"...\"]");
    throw new CommandExit(1);
  }
  validateProjectName(proj);
  const prefix = flags.prefix === undefined
    ? autoPrefix(proj)
    : requireText(flags.prefix, "prefix").toUpperCase();
  if (!/^[A-Z0-9]+$/.test(prefix)) {
    console.error("--prefix deve conter apenas letras e numeros");
    throw new CommandExit(1);
  }
  const project = flags.project === undefined ? proj : requireText(flags.project, "project");
  const description = flags.description === undefined
    ? ""
    : requireText(flags.description, "description", { allowEmpty: true });
  const repo = flags.repo === undefined ? undefined : requireText(flags.repo, "repo");
  for (const [existingName, { data }] of Object.entries(db)) {
    if (inferPrefix(data, existingName).toUpperCase() === prefix) {
      console.error(`prefixo duplicado: ${prefix} ja usado por ${existingName}`);
      throw new CommandExit(1);
    }
  }
  const dir = join(ROOT, proj);
  const file = join(dir, "tasks.json");
  if (existsSync(file)) {
    console.error(`ja existe: ${file}`);
    throw new CommandExit(1);
  }
  mkdirSync(dir, { recursive: true });
  const data = {
    project,
    description,
    prefix,
    ...(repo ? { repo } : {}),
    updated_at: today(),
    tasks: [],
  };
  writeJsonAtomic(file, data);
  console.log(`criado ${file} (prefix ${prefix})`);
  console.log(`proximo: tasks new ${proj} --title "primeira task"`);
  return data;
}

function cmdStatus(db, { flags, pos }) {
  const [id, status] = pos;
  const found = findTask(db, id || "");
  if (!found) {
    console.error(`task nao encontrada: ${id}`);
    throw new CommandExit(1);
  }
  if (!STATUSES.includes(status)) {
    console.error(`status invalido: ${status} (${STATUSES.join(", ")})`);
    throw new CommandExit(1);
  }
  transition(found.t, status, flags.evidence);
  save(db[found.proj]);
  console.log(`${found.t.id} -> ${status}`);
  return found.t;
}

function cmdShow(db, { pos }) {
  const found = findTask(db, pos[0]);
  if (!found) {
    console.error(`task nao encontrada ou ID ambiguo: ${pos[0]}`);
    throw new CommandExit(1);
  }
  console.log(`${found.t.id} [${found.t.status}] [${found.t.priority ?? "-"}] [${found.t.phase ?? "-"}]`);
  console.log(`projeto: ${found.proj}${found.repo ? ` (${found.repo})` : ""}`);
  console.log(`titulo: ${found.t.title}`);
  if (found.t.description) console.log(`descricao: ${found.t.description}`);
  if (found.t.milestone) console.log(`milestone: ${found.t.milestone}`);
  if (found.t.depends_on?.length) console.log(`dependencias: ${found.t.depends_on.join(", ")}`);
  if (found.t.evidence) console.log(`evidencia atual: ${found.t.evidence}`);
  if (found.t.completed_at) console.log(`concluida em: ${found.t.completed_at}`);
  if (found.t.history?.length) {
    console.log("historico:");
    for (const event of found.t.history) {
      console.log(`  ${event.at}: ${event.from_status ?? "(nova)"} -> ${event.to_status}${event.evidence ? `; evidencia: ${event.evidence}` : ""}`);
    }
  }
  return found.t;
}

function cmdEdit(db, { flags, pos }) {
  const found = findTask(db, pos[0]);
  if (!found) {
    console.error(`task nao encontrada ou ID ambiguo: ${pos[0]}`);
    throw new CommandExit(1);
  }
  const changes = Object.keys(flags).filter(key => key !== "json");
  if (!changes.length) {
    console.error('informe campos: --title, --description, --status, --priority, --phase, --milestone, --depends ou --repo');
    throw new CommandExit(1);
  }
  const original = { ...found.t, ...(found.t.depends_on ? { depends_on: [...found.t.depends_on] } : {}), ...(found.t.history ? { history: [...found.t.history] } : {}) };
  if (flags.title !== undefined) found.t.title = requireText(flags.title, "title");
  if (flags.description !== undefined) found.t.description = requireText(flags.description, "description", { allowEmpty: true });
  if (flags.priority !== undefined) found.t.priority = requireText(flags.priority, "priority");
  if (flags.phase !== undefined) found.t.phase = requireText(flags.phase, "phase");
  if (flags.repo !== undefined) found.t.repo = requireText(flags.repo, "repo");
  if (flags.milestone !== undefined) found.t.milestone = requireText(flags.milestone, "milestone");
  if (flags.status !== undefined) transition(found.t, requireText(flags.status, "status"), flags.evidence);
  if (flags.status === undefined && flags.evidence !== undefined) {
    found.t.history ??= [];
    found.t.history.push({ at: today(), from_status: found.t.status, to_status: found.t.status, evidence: flags.evidence });
    found.t.evidence = flags.evidence;
    found.t.updated_at = today();
  }
  if (flags.depends !== undefined) {
    const text = requireText(flags.depends, "depends", { allowEmpty: true });
    const dependencies = text ? text.split(",").map(id => id.trim().toUpperCase()) : [];
    if (dependencies.some(id => !id)) {
      Object.assign(found.t, original);
      console.error("--depends contem um ID vazio");
      throw new CommandExit(1);
    }
    found.t.depends_on = dependencies;
    if (!dependencies.length) delete found.t.depends_on;
  }

  const problems = documentProblems(db, loadMilestones());
  if (problems.length) {
    for (const key of Object.keys(found.t)) delete found.t[key];
    Object.assign(found.t, original);
    console.error(problems.join("\n"));
    throw new CommandExit(1);
  }
  found.t.updated_at = today();
  save(db[found.proj]);
  console.log(`atualizada ${found.t.id}: ${changes.filter(key => key !== "json").join(", ")}`);
  return { task: found.t, changed_fields: changes.filter(key => key !== "json") };
}

function transition(task, status, evidence) {
  const previousStatus = task.status;
  const previousEvidence = task.evidence;
  const changed = previousStatus !== status || evidence !== undefined;
  if (changed) {
    task.history ??= [];
    task.history.push({
      at: today(),
      from_status: previousStatus,
      to_status: status,
      ...(evidence !== undefined ? { evidence } : previousEvidence !== undefined ? { evidence: previousEvidence } : {}),
    });
  }
  task.status = status;
  task.updated_at = today();
  if (status === DONE) task.completed_at = today();
  else if (previousStatus === DONE) {
    delete task.completed_at;
    delete task.evidence;
  }
  if (evidence !== undefined) task.evidence = evidence;
}

function cmdMilestones(db) {
  const milestones = loadMilestones();
  const keys = Object.keys(milestones);
  if (!keys.length) {
    console.log("sem milestones.json");
    return [];
  }
  const all = allTasks(db);
  const doneIds = new Set(all.filter((x) => x.t.status === DONE).map((x) => normalizeId(x.t.id)));
  const result = [];
  for (const key of keys) {
    const meta = milestones[key];
    const tasks = all.filter((x) => x.t.milestone === key);
    const done = tasks.filter((x) => x.t.status === DONE).length;
    const open = tasks.filter((x) => x.t.status !== DONE && x.t.status !== "cancelled");
    result.push({
      id: key,
      ...meta,
      total: tasks.length,
      completed: done,
      open: open.map(x => ({
        project: x.proj,
        task: x.t,
        state: (x.t.depends_on || []).some(d => !doneIds.has(normalizeId(d)))
          ? "blocked_by_dependency"
          : READY_OK.includes(x.t.status) ? "ready" : x.t.status,
      })),
    });
    console.log(`\n${key} — ${meta.name}   (${done}/${tasks.length} concluidas, ${open.length} abertas)`);
    if (meta.goal) console.log(`  ${meta.goal}`);
    for (const x of open) {
      const missing = (x.t.depends_on || []).filter((d) => !doneIds.has(normalizeId(d)));
      const state = missing.length
        ? `bloqueada (falta ${missing.join(",")})`
        : READY_OK.includes(x.t.status)
          ? "pronta"
          : x.t.status;
      console.log(`  - ${x.t.id} [${x.t.status}] ${x.t.title}  -> ${state}`);
    }
  }
  const orphan = all.filter((x) => !x.t.milestone && x.t.status !== "cancelled" && x.t.status !== DONE);
  if (orphan.length) {
    console.log(`\nsem milestone: ${orphan.length}`);
    for (const x of orphan) console.log(`  - ${x.t.id} [${x.proj}] ${x.t.title}`);
  }
  return { milestones: result, without_milestone: orphan };
}

function cmdDone(db, { flags, pos }) {
  const [id] = pos;
  const found = findTask(db, id || "");
  if (!found) {
    console.error(`task nao encontrada: ${id}`);
    throw new CommandExit(1);
  }
  if (found.t.status === DONE && flags.evidence === undefined) {
    console.log(`${found.t.id} ja estava completed`);
    return found.t;
  }
  transition(found.t, DONE, flags.evidence);
  save(db[found.proj]);
  console.log(`${found.t.id} -> completed${flags.evidence ? ` (${flags.evidence})` : ""}`);
  return found.t;
}

function cmdCheck(db) {
  const all = allTasks(db);
  const problems = documentProblems(db, loadMilestones());

  const valid = all.filter(x => x.t && typeof x.t === "object" && !Array.isArray(x.t));
  const total = all.length;
  const pending = valid.filter((x) => x.t.status === "pending").length;
  const inProgress = valid.filter((x) => x.t.status === "in_progress").length;
  const blocked = valid.filter((x) => x.t.status === "blocked").length;
  const completed = valid.filter((x) => x.t.status === DONE).length;
  console.log(`tasks: ${total} | pending ${pending} | in_progress ${inProgress} | blocked ${blocked} | done ${completed}`);
  if (problems.length) {
    console.log(`\n${problems.length} problema(s):`);
    for (const p of problems) console.log(`  - ${p}`);
    return { valid: false, total, counts: { pending, in_progress: inProgress, blocked, completed }, errors: problems };
  }
  console.log("ok: nenhum problema");
  return { valid: true, total, counts: { pending, in_progress: inProgress, blocked, completed }, errors: [] };
}

const COMMANDS = {
  list: cmdList,
  next: cmdNext,
  new: cmdNew,
  init: cmdInit,
  done: cmdDone,
  status: cmdStatus,
  show: cmdShow,
  edit: cmdEdit,
  check: cmdCheck,
  milestones: cmdMilestones,
};

const [, , cmd, ...rest] = process.argv;
if (!cmd || cmd === "help" || cmd === "-h" || cmd === "--help") {
  console.log(`uso: tasks <comando>

  init <project> [--prefix APP] [--project "..."] [--repo name]
                                        cria tasks/<project>/tasks.json
  new <project> --title "..." [--description "..."] [--priority high|medium|low]
      [--status STATUS] [--phase A] [--milestone M1] [--depends ID,ID] [--repo name]
                                        cria task com ID automatico
  list [--all] [--project NAME] [--status STATUS] [--priority PRIORITY] [--milestone M1]
                                        lista tasks; por padrao oculta concluidas e canceladas
  next [--limit N] [--project NAME] [--status STATUS] [--priority PRIORITY] [--milestone M1]
                                        mostra tasks prontas e bloqueadas por dependencia
  show <ID>                             exibe detalhes e historico
  edit <ID> [--title ...] [--description ...] [--status ...] [--priority ...]
      [--phase ...] [--milestone ...] [--depends ID,ID] [--repo ...] [--evidence ...]
                                        atualiza task existente
  status <ID> <STATUS> [--evidence "..."]
                                        pending|in_progress|blocked|completed|cancelled
  done <ID> [--evidence "..."]         marca como completed
  milestones                            resume progresso dos milestones
  check                                 valida projetos, IDs, dependencias e ciclos

Adicione --json a comandos para saida estruturada. Use tasks --help para ver esta ajuda.

dados: ${ROOT}
projetos: ${projectDirs().join(", ") || "(nenhum, rode tasks init)"}
dica: rode dentro do projeto, ou defina TASKS_DIR=/caminho/tasks`);
  process.exit(0);
}
const mutation = ["new", "init", "done", "status", "edit"].includes(cmd);
const jsonOutput = rest.includes("--json") || rest.some(arg => arg.startsWith("--json="));
const originalLog = console.log;
const originalError = console.error;
const diagnostics = [];
if (jsonOutput) {
  console.log = () => {};
  console.error = (...values) => diagnostics.push(values.map(String).join(" "));
}
try {
  if (!COMMANDS[cmd]) {
    console.error(`comando desconhecido: ${cmd} (use help)`);
    throw new CommandExit(1);
  }
  const args = parseArgs(rest);
  validateArgs(cmd, args);
  const execute = () => {
    const db = load();
    if (cmd !== "check") {
      const problems = documentProblems(db, loadMilestones());
      if (problems.length) {
        console.error(`dados invalidos; execute tasks check:\n${problems.map(problem => `  - ${problem}`).join("\n")}`);
        throw new CommandExit(1);
      }
    }
    return COMMANDS[cmd](db, args);
  };
  const data = mutation ? withRootLock(ROOT, execute) : execute();
  if (jsonOutput) originalLog(JSON.stringify({ ok: data?.valid ?? true, command: cmd, data: data ?? null }));
  if (data?.valid === false) process.exitCode = 1;
} catch (error) {
  if (jsonOutput) originalLog(JSON.stringify({
    ok: false,
    command: cmd,
    error: { message: diagnostics.join("\n") || error.message || "comando invalido" },
  }));
  else if (!(error instanceof CommandExit)) console.error(error.message);
  process.exitCode = error instanceof CommandExit ? error.code : 1;
} finally {
  console.log = originalLog;
  console.error = originalError;
}

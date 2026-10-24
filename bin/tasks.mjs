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
import { displayPriority, displayStatus, language, t } from "../lib/i18n.mjs";

const today = () => new Date().toISOString().slice(0, 10);
const SCHEMA_VERSION = 1;

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
      throw new Error(t("errors.invalidJson", { file, error: error.message }));
    }
    if (!data || typeof data !== "object" || Array.isArray(data))
      throw new Error(t("errors.invalidDocument", { file }));
    if (!Array.isArray(data.tasks))
      throw new Error(t("errors.invalidTasks", { file }));
    if (data.schema_version === undefined) data.schema_version = SCHEMA_VERSION;
    else if (data.schema_version !== SCHEMA_VERSION)
      throw new Error(t("errors.unsupportedSchema", { file, version: data.schema_version, supported: SCHEMA_VERSION }));
    db[name] = { file, data };
  }
  return db;
}

function save(entry) {
  entry.data.schema_version = SCHEMA_VERSION;
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
    throw new Error(t("errors.invalidMilestone", { file: MILESTONES_FILE, error: error.message }));
  }
  if (!data || typeof data !== "object" || Array.isArray(data))
    throw new Error(t("errors.invalidMilestoneDocument", { file: MILESTONES_FILE }));
  let milestones = data;
  if (data.schema_version !== undefined) {
    if (data.schema_version !== SCHEMA_VERSION)
      throw new Error(t("errors.unsupportedSchema", { file: MILESTONES_FILE, version: data.schema_version, supported: SCHEMA_VERSION }));
    if (!data.milestones || typeof data.milestones !== "object" || Array.isArray(data.milestones))
      throw new Error(t("errors.invalidMilestonesSchema", { file: MILESTONES_FILE }));
    milestones = data.milestones;
  }
  for (const [id, milestone] of Object.entries(milestones)) {
    if (!milestone || typeof milestone !== "object" || Array.isArray(milestone))
      throw new Error(t("errors.invalidMilestoneEntry", { file: MILESTONES_FILE, id }));
  }
  return milestones;
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
        console.error(t("errors.repeatedOption", { name: k }));
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

function printTable(columns, rows) {
  if (!rows.length) {
    console.log(t("table.none"));
    return;
  }
  const values = rows.map(row => columns.map(column =>
    String(row[column.key] ?? "-").replace(/\s+/gu, " ").replaceAll("|", "\\|").trim(),
  ));
  const widths = columns.map((column, index) => values.reduce(
    (width, row) => Math.max(width, row[index].length),
    column.label.length,
  ));
  const border = `+${widths.map(width => "-".repeat(width + 2)).join("+")}+`;
  const renderRow = cells => `| ${cells.map((cell, index) => cell.padEnd(widths[index])).join(" | ")} |`;

  console.log(border);
  console.log(renderRow(columns.map(column => column.label)));
  console.log(border);
  for (const row of values) console.log(renderRow(row));
  console.log(border);
}

function matchesSearch(task, search) {
  if (!search) return true;
  const needle = search.trim().toLowerCase();
  return [task.title, task.description].some(value =>
    typeof value === "string" && value.toLowerCase().includes(needle),
  );
}

function cmdList(db, { flags }) {
  const onlyPending = !flags.all && !flags.status;
  const projects = [];
  if (flags.project && !Object.hasOwn(db, flags.project)) {
    console.error(t("errors.unknownProject", { project: flags.project }));
    throw new CommandExit(1);
  }
  for (const [proj, { data }] of Object.entries(db)) {
    const tasks = (data.tasks || []).filter(
      (t) =>
        (!flags.project || proj === flags.project) &&
        (!flags.status || t.status === flags.status) &&
        (!flags.priority || t.priority === flags.priority) &&
        matchesSearch(t, flags.search) &&
        (!onlyPending || (t.status !== DONE && t.status !== "cancelled")) &&
        (!flags.milestone || t.milestone === flags.milestone),
    );
    if (!tasks.length) continue;
    projects.push({ project: proj, repo: data.repo ?? null, total: data.tasks.length, tasks });
    console.log(`\n${t("list.projectCount", { project: proj.toUpperCase(), repo: data.repo || "?", shown: tasks.length, total: data.tasks.length })}`);
    printTable([
      { key: "id", label: t("table.id") },
      { key: "status", label: t("table.status") },
      { key: "phase", label: t("table.phase") },
      { key: "priority", label: t("table.priority") },
      { key: "milestone", label: t("table.milestone") },
      { key: "title", label: t("table.title") },
      { key: "dependencies", label: t("table.dependencies") },
    ], tasks.map(t => ({
      id: t.id,
      status: displayStatus(t.status),
      phase: t.phase,
      priority: displayPriority(t.priority),
      milestone: t.milestone,
      title: t.title,
      dependencies: t.depends_on?.join(", "),
    })));
  }
  const per = counts(db);
  if (!Object.keys(per).length) {
    console.log(t("list.empty", { root: ROOT }));
    return { projects: [], summary: per };
  }
  console.log(`\n${t("list.summary")}:`);
  printTable([
    { key: "project", label: t("table.project") },
    { key: "total", label: t("table.total") },
    { key: "pending", label: t("table.pending") },
    { key: "inProgress", label: t("table.inProgress") },
    { key: "blocked", label: t("table.blocked") },
    { key: "completed", label: t("table.completed") },
  ], Object.entries(per).map(([project, counts]) => ({
    project,
    total: counts.total,
    pending: counts.pending || 0,
    inProgress: counts.in_progress || 0,
    blocked: counts.blocked || 0,
    completed: counts.completed || 0,
  })));
  return { projects, summary: per };
}

function cmdNext(db, { flags }) {
  const limit = Number(flags.limit || 10);
  if (flags.project && !Object.hasOwn(db, flags.project)) {
    console.error(t("errors.unknownProject", { project: flags.project }));
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
    if (!matchesSearch(x.t, flags.search)) continue;
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

  console.log(t("next.ready", { count: ready.length }));
  printTable([
    { key: "id", label: t("table.id") },
    { key: "status", label: t("table.status") },
    { key: "priority", label: t("table.priority") },
    { key: "project", label: t("table.projectRepo") },
    { key: "phase", label: t("table.phase") },
    { key: "title", label: t("table.title") },
  ], ready.slice(0, limit).map(x => ({
    id: x.t.id,
    status: displayStatus(x.t.status),
    priority: displayPriority(x.t.priority),
    project: `${x.proj}/${x.repo || "?"}`,
    phase: x.t.phase,
    title: x.t.title,
  })));
  if (waiting.length) {
    console.log(`\n${t("next.blocked", { count: waiting.length })}`);
    printTable([
      { key: "id", label: t("table.id") },
      { key: "title", label: t("table.title") },
      { key: "missing", label: t("table.missing") },
    ], waiting.slice(0, limit).map(x => ({
      id: x.t.id,
      title: x.t.title,
      missing: x.missing.join(", "),
    })));
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
    console.error(t("errors.invalidProject", { projects: projectDirs().join(", ") || "(none)" }));
    throw new CommandExit(1);
  }
  validateProjectName(proj);
  if (flags.title === undefined) {
    console.error(t("errors.missingTitle"));
    throw new CommandExit(1);
  }
  const title = requireText(flags.title, "title");
  const id = nextId(db, proj);
  const dependsText = flags.depends === undefined ? "" : requireText(flags.depends, "depends");
  const depends = dependsText ? dependsText.split(",").map((s) => s.trim().toUpperCase()) : [];
  if (depends.some(id => !id)) {
    console.error(t("errors.emptyDependency"));
    throw new CommandExit(1);
  }
  for (const d of depends) {
    if (!findTask(db, d)) {
      console.error(t("errors.missingDependency", { id: d }));
      throw new CommandExit(1);
    }
  }
  const milestones = loadMilestones();
  const milestoneValue = flags.milestone ?? pos[1];
  const milestone = milestoneValue === undefined ? undefined : requireText(milestoneValue, "milestone");
  if (milestone && Object.keys(milestones).length && !milestones[milestone]) {
    console.error(t("errors.unknownMilestone", { milestone, milestones: Object.keys(milestones).join(", ") }));
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
    console.error(t("errors.invalidStatus", { status: task.status, values: STATUSES.join(", ") }));
    throw new CommandExit(1);
  }
  if (!PRIORITIES.includes(task.priority)) {
    console.error(t("errors.invalidPriority", { priority: task.priority, values: PRIORITIES.join(", ") }));
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
  console.log(t("success.createdTask", { id, project: proj, title }));
  return task;
}

function cmdInit(db, { flags, pos }) {
  const proj = pos[0];
  if (!proj) {
    console.error(t("errors.initUsage"));
    throw new CommandExit(1);
  }
  validateProjectName(proj);
  const prefix = flags.prefix === undefined
    ? autoPrefix(proj)
    : requireText(flags.prefix, "prefix").toUpperCase();
  if (!/^[A-Z0-9]+$/.test(prefix)) {
    console.error(t("errors.invalidPrefix"));
    throw new CommandExit(1);
  }
  const project = flags.project === undefined ? proj : requireText(flags.project, "project");
  const description = flags.description === undefined
    ? ""
    : requireText(flags.description, "description", { allowEmpty: true });
  const repo = flags.repo === undefined ? undefined : requireText(flags.repo, "repo");
  for (const [existingName, { data }] of Object.entries(db)) {
    if (inferPrefix(data, existingName).toUpperCase() === prefix) {
      console.error(t("errors.duplicatePrefix", { prefix, project: existingName }));
      throw new CommandExit(1);
    }
  }
  const dir = join(ROOT, proj);
  const file = join(dir, "tasks.json");
  if (existsSync(file)) {
    console.error(t("errors.fileExists", { file }));
    throw new CommandExit(1);
  }
  mkdirSync(dir, { recursive: true });
  const data = {
    schema_version: SCHEMA_VERSION,
    project,
    description,
    prefix,
    ...(repo ? { repo } : {}),
    updated_at: today(),
    tasks: [],
  };
  writeJsonAtomic(file, data);
  console.log(t("success.createdProject", { file, prefix }));
  console.log(t("success.nextTask", { project: proj }));
  return data;
}

function cmdStatus(db, { flags, pos }) {
  const [id, status] = pos;
  const found = findTask(db, id || "");
  if (!found) {
    console.error(t("errors.notFound", { id }));
    throw new CommandExit(1);
  }
  if (!STATUSES.includes(status)) {
    console.error(t("errors.invalidStatus", { status, values: STATUSES.join(", ") }));
    throw new CommandExit(1);
  }
  transition(found.t, status, flags.evidence);
  save(db[found.proj]);
  console.log(`${found.t.id} → ${displayStatus(status)}`);
  return found.t;
}

function cmdShow(db, { pos }) {
  const found = findTask(db, pos[0]);
  if (!found) {
    console.error(t("errors.ambiguousTask", { id: pos[0] }));
    throw new CommandExit(1);
  }
  console.log(`${found.t.id} [${displayStatus(found.t.status)}] [${displayPriority(found.t.priority)}] [${found.t.phase ?? "-"}]`);
  console.log(`${t("details.project")}: ${found.proj}${found.repo ? ` (${found.repo})` : ""}`);
  console.log(`${t("details.title")}: ${found.t.title}`);
  if (found.t.description) console.log(`${t("details.description")}: ${found.t.description}`);
  if (found.t.milestone) console.log(`${t("details.milestone")}: ${found.t.milestone}`);
  if (found.t.depends_on?.length) console.log(`${t("details.dependencies")}: ${found.t.depends_on.join(", ")}`);
  if (found.t.evidence) console.log(`${t("details.evidence")}: ${found.t.evidence}`);
  if (found.t.completed_at) console.log(`${t("details.completedAt")}: ${found.t.completed_at}`);
  if (found.t.history?.length) {
    console.log(`${t("details.history")}:`);
    for (const event of found.t.history) {
      const from = event.from_status ? displayStatus(event.from_status) : t("details.new");
      console.log(`  ${event.at}: ${from} → ${displayStatus(event.to_status)}${event.evidence ? `; ${t("details.evidenceHistory")}: ${event.evidence}` : ""}`);
    }
  }
  return found.t;
}

function cmdEdit(db, { flags, pos }) {
  const found = findTask(db, pos[0]);
  if (!found) {
    console.error(t("errors.ambiguousTask", { id: pos[0] }));
    throw new CommandExit(1);
  }
  const changes = Object.keys(flags).filter(key => key !== "json");
  if (!changes.length) {
    console.error(t("errors.editFields"));
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
      console.error(t("errors.emptyDependency"));
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
  console.log(t("success.updatedTask", { id: found.t.id, fields: changes.filter(key => key !== "json").join(", ") }));
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
    console.log(t("details.noMilestones"));
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
    console.log(`\n${t("details.milestoneHeading", { id: key, name: meta.name, completed: done, total: tasks.length, open: open.length })}`);
    if (meta.goal) console.log(`  ${meta.goal}`);
    printTable([
      { key: "id", label: t("table.id") },
      { key: "status", label: t("table.status") },
      { key: "title", label: t("table.title") },
      { key: "state", label: t("table.state") },
    ], open.map(x => {
      const missing = (x.t.depends_on || []).filter((d) => !doneIds.has(normalizeId(d)));
      const state = missing.length
        ? t("details.milestoneBlocked", { ids: missing.join(", ") })
        : READY_OK.includes(x.t.status)
          ? t("details.milestoneReady")
          : displayStatus(x.t.status);
      return { id: x.t.id, status: displayStatus(x.t.status), title: x.t.title, state };
    }));
  }
  const orphan = all.filter((x) => !x.t.milestone && x.t.status !== "cancelled" && x.t.status !== DONE);
  if (orphan.length) {
    console.log(`\n${t("details.orphanCount", { count: orphan.length })}`);
    printTable([
      { key: "id", label: t("table.id") },
      { key: "project", label: t("table.project") },
      { key: "title", label: t("table.title") },
    ], orphan.map(x => ({ id: x.t.id, project: x.proj, title: x.t.title })));
  }
  return { milestones: result, without_milestone: orphan };
}

function cmdDone(db, { flags, pos }) {
  const [id] = pos;
  const found = findTask(db, id || "");
  if (!found) {
    console.error(t("errors.notFound", { id }));
    throw new CommandExit(1);
  }
  if (found.t.status === DONE && flags.evidence === undefined) {
    console.log(t("errors.alreadyCompleted", { id: found.t.id }));
    return found.t;
  }
  transition(found.t, DONE, flags.evidence);
  save(db[found.proj]);
  console.log(`${t("success.completedTask", { id: found.t.id })}${flags.evidence ? ` (${flags.evidence})` : ""}`);
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
  console.log(t("errors.taskSummary", { total, pending, inProgress, blocked, completed }));
  if (problems.length) {
    console.log(`\n${t("errors.problemCount", { count: problems.length })}`);
    for (const p of problems) console.log(`  - ${p}`);
    return { valid: false, total, counts: { pending, in_progress: inProgress, blocked, completed }, errors: problems };
  }
  console.log(t("errors.checkOk"));
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

function helpText(language) {
  const data = `\n${language === "pt" ? "Dados" : "Data"}: ${ROOT}`;
  const projects = `${language === "pt" ? "Projetos" : "Projects"}: ${projectDirs().join(", ") || (language === "pt" ? "(nenhum; rode tasks init)" : "(none; run tasks init)")}`;
  const tip = language === "pt"
    ? "Dica: rode no projeto ou defina TASKS_DIR=/caminho/tasks."
    : "Tip: run inside a project or set TASKS_DIR=/path/to/tasks.";

  if (language === "pt") {
    return `Taskroot — backlog local para projetos de software

Uso
  tasks <comando> [opções]

Comandos
  init <projeto> [--prefix APP] [--project "..."] [--repo nome]
    Cria o arquivo tasks/<projeto>/tasks.json.

  new <projeto> --title "..." [opções]
    Opções: --description "...", --priority high|medium|low, --status STATUS,
            --phase FASE, --milestone MARCO, --depends ID,ID, --repo nome.
    Cria uma tarefa com ID automático.

  list [--all] [--project NOME] [--status STATUS] [--priority PRIORIDADE] [--milestone M1] [--search TEXTO]
    Lista tarefas; por padrão, oculta as concluídas e canceladas.

  next [--limit N] [--project NOME] [--status STATUS] [--priority PRIORIDADE] [--milestone M1] [--search TEXTO]
    Mostra tarefas prontas e bloqueadas por dependências.

  show <ID>
    Exibe detalhes e histórico da tarefa.

  edit <ID> [opções]
    Atualiza título, descrição, status, prioridade, fase, marco, dependências, repositório ou evidência.

  status <ID> <STATUS> [--evidence "..."]
    Status aceitos: pending, in_progress, blocked, completed, cancelled.

  done <ID> [--evidence "..."]
    Marca a tarefa como concluída.

  milestones
    Resume o progresso dos marcos.

  check
    Valida projetos, IDs, dependências e ciclos.

Saída estruturada
  Adicione --json a qualquer comando para receber JSON.

Idioma
  Segue o idioma do sistema. Para definir manualmente:
    TASKROOT_LANG=pt tasks --help
    TASKROOT_LANG=en tasks --help

Exemplos
  tasks init loja --prefix SHOP --repo organizacao/loja
  tasks new loja --title "Adicionar busca" --priority high
  tasks next
${data}
${projects}
${tip}`;
  }

  return `Taskroot — local backlog for software projects

Usage
  tasks <command> [options]

Commands
  init <project> [--prefix APP] [--project "..."] [--repo name]
    Creates tasks/<project>/tasks.json.

  new <project> --title "..." [options]
    Options: --description "...", --priority high|medium|low, --status STATUS,
            --phase PHASE, --milestone M1, --depends ID,ID, --repo name.
    Creates a task with an automatic ID.

  list [--all] [--project NAME] [--status STATUS] [--priority PRIORITY] [--milestone M1] [--search TEXT]
    Lists tasks; completed and cancelled tasks are hidden by default.

  next [--limit N] [--project NAME] [--status STATUS] [--priority PRIORITY] [--milestone M1] [--search TEXT]
    Shows ready tasks and tasks blocked by dependencies.

  show <ID>
    Shows task details and history.

  edit <ID> [options]
    Updates title, description, status, priority, phase, milestone, dependencies, repository, or evidence.

  status <ID> <STATUS> [--evidence "..."]
    Accepted statuses: pending, in_progress, blocked, completed, cancelled.

  done <ID> [--evidence "..."]
    Marks a task as completed.

  milestones
    Summarizes milestone progress.

  check
    Validates projects, IDs, dependencies, and cycles.

Structured output
  Add --json to any command to receive JSON.

Language
  Follows the system language. Override it with:
    TASKROOT_LANG=pt tasks --help
    TASKROOT_LANG=en tasks --help

Examples
  tasks init shop --prefix SHOP --repo organization/shop
  tasks new shop --title "Add search" --priority high
  tasks next
${data}
${projects}
${tip}`;
}

const [, , cmd, ...rest] = process.argv;
if (!cmd || cmd === "help" || cmd === "-h" || cmd === "--help") {
  console.log(helpText(language));
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
    console.error(t("errors.unknownCommand", { command: cmd }));
    throw new CommandExit(1);
  }
  const args = parseArgs(rest);
  validateArgs(cmd, args);
  const execute = () => {
    const db = load();
    if (cmd !== "check") {
      const problems = documentProblems(db, loadMilestones());
      if (problems.length) {
        console.error(t("errors.invalidData", { problems: problems.map(problem => `  - ${problem}`).join("\n") }));
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
    error: { message: diagnostics.join("\n") || error.message || t("validation.invalidPositionals", { command: cmd }) },
  }));
  else if (!(error instanceof CommandExit)) console.error(error.message);
  process.exitCode = error instanceof CommandExit ? error.code : 1;
} finally {
  console.log = originalLog;
  console.error = originalError;
}

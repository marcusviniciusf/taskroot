import { t as translate } from "./i18n.mjs";

export const STATUSES = ["pending", "in_progress", "blocked", "completed", "cancelled"];
export const PRIORITIES = ["high", "medium", "low"];
export const READY_OK = ["pending", "in_progress"];
export const RANK = { high: 0, medium: 1, low: 2 };
export const DONE = "completed";

export class CommandExit extends Error {
  constructor(code) { super(); this.code = code; }
}

export const normalizeId = (id) => String(id).trim().toUpperCase();

export function requireText(value, flag, { allowEmpty = false } = {}) {
  if (typeof value !== "string" || (!allowEmpty && !value.trim())) {
    console.error(translate("validation.requiresText", { flag, nonEmpty: allowEmpty ? "" : translate("validation.nonEmpty") }));
    throw new CommandExit(1);
  }
  return value.trim();
}

export function validateProjectName(project) {
  if (typeof project !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(project)) {
    console.error(translate("validation.invalidProjectName", { project }));
    throw new CommandExit(1);
  }
}

export function documentProblems(db, milestones = {}) {
  const problems = [];
  const byId = new Map();
  const prefixes = new Map();
  const validTasks = [];

  for (const [proj, { data }] of Object.entries(db)) {
    const rawPrefix = data.prefix;
    const prefix = (typeof rawPrefix === "string" && rawPrefix ? rawPrefix : inferPrefix(data, proj)).toUpperCase();
    if (rawPrefix !== undefined && (typeof rawPrefix !== "string" || !/^[A-Za-z0-9]+$/.test(rawPrefix)))
      problems.push(translate("validation.invalidPrefix", { project: proj }));
    if (prefixes.has(prefix)) problems.push(translate("validation.duplicatePrefix", { prefix, first: prefixes.get(prefix), second: proj }));
    else prefixes.set(prefix, proj);

    for (const [index, t] of data.tasks.entries()) {
      if (!t || typeof t !== "object" || Array.isArray(t)) {
        problems.push(translate("validation.invalidTask", { project: proj, index }));
        continue;
      }
      if (typeof t.id !== "string" || !t.id.trim()) {
        problems.push(translate("validation.invalidId", { project: proj, index }));
        continue;
      }
      const key = normalizeId(t.id);
      if (byId.has(key)) problems.push(translate("validation.duplicateId", { id: t.id, first: byId.get(key).proj, second: proj }));
      else byId.set(key, { proj, t });

      if (typeof t.title !== "string" || !t.title.trim())
        problems.push(translate("validation.invalidTitle", { project: proj, id: t.id }));
      if (typeof t.status !== "string" || !STATUSES.includes(t.status))
        problems.push(translate("validation.invalidTaskStatus", { project: proj, id: t.id, status: String(t.status) }));
      if (t.priority !== undefined && (typeof t.priority !== "string" || !PRIORITIES.includes(t.priority)))
        problems.push(translate("validation.invalidTaskPriority", { project: proj, id: t.id, priority: String(t.priority) }));
      if (t.description !== undefined && typeof t.description !== "string")
        problems.push(translate("validation.invalidDescription", { project: proj, id: t.id }));
      if (t.evidence !== undefined && typeof t.evidence !== "string")
        problems.push(translate("validation.invalidEvidence", { project: proj, id: t.id }));
      if (t.history !== undefined && (!Array.isArray(t.history) || t.history.some(event =>
        !event || typeof event !== "object" || Array.isArray(event) ||
        typeof event.at !== "string" || typeof event.to_status !== "string")))
        problems.push(translate("validation.invalidHistory", { project: proj, id: t.id }));
      if (t.phase !== undefined && typeof t.phase !== "string")
        problems.push(translate("validation.invalidPhase", { project: proj, id: t.id }));
      if (t.milestone !== undefined && typeof t.milestone !== "string")
        problems.push(translate("validation.invalidTaskMilestone", { project: proj, id: t.id }));
      if (t.milestone && Object.keys(milestones).length && !milestones[t.milestone])
        problems.push(translate("validation.unknownTaskMilestone", { project: proj, id: t.id, milestone: t.milestone }));
      if (t.depends_on !== undefined && (!Array.isArray(t.depends_on) ||
        t.depends_on.some(dependency => typeof dependency !== "string" || !dependency.trim())))
        problems.push(translate("validation.invalidDependencies", { project: proj, id: t.id }));
      validTasks.push({ proj, t });
    }
  }

  for (const { proj, t } of validTasks) {
    if (!Array.isArray(t.depends_on)) continue;
    for (const dependency of t.depends_on) {
      const key = normalizeId(dependency);
      if (!byId.has(key)) problems.push(translate("validation.missingTaskDependency", { project: proj, id: t.id, dependency }));
    }
  }

  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map();
  const visit = (id, path) => {
    color.set(id, GRAY);
    const { t } = byId.get(id);
    for (const dependency of Array.isArray(t.depends_on) ? t.depends_on : []) {
      const key = normalizeId(dependency);
      if (!byId.has(key)) continue;
      if (color.get(key) === GRAY) problems.push(translate("validation.cycle", { path: [...path, id, key].join(" -> ") }));
      else if ((color.get(key) ?? WHITE) === WHITE) visit(key, [...path, id]);
    }
    color.set(id, BLACK);
  };
  for (const id of byId.keys()) if ((color.get(id) ?? WHITE) === WHITE) visit(id, []);
  return problems;
}

export function validateArgs(command, { flags, pos }) {
  const specs = {
    list: { all: "boolean", json: "boolean", milestone: "value", project: "value", status: "value", priority: "value", search: "value", pos: 0 },
    next: { json: "boolean", limit: "value", milestone: "value", project: "value", status: "value", priority: "value", search: "value", pos: 0 },
    new: { title: "value", description: "value", priority: "value", status: "value", phase: "value", milestone: "value", depends: "value", repo: "value", json: "boolean", pos: 2 },
    init: { prefix: "value", repo: "value", project: "value", description: "value", json: "boolean", pos: 1 },
    done: { evidence: "value", json: "boolean", pos: 1, minPos: 1 },
    status: { evidence: "value", json: "boolean", pos: 2, minPos: 2 },
    show: { json: "boolean", pos: 1, minPos: 1 },
    edit: { title: "value", description: "value", priority: "value", status: "value", phase: "value", milestone: "value", depends: "value", repo: "value", evidence: "value", json: "boolean", pos: 1, minPos: 1 },
    check: { json: "boolean", pos: 0 },
    milestones: { json: "boolean", pos: 0 },
  }[command];
  for (const [name, value] of Object.entries(flags)) {
    if (!specs || !Object.hasOwn(specs, name) || name === "pos" || name === "minPos") {
      console.error(translate("validation.unknownOption", { command, name }));
      throw new CommandExit(1);
    }
    if (specs[name] === "boolean" && value !== true) {
      console.error(translate("validation.booleanValue", { name }));
      throw new CommandExit(1);
    }
    if (specs[name] === "value" && typeof value !== "string") {
      console.error(translate("validation.optionValue", { name }));
      throw new CommandExit(1);
    }
    if (name === "milestone" && typeof value === "string" && !value.trim()) {
      console.error(translate("validation.emptyMilestone"));
      throw new CommandExit(1);
    }
    if (name === "search" && typeof value === "string" && !value.trim()) {
      console.error(translate("errors.emptySearch"));
      throw new CommandExit(1);
    }
  }
  if (pos.length > specs.pos || (specs.minPos && pos.length < specs.minPos)) {
    console.error(translate("validation.invalidPositionals", { command }));
    throw new CommandExit(1);
  }
  if (command === "next" && flags.limit !== undefined) {
    const limit = Number(flags.limit);
    if (!Number.isSafeInteger(limit) || limit < 1) {
      console.error(translate("validation.invalidLimit"));
      throw new CommandExit(1);
    }
  }
  if (flags.status !== undefined && !STATUSES.includes(flags.status)) {
    console.error(translate("errors.invalidStatus", { status: flags.status, values: STATUSES.join(", ") }));
    throw new CommandExit(1);
  }
  if (flags.priority !== undefined && !PRIORITIES.includes(flags.priority)) {
    console.error(translate("errors.invalidPriority", { priority: flags.priority, values: PRIORITIES.join(", ") }));
    throw new CommandExit(1);
  }
}

export const autoPrefix = (proj) =>
  proj.replace(/[^a-zA-Z0-9]/g, "").slice(0, 3).toUpperCase() || "TSK";

// Prefixo: data.prefix > derivado dos IDs existentes > nome da pasta.
export function inferPrefix(data, proj) {
  if (typeof data.prefix === "string" && data.prefix) return data.prefix;
  const ids = (data.tasks || []).map((t) => String(t?.id || "")).filter(Boolean);
  const withDash = ids.find((id) => id.includes("-"));
  if (withDash) return withDash.slice(0, withDash.indexOf("-")).toUpperCase();
  return autoPrefix(proj);
}

export function nextId(db, proj) {
  const prefix = inferPrefix(db[proj].data, proj).toUpperCase();
  const nums = (db[proj].data.tasks || [])
    .map((t) => String(t.id || "").match(new RegExp(`^${prefix}-(\\d+)$`, "i"))?.[1])
    .filter(Boolean)
    .map(Number);
  const max = nums.length ? Math.max(...nums) : 0;
  return `${prefix}-${String(max + 1).padStart(3, "0")}`;
}

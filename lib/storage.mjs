import {
  closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync,
  statSync, unlinkSync, writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { t } from "./i18n.mjs";

function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === "ESRCH") return false;
    return true;
  }
}

function recoverStaleLock(lock) {
  let before;
  let content;
  try {
    before = statSync(lock);
    content = readFileSync(lock, "utf8");
  } catch (error) {
    return error.code === "ENOENT";
  }
  const pid = Number(content.trim());
  if (!Number.isSafeInteger(pid) || pid < 1 || processIsAlive(pid)) return false;

  try {
    const current = statSync(lock);
    if (before.dev !== current.dev || before.ino !== current.ino || before.mtimeMs !== current.mtimeMs ||
      content !== readFileSync(lock, "utf8")) return false;
    unlinkSync(lock);
    return true;
  } catch (error) {
    return error.code === "ENOENT";
  }
}

// Keep the entire read-modify-write operation inside this lock.
export function withRootLock(root, operation, { timeoutMs = 10000 } = {}) {
  mkdirSync(root, { recursive: true });
  const lock = join(root, ".tasks.lock");
  const deadline = Date.now() + timeoutMs;
  const sleeper = new Int32Array(new SharedArrayBuffer(4));
  let descriptor;
  for (;;) {
    try {
      descriptor = openSync(lock, "wx", 0o600);
      break;
    } catch (error) {
      // Windows may report EPERM instead of EEXIST for an exclusive-create collision.
      if (error.code !== "EEXIST" && !((error.code === "EPERM" || error.code === "EACCES") && existsSync(lock)))
        throw error;
      if (recoverStaleLock(lock)) continue;
      if (Date.now() >= deadline) {
        throw new Error(t("errors.lockBusy", { file: lock }));
      }
      Atomics.wait(sleeper, 0, 0, 20);
    }
  }
  try {
    writeFileSync(descriptor, `${process.pid}\n`);
    return operation();
  } finally {
    closeSync(descriptor);
    unlinkSync(lock);
  }
}

export function writeJsonAtomic(file, data) {
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  const mode = existsSync(file) ? statSync(file).mode & 0o777 : 0o666;
  let descriptor;
  try {
    descriptor = openSync(temporary, "wx", mode);
    writeFileSync(descriptor, `${JSON.stringify(data, null, 2)}\n`);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    renameSync(temporary, file);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

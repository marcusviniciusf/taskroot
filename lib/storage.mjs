import {
  closeSync, existsSync, fsyncSync, mkdirSync, openSync, renameSync,
  statSync, unlinkSync, writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

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
      if (Date.now() >= deadline) {
        throw new Error(`backlog ocupado: ${lock}. Se um processo foi interrompido, confirme que nenhum comando tasks esta rodando antes de remover essa trava.`);
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

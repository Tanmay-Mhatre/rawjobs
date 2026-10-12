import { existsSync, readFileSync, renameSync, rmSync, writeFileSync, type WriteFileOptions } from "node:fs";

/**
 * Write a file whole or not at all: into a temp file next to it, then renamed over it. A crash, a
 * full disk or a killed scan leaves the old file, never half of the new one.
 */
export function writeFileAtomic(path: string, data: string | NodeJS.ArrayBufferView, options?: WriteFileOptions): void {
  const tmp = `${path}.${process.pid}.tmp`;
  try {
    writeFileSync(tmp, data, options);
    renameSync(tmp, path);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }
}

/**
 * A JSON file, or undefined when it's missing. One that doesn't parse (written by an older version
 * without writeFileAtomic, or damaged on disk) is moved aside to `<name>.bad` and treated as
 * missing, so one bad file doesn't stop every scan after it.
 */
export function readJsonOrSetAside<T>(path: string, onSetAside?: (badPath: string) => void): T | undefined {
  if (!existsSync(path)) return undefined;
  const text = readFileSync(path, "utf8");
  try {
    return JSON.parse(text) as T;
  } catch {
    const bad = `${path}.bad`;
    renameSync(path, bad);
    onSetAside?.(bad);
    return undefined;
  }
}

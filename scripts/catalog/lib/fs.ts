import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Write a whole file so a reader never sees half of it: write a temporary file next to it, then
 * rename it over the target. A collector killed by its time cap leaves either the old file or the
 * new one, never a truncated one that the state save or the next run can't parse.
 */
export function writeFileAtomic(path: string, data: string | Uint8Array): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, data);
  renameSync(tmp, path);
}

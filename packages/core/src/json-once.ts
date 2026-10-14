import { existsSync, readFileSync, statSync } from "node:fs";

/** Files smaller than this are parsed every time: cheap, and small files are the ones tests rewrite in a hurry. */
const MIN_BYTES = 1_000_000;
/** How long a parsed file is kept after its last read, so a long-running server doesn't hold it for good. */
const KEEP_MS = 60_000;

const memo = new Map<string, { stamp: string; value: unknown; drop: ReturnType<typeof setTimeout> }>();

/**
 * A big JSON file (the 165k-company directory.json), parsed once while it's unchanged: a scan reads it
 * from several places (scope, moves, the dashboard files). Undefined when the file isn't there.
 * The value is shared between callers: never change it.
 */
export function readJsonOnce<T>(file: string): T | undefined {
  if (!existsSync(file)) return undefined;
  const { mtimeMs, size } = statSync(file);
  if (size < MIN_BYTES) return JSON.parse(readFileSync(file, "utf8")) as T;
  const stamp = `${mtimeMs}:${size}`;
  const hit = memo.get(file);
  if (hit) clearTimeout(hit.drop);
  const value = hit?.stamp === stamp ? hit.value : JSON.parse(readFileSync(file, "utf8"));
  const drop = setTimeout(() => memo.delete(file), KEEP_MS);
  drop.unref?.();
  memo.set(file, { stamp, value, drop });
  return value as T;
}

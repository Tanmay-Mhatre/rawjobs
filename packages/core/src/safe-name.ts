import { join, resolve, sep } from "node:path";

/**
 * Names that come from a downloaded manifest ("directory.json.gz", "jobs-lever-20261012.json.gz",
 * a shard key like "greenhouse"): letters, digits, dots, dashes and underscores, no "..", no slashes.
 */
const SAFE_NAME = /^[a-z0-9][a-z0-9_-]*(?:\.[a-z0-9_-]+)*$/i;

export const isSafeName = (name: string): boolean => SAFE_NAME.test(name) && name.length <= 128;

/** `dir/name`, or throws when the name could leave `dir` (a tampered manifest). */
export function safeJoin(dir: string, name: string): string {
  const path = join(dir, name);
  if (!isSafeName(name) || !resolve(path).startsWith(resolve(dir) + sep)) throw new Error(`refused an unsafe file name from the manifest: ${JSON.stringify(name)}`);
  return path;
}

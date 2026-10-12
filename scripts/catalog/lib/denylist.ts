/**
 * Companies removed on request (docs/shared-directory.md, "Denylist"): never published in the
 * directory or the job feed, and contributions of them are turned away. Read from the directory
 * repo's denylist.json (DENYLIST_FILE). A denylist that exists but can't be read stops the run,
 * so a takedown is never undone by a broken file.
 */
import { existsSync, readFileSync } from "node:fs";

type Rule = { key?: string; domain?: string; name?: string; reason?: string; added?: string };
export type Denylist = (c: { key?: string; name?: string; careers_url?: string }) => boolean;

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
const hostOf = (url: string | undefined) => {
  try {
    return url ? new URL(url).hostname.toLowerCase().replace(/^www\./, "") : "";
  } catch {
    return "";
  }
};

export function readDenylist(file = process.env.DENYLIST_FILE): Denylist {
  if (!file || !existsSync(file)) return () => false;
  const rules = (JSON.parse(readFileSync(file, "utf8")) as { companies?: Rule[] }).companies ?? [];
  if (!Array.isArray(rules)) throw new Error(`${file}: "companies" must be a list`);
  const keys = new Set(rules.flatMap((r) => (r.key ? [r.key.toLowerCase()] : [])));
  const names = new Set(rules.flatMap((r) => (r.name ? [norm(r.name)] : [])));
  const domains = rules.flatMap((r) => (r.domain ? [r.domain.toLowerCase().replace(/^www\./, "")] : []));
  return (c) => {
    if (c.key && keys.has(c.key.toLowerCase())) return true;
    if (c.name && names.has(norm(c.name))) return true;
    const host = hostOf(c.careers_url);
    return !!host && domains.some((d) => host === d || host.endsWith(`.${d}`));
  };
}

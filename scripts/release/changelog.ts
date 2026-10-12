import { spawnSync } from "node:child_process";
import { type ChangelogEntry, compareVersions, parseReleaseNotes } from "@rawjobs/core/release";

/**
 * The changelog the dashboard shows (Settings → About → Release notes, and "What's new" after an
 * update): every release tag's message, newest first, read from git. The bundle carries it as
 * changelog.json, so an installed copy knows what changed in every version up to its own.
 */

export type Tag = { name: string; date: string; message: string };

/** Releases up to `upTo` (and its own entry, even before it's tagged), newest first. */
export function changelogFromTags(tags: Tag[], upTo: string, ownNotes?: string, max = 60): ChangelogEntry[] {
  const pre = upTo.includes("-");
  const entries = tags
    .filter((t) => /^v\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/.test(t.name))
    .map((t) => ({ ...t, version: t.name.slice(1) }))
    // Pre-releases only in a pre-release's own changelog; nothing newer than this version.
    .filter((t) => (pre || !t.version.includes("-")) && compareVersions(t.version, upTo) <= 0)
    .map((t): ChangelogEntry => {
      const n = parseReleaseNotes(t.message);
      return { version: t.version, date: t.date, notes: n.notes, changes: n.changes, critical: n.critical };
    });
  if (ownNotes !== undefined && !entries.some((e) => e.version === upTo)) {
    const n = parseReleaseNotes(ownNotes);
    entries.push({ version: upTo, date: new Date().toISOString().slice(0, 10), notes: n.notes, changes: n.changes, critical: n.critical });
  }
  return entries.sort((a, b) => compareVersions(b.version, a.version)).slice(0, max);
}

/** This checkout's version tags with their messages and dates (none when git or tags aren't there). */
export function readTags(cwd: string): Tag[] {
  const r = spawnSync("git", ["for-each-ref", "refs/tags/v*", "--format=%(refname:short)%00%(creatordate:short)%00%(contents)%00%00"], { cwd, encoding: "utf8" });
  if (r.status !== 0 || !r.stdout) return [];
  return r.stdout
    .split("\0\0")
    .map((chunk) => chunk.replace(/^\n/, ""))
    .filter((chunk) => chunk.includes("\0"))
    .map((chunk) => {
      const [name, date, message] = chunk.split("\0");
      return { name: name!.trim(), date: date!.trim(), message: (message ?? "").trim() };
    });
}

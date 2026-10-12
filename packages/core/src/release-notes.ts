/**
 * Release notes: what a release's tag message says, in the shape the dashboard shows. No Node
 * imports, so the dashboard uses it too (release.ts re-exports it for the server and scripts).
 */

/** One line of "What's new": what kind of change, in a sentence. */
export type ReleaseChange = { type: "new" | "improved" | "fixed"; text: string };

/** One version in the changelog (bundled as changelog.json, newest first; scripts/bundle/build.ts). */
export type ChangelogEntry = { version: string; date: string; notes: string; changes: ReleaseChange[]; critical: boolean };

const CHANGE_TYPES: Record<string, ReleaseChange["type"]> = { new: "new", added: "new", improved: "improved", changed: "improved", fixed: "fixed" };

/**
 * A release's notes, from its tag message, with the lines that set how it's offered taken out:
 *   Update: mandatory     a required update (critical): the dashboard asks until you update
 *   Min-version: 0.5.0    older versions can't update by themselves (run the install line again)
 * Lines like "New: …", "Improved: …" or "Fixed: …" (also as "- New: …") are the changes the
 * dashboard shows with a tag each; any other line stays in the notes as written.
 */
export function parseReleaseNotes(text: string): { notes: string; critical: boolean; minVersion: string | null; changes: ReleaseChange[] } {
  let critical = false;
  let minVersion: string | null = null;
  const changes: ReleaseChange[] = [];
  const kept = text.split(/\r?\n/).filter((line) => {
    const change = line.match(/^\s*(?:[-*]\s+)?(new|added|improved|changed|fixed)\s*:\s*(\S.*?)\s*$/i);
    if (change) changes.push({ type: CHANGE_TYPES[change[1]!.toLowerCase()]!, text: change[2]! });
    const update = line.match(/^\s*Update:\s*(\S+)\s*$/i);
    if (update) {
      critical ||= /^(mandatory|required|critical)$/i.test(update[1]!);
      return false;
    }
    const min = line.match(/^\s*Min-version:\s*v?(\d+\.\d+\.\d+\S*)\s*$/i);
    if (min) {
      minVersion = min[1]!;
      return false;
    }
    return true;
  });
  return { notes: kept.join("\n").trim(), critical, minVersion, changes };
}

/**
 * What to show for a release: its tagged changes, or (for a release written before them) its
 * note's own lines, a "- " bullet or a sentence each, without a tag. The first line is left out when
 * it only names the release ("RawJobs 0.5.3").
 */
export function releaseItems(notes: string, changes: ReleaseChange[] = []): { type: ReleaseChange["type"] | null; text: string }[] {
  if (changes.length) return changes;
  return notes
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l, i) => l && !(i === 0 && /^RawJobs \d+\.\d+\.\d+\S*$/i.test(l)))
    .map((l) => ({ type: null, text: l.replace(/^[-*]\s+/, "") }));
}

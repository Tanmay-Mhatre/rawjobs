import { compareVersions } from "@rawjobs/core/release";

/**
 * Drafting a release: what's merged but not released yet, and the tag message to release it with,
 * from the "Release note" lines of every PR merged since the last release tag
 * (.github/pull_request_template.md). Used by `pnpm release:notes` (notes.ts) and the reminder issue.
 */

export type MergedPr = { number: number; title: string; body: string; author: string };
export type Draft = { last: string | null; next: string; prs: { pr: MergedPr; lines: string[]; from: "note" | "title" | "none" | "skip" }[]; message: string };

const TYPED = /^(new|added|improved|changed|fixed)\s*:\s*\S/i;

/**
 * A PR body's "Release note" lines: "New: …", "Improved: …", "Fixed: …". Null when the PR has no
 * such section (then its title stands in); [] when it says "none" (nothing users would notice).
 */
export function releaseNoteLines(body: string): string[] | null {
  const text = body.replace(/<!--[\s\S]*?-->/g, "");
  const m = text.match(/^#{2,3}\s*Release notes?\s*$([\s\S]*?)(?=^#{1,3}\s|(?![\s\S]))/im);
  if (!m) return null;
  const lines = m[1]!
    .split(/\r?\n/)
    .map((l) => l.trim().replace(/^[-*]\s+/, ""))
    .filter(Boolean);
  if (!lines.length || lines.every((l) => /^(none|n\/a|-)\.?$/i.test(l))) return [];
  // A line without a type is still a change worth telling: call it an improvement.
  return lines.filter((l) => !/^(none|n\/a)\.?$/i.test(l)).map((l) => (TYPED.test(l) ? l : `Improved: ${l}`));
}

/** The next version: the last release with the patch number + 1, or package.json's when that's newer. */
export function nextVersion(last: string | null, pkg: string): string {
  if (!last) return pkg;
  const [maj, min, patch] = last.replace(/^v/, "").split("-")[0]!.split(".").map(Number);
  const bumped = `${maj}.${min}.${(patch ?? 0) + 1}`;
  return compareVersions(pkg, bumped) > 0 ? pkg : bumped;
}

/** The draft tag message for these PRs. */
export function draft(last: string | null, pkg: string, prs: MergedPr[]): Draft {
  const rows = prs.map((pr) => {
    if (/\[bot\]$/.test(pr.author) || /^bump /i.test(pr.title)) return { pr, lines: [], from: "skip" as const };
    const lines = releaseNoteLines(pr.body);
    if (lines === null) return { pr, lines: [`Improved: ${pr.title}`], from: "title" as const };
    return { pr, lines, from: lines.length ? ("note" as const) : ("none" as const) };
  });
  const next = nextVersion(last, pkg);
  const changes = rows.flatMap((r) => r.lines);
  const order = (l: string) => (/^(new|added)/i.test(l) ? 0 : /^(improved|changed)/i.test(l) ? 1 : 2);
  const message = [`RawJobs ${next}`, "", ...[...changes].sort((a, b) => order(a) - order(b))].join("\n");
  return { last, next, prs: rows, message };
}

/** The reminder issue's body (release-reminder.yml). */
export function issueBody(d: Draft): string {
  const user = d.prs.filter((r) => r.from === "note" || r.from === "title");
  const list = d.prs.map((r) => {
    const why = { note: "", title: " (no release note: its title is used, edit it if needed)", none: " (no user-facing change)", skip: " (dependency update)" }[r.from];
    return `- #${r.pr.number} ${r.pr.title}${why}`;
  });
  return [
    `These pull requests are merged into main but not released yet${d.last ? ` (the last release is ${d.last})` : ""}. Installed copies get them only after you push a tag.`,
    "",
    "### Merged since the last release",
    ...list,
    "",
    user.length ? "### Release them" : "### Nothing users would notice yet",
    ...(user.length
      ? [
          "Check the message, then run:",
          "",
          "```bash",
          `git checkout main && git pull`,
          `git tag -a v${d.next} -F - <<'EOF'`,
          d.message,
          "EOF",
          `git push origin v${d.next}`,
          "```",
          "",
          "Add a line `Update: mandatory` for a fix everyone must install. Pushing the tag publishes the release, and copies download it within minutes. This issue closes by itself.",
        ]
      : ["You can still release them with a tag; there's no rush."]),
  ].join("\n");
}

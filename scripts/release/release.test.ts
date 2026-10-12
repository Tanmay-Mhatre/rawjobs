import { describe, expect, it } from "vitest";
import { changelogFromTags } from "./changelog";
import { draft, issueBody, nextVersion, releaseNoteLines } from "./draft";

describe("the bundled changelog", () => {
  const tags = [
    { name: "v0.5.3", date: "2026-10-12", message: "RawJobs 0.5.3\n- Popup fixes" },
    { name: "v0.6.0", date: "2026-10-13", message: "New: The Update button\nFixed: Old notes" },
    { name: "v0.6.1-beta.1", date: "2026-10-14", message: "New: Beta thing" },
    { name: "v0.7.0", date: "2026-10-20", message: "New: Later" },
    { name: "directory-2026-10-12", date: "2026-10-12", message: "not ours" },
  ];

  it("has every release up to this version, newest first, without pre-releases or newer ones", () => {
    const log = changelogFromTags(tags, "0.6.0");
    expect(log.map((e) => e.version)).toEqual(["0.6.0", "0.5.3"]);
    expect(log[0]!.changes).toEqual([
      { type: "new", text: "The Update button" },
      { type: "fixed", text: "Old notes" },
    ]);
  });

  it("includes pre-releases in a pre-release's own changelog, and its own notes before it's tagged", () => {
    expect(changelogFromTags(tags, "0.6.1-beta.1").map((e) => e.version)).toEqual(["0.6.1-beta.1", "0.6.0", "0.5.3"]);
    expect(changelogFromTags(tags, "0.6.2", "Fixed: Untagged yet")[0]).toMatchObject({ version: "0.6.2", changes: [{ type: "fixed" }] });
  });
});

describe("drafting a release", () => {
  const body = (note: string) => `## What and why\nStuff\n\n## Release note\n<!-- hint -->\n${note}\n\n## How I tested it\n- [x] pnpm check`;

  it("reads a PR's release note lines, 'none', or nothing when there's no section", () => {
    expect(releaseNoteLines(body("New: Deadlines\n- Fixed: Alerts\nFaster scans"))).toEqual(["New: Deadlines", "Fixed: Alerts", "Improved: Faster scans"]);
    expect(releaseNoteLines(body("none"))).toEqual([]);
    expect(releaseNoteLines(body(""))).toEqual([]);
    expect(releaseNoteLines("## What and why\nNo section")).toBeNull();
  });

  it("picks the next version: the patch + 1, or package.json's when newer", () => {
    expect(nextVersion("v0.5.3", "0.5.0")).toBe("0.5.4");
    expect(nextVersion("v0.5.3", "0.6.0")).toBe("0.6.0");
    expect(nextVersion(null, "0.6.0")).toBe("0.6.0");
  });

  it("drafts the tag message: notes first by kind, titles for PRs without a note, no bot PRs", () => {
    const d = draft("v0.5.3", "0.5.0", [
      { number: 1, title: "Pill", body: body("Fixed: Alerts\nNew: Update button"), author: "me" },
      { number: 2, title: "CI cleanup", body: body("none"), author: "me" },
      { number: 3, title: "Bump vitest", body: "", author: "dependabot[bot]" },
      { number: 4, title: "Faster scans", body: "no template", author: "me" },
    ]);
    expect(d.next).toBe("0.5.4");
    expect(d.message).toBe("RawJobs 0.5.4\n\nNew: Update button\nImproved: Faster scans\nFixed: Alerts");
    const issue = issueBody(d);
    expect(issue).toMatch(/git tag -a v0\.5\.4 -F - <<'EOF'/);
    expect(issue).toMatch(/#4 Faster scans \(no release note/);
    expect(issue).toMatch(/#3 Bump vitest \(dependency update\)/);
  });
});

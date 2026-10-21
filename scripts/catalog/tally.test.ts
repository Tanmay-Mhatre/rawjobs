import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { tally, tallyMarkdown } from "./tally";

const since = "2026-10-21T03:00:00.000Z";

function state(): string {
  const dir = mkdtempSync(join(tmpdir(), "rawjobs-tally-"));
  for (const d of ["out", "raw/wayback", "raw/commoncrawl"]) mkdirSync(join(dir, d), { recursive: true });
  const check = (key: string, status: string, checked_at: string) => JSON.stringify({ key, status, checked_at });
  writeFileSync(join(dir, "out", "checks.jsonl"), [check("a", "live", "2026-10-14T00:00:00Z"), check("b", "dead", "2026-10-21T04:00:00Z"), ""].join("\n"));
  // Another process's file, and a later check of a: both fold in.
  writeFileSync(join(dir, "out", "checks-known.jsonl"), `${check("a", "live", "2026-10-21T05:00:00Z")}\n`);
  const lookup = (status: string, resolved_at: string) => ({ name: status, website: "", industries: [], status, pages: 0, resolved_at });
  writeFileSync(join(dir, "out", "resolved.json"), JSON.stringify({ companies: [lookup("board", "2026-10-21T04:00:00Z")] }));
  writeFileSync(join(dir, "out", "resolved-bulk.json"), JSON.stringify({ companies: [lookup("none", "2026-10-21T04:00:00Z"), lookup("board", "2026-09-01T00:00:00Z")] }));
  writeFileSync(join(dir, "raw", "wayback", "boards.json"), JSON.stringify({ generated_at: "2026-10-21T04:30:00.000Z", boards: [1, 2, 3] }));
  writeFileSync(join(dir, "raw", "commoncrawl", "boards.json"), JSON.stringify({ generated_at: "2026-10-20T13:40:00.000Z", crawls: ["c1", "c2"], boards: [1] }));
  return dir;
}

describe("tally", () => {
  it("counts the state and what this run added", () => {
    expect(tally(state(), since)).toEqual([
      { what: "Board checks", total: 2, thisRun: "2", detail: "dead 1, live 1" },
      { what: "Company lookups", total: 3, thisRun: "2", detail: "board 1, none 1" },
      { what: "Wayback boards", total: 3, thisRun: "updated", detail: "pass in progress" },
      { what: "Common Crawl boards", total: 1, thisRun: "last 2026-10-20 13:40", detail: "2 crawls read" },
    ]);
  });

  it("leaves out what the state doesn't have", () => {
    expect(tally(mkdtempSync(join(tmpdir(), "rawjobs-tally-")), since)).toEqual([]);
  });

  it("prints a Markdown table", () => {
    const md = tallyMarkdown([{ what: "Board checks", total: 2, thisRun: "1", detail: "live 1" }]);
    expect(md).toContain("| What | Total | This run | Detail |");
    expect(md).toContain("| Board checks | 2 | 1 | live 1 |");
  });
});

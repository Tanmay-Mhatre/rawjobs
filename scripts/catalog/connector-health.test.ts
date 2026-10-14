import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { type BoardOutcome, BIG_BOARD, classify, countBad, type DirRow, loadDirectory, pickBoards, renderTable, reportMarkdown, type SystemResult } from "./connector-health";

const row = (slug: string, open_jobs: number | null, over: Partial<DirRow> = {}): DirRow => ({ key: `workday:${slug}`, ats: "workday", slug, status: "live", open_jobs, ...over });
const ok = (board: string, jobs = 10): BoardOutcome => ({ board, jobs, bad: 0 });

describe("pickBoards", () => {
  it("takes live boards with jobs, mid-sized first by most open jobs, big ones last", () => {
    const rows = [row("a", 5), row("b", 150), row("huge", BIG_BOARD + 1000), row("c", 40), row("dormant", 90, { status: "dormant" }), row("empty", 0), row("nulls", null)];
    expect(pickBoards(rows, "workday").map((r) => r.slug)).toEqual(["b", "c", "a"]);
    expect(pickBoards(rows, "workday", 5).map((r) => r.slug)).toEqual(["b", "c", "a", "huge"]);
  });

  it("spreads over shards before taking a second board on the same one", () => {
    const rows = [row("a", 100, { shard: "wd5" }), row("b", 90, { shard: "wd5" }), row("c", 20, { shard: "wd1" }), row("d", 10, { shard: "wd3" })];
    expect(pickBoards(rows, "workday").map((r) => r.slug)).toEqual(["a", "c", "d"]);
    expect(pickBoards(rows.slice(0, 3), "workday").map((r) => r.slug)).toEqual(["a", "c", "b"]);
  });

  it("only picks the asked system, and none when it has no live board", () => {
    const rows = [row("a", 10), { ...row("g", 10), ats: "greenhouse" }];
    expect(pickBoards(rows, "greenhouse").map((r) => r.slug)).toEqual(["g"]);
    expect(pickBoards(rows, "lever")).toEqual([]);
  });
});

describe("classify", () => {
  it("passes when every board gave jobs, warns when some did, fails when none did", () => {
    expect(classify([ok("a"), ok("b")])).toBe("pass");
    expect(classify([ok("a"), { board: "b", jobs: 0, bad: 0, error: "HTTP 404" }])).toBe("warn");
    expect(
      classify([
        { board: "a", jobs: 0, bad: 0 },
        { board: "b", jobs: 0, bad: 0, error: "boom" },
      ]),
    ).toBe("fail");
    expect(classify([])).toBe("skipped");
  });

  it("counts a board whose jobs lack a title, link or id as failed", () => {
    expect(classify([{ board: "a", jobs: 10, bad: 1 }])).toBe("pass");
    expect(classify([{ board: "a", jobs: 10, bad: 5 }])).toBe("fail");
    expect(
      countBad([
        { id: "1", title: "PM", url: "https://x" },
        { id: "2", title: " ", url: "https://x" },
        { id: "", title: "PM", url: "https://x" },
        { id: "3", title: "PM", url: "" },
      ]),
    ).toBe(3);
  });
});

describe("report", () => {
  const results: SystemResult[] = [
    { system: "lever", kind: "hiring system", boards: [ok("a", 3), ok("b", 4)], status: "pass" },
    {
      system: "workday",
      kind: "hiring system",
      boards: [
        { board: "acme/External", jobs: 0, bad: 0, error: "HTTP 500 a|b" },
        { board: "beta/Jobs", jobs: 0, bad: 0 },
      ],
      status: "fail",
    },
    { system: "gem", kind: "hiring system", boards: [], status: "skipped" },
    { system: "remotive", kind: "job board", boards: [ok("all", 50)], status: "pass" },
  ];

  it("renders one row per system, failing first, with escaped errors", () => {
    const lines = renderTable(results).split("\n");
    expect(lines[0]).toBe("| System | Boards tried | Jobs found | Status | Errors |");
    expect(lines[2]).toBe("| workday | acme/External, beta/Jobs | - / 0 | **FAIL** | acme/External: HTTP 500 a\\|b; beta/Jobs: 0 jobs |");
    expect(lines[3]).toBe("| gem | none live in the directory | - | skipped |  |");
    expect(lines).toContain("| lever | a, b | 3 / 4 | pass |  |");
    expect(lines).toContain("| remotive (job board) | all | 50 | pass |  |");
  });

  it("lists failing systems above the counts and the table", () => {
    const md = reportMarkdown(results);
    expect(md).toContain("1 of 4 hiring systems and job boards found no usable jobs:");
    expect(md).toContain("- **workday**: acme/External: HTTP 500 a|b; beta/Jobs: 0 jobs");
    expect(md).toContain("2 pass, 0 warn, 1 fail, 1 skipped");
    expect(reportMarkdown(results.filter((r) => r.status !== "fail"))).toMatch(/^Every hiring system and job board checked found jobs\./);
  });
});

describe("loadDirectory", () => {
  it("reads the companies out of the gzipped release file", async () => {
    const body = gzipSync(JSON.stringify({ companies: [row("a", 1)] }));
    const fetchImpl = (async (url: string) => {
      expect(url).toBe("https://x/directory.json.gz");
      return new Response(body);
    }) as typeof fetch;
    expect(await loadDirectory("https://x", fetchImpl)).toEqual([row("a", 1)]);
    await expect(loadDirectory("https://x", (async () => new Response("", { status: 404 })) as typeof fetch)).rejects.toThrow("HTTP 404");
  });
});

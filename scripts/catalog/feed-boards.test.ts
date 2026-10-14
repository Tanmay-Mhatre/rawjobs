import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Connector, companyKey, HttpClient } from "@rawjobs/core";
import { afterAll, describe, expect, it } from "vitest";
import { boardsInItems, type FeedBoardsFile, mergeFeedBoards, readFeedBoards, readFeeds, urlsIn } from "./feed-boards";

const keys = (items: unknown[]) => boardsInItems(items).map(companyKey).sort();

/** One small item per feed, shaped like each connector's raw jobs. */
const FIXTURES: Record<string, { item: unknown; boards: string[] }> = {
  // Algolia HN comment: links entity-escaped inside <a>; replies are other people's.
  hackernews: {
    item: {
      id: 1,
      text: 'Acme | Backend Engineer | Remote<p>Apply: <a href="https:&#x2F;&#x2F;jobs.lever.co&#x2F;acme&#x2F;0b1c-22" rel="nofollow">https:&#x2F;&#x2F;jobs.lever.co&#x2F;acme&#x2F;0b1c-22</a>.',
      children: [{ text: "We're hiring too: https://boards.greenhouse.io/someoneelse" }],
    },
    boards: ["lever:acme"],
  },
  remotive: {
    item: {
      id: 2,
      url: "https://remotive.com/remote-jobs/software-dev/beta-2",
      company_name: "Beta",
      description: '<p>Apply <a href="https://jobs.ashbyhq.com/beta/5f0e?utm_source=remotive">here</a></p>',
    },
    boards: ["ashby:beta"],
  },
  arbeitnow: {
    item: { slug: "gamma-3", url: "https://www.arbeitnow.com/jobs/companies/gamma/3", description: "<p>Bewerbung: https://apply.workable.com/gamma/j/AB12CD34/ (bitte).</p>", tags: ["it"] },
    boards: ["workable:gamma"],
  },
  // A tracking link that carries the real one in its query.
  remoteok: {
    item: { id: "4", url: "https://remoteok.com/remote-jobs/4", description: '<a href="https://track.example.com/r?url=https%3A%2F%2Fjob-boards.greenhouse.io%2Fdelta%2Fjobs%2F4">Apply</a>' },
    boards: ["greenhouse:delta"],
  },
  himalayas: {
    item: { title: "Engineer", companyName: "Epsilon", applicationLink: "https://jobs.smartrecruiters.com/Epsilon/7444-engineer", guid: "https://himalayas.app/companies/epsilon/jobs/engineer" },
    boards: ["smartrecruiters:epsilon"],
  },
  jobicy: {
    item: { id: 5, url: "https://jobicy.com/jobs/5-engineer", jobDescription: "<p>Apply at https://zeta.wd5.myworkdayjobs.com/en-US/External/job/Remote/Engineer_R123</p>" },
    boards: [companyKey({ ats: "workday", slug: "zeta", shard: "wd5", site: "External" })],
  },
  // RSS description: the HTML arrives escaped.
  weworkremotely: {
    item: {
      title: "Eta: Engineer",
      link: "https://weworkremotely.com/remote-jobs/eta-engineer",
      description: "&lt;p&gt;&lt;a href=&quot;https://jobs.lever.co/eta/9c&quot;&gt;Apply&lt;/a&gt;&lt;/p&gt;",
    },
    boards: ["lever:eta"],
  },
};

describe("boards in feed items", () => {
  for (const [feed, { item, boards }] of Object.entries(FIXTURES)) {
    it(`reads the board a ${feed} job links to`, () => {
      expect(keys([item])).toEqual(boards.map((b) => b.toLowerCase()).sort());
    });
  }

  it("keeps the feed's own links and other sites out", () => {
    expect(keys([{ url: "https://remotive.com/remote-jobs/x", description: "https://example.com/careers https://news.ycombinator.com/item?id=1 https://jobs.lever.co/" }])).toEqual([]);
  });

  it("finds URLs in fields, text and redirect queries, without trailing punctuation", () => {
    expect(urlsIn({ a: "see https://jobs.lever.co/acme.", b: ["https://x.test/go?to=https%3A%2F%2Fjobs.ashbyhq.com%2Fbeta"] }).sort()).toEqual([
      "https://jobs.ashbyhq.com/beta",
      "https://jobs.lever.co/acme",
      "https://x.test/go?to=https%3A%2F%2Fjobs.ashbyhq.com%2Fbeta",
    ]);
  });

  it("lists a board once, however many jobs link to it and in whichever spelling", () => {
    expect(keys([{ u: "https://boards.greenhouse.io/acme" }, { u: "https://job-boards.greenhouse.io/acme/jobs/12" }, { u: "https://boards.greenhouse.io/acme/jobs/13" }])).toEqual(["greenhouse:acme"]);
  });
});

describe("mergeFeedBoards", () => {
  it("adds new boards and records every feed that saw one, with first and last day", () => {
    const file: FeedBoardsFile = { fetched: {}, boards: [] };
    expect(mergeFeedBoards(file, "remotive", [{ ats: "lever", slug: "acme" }], "2026-10-01")).toEqual({ added: 1 });
    expect(
      mergeFeedBoards(
        file,
        "hackernews",
        [
          { ats: "lever", slug: "acme" },
          { ats: "ashby", slug: "beta" },
        ],
        "2026-10-14",
      ),
    ).toEqual({ added: 1 });
    expect(mergeFeedBoards(file, "remotive", [{ ats: "lever", slug: "acme" }], "2026-10-05")).toEqual({ added: 0 });
    expect(file.boards).toEqual([
      { ats: "lever", slug: "acme", feeds: ["hackernews", "remotive"], first_seen: "2026-10-01", last_seen: "2026-10-14" },
      { ats: "ashby", slug: "beta", feeds: ["hackernews"], first_seen: "2026-10-14", last_seen: "2026-10-14" },
    ]);
  });
});

describe("readFeeds", () => {
  const dirs: string[] = [];
  afterAll(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });
  const outFile = () => {
    const d = mkdtempSync(join(tmpdir(), "feeds-"));
    dirs.push(d);
    return join(d, "raw", "feeds", "boards.json");
  };
  const http = new HttpClient({ fetchImpl: (async () => new Response("no network in tests", { status: 500 })) as unknown as typeof fetch, retries: 0 });
  const fake = (items: unknown[] | Error, minIntervalHours = 6) =>
    ({
      ats: "remotive",
      minIntervalHours,
      detect: () => null,
      fetch: async () => {
        if (items instanceof Error) throw items;
        return items;
      },
      normalize: () => {
        throw new Error("unused");
      },
    }) as unknown as Connector;

  it("reads each due feed, skips a failing one, and saves which boards it saw", async () => {
    const out = outFile();
    const connectors: Record<string, Connector> = { remotive: fake([FIXTURES.remotive!.item]), arbeitnow: fake(new Error("503")), hackernews: fake([FIXTURES.hackernews!.item], 12) };
    const runs = await readFeeds({ http, out, feeds: ["remotive", "arbeitnow", "hackernews"], getConnector: (a) => connectors[a], now: () => new Date("2026-10-14T03:00:00Z") });
    expect(runs.map((r) => [r.feed, r.outcome, r.added])).toEqual([
      ["remotive", "read", 1],
      ["arbeitnow", "failed", undefined],
      ["hackernews", "read", 1],
    ]);
    const saved = readFeedBoards(out);
    expect(saved.boards.map(companyKey).sort()).toEqual(["ashby:beta", "lever:acme"]);
    expect(saved.fetched).toEqual({ remotive: "2026-10-14T03:00:00.000Z", arbeitnow: "2026-10-14T03:00:00.000Z", hackernews: "2026-10-14T03:00:00.000Z" });
    // Nothing but boards and dates: no job data from the feeds.
    expect(Object.keys(saved.boards[0]!).sort()).toEqual(["ats", "feeds", "first_seen", "last_seen", "slug"]);

    // 3 hours later: none is due yet (6 and 12 hours). 7 hours later: the 6-hour feeds are.
    const again = await readFeeds({ http, out, feeds: ["remotive", "arbeitnow", "hackernews"], getConnector: (a) => connectors[a], now: () => new Date("2026-10-14T06:00:00Z") });
    expect(again.map((r) => r.outcome)).toEqual(["not due", "not due", "not due"]);
    const later = await readFeeds({ http, out, feeds: ["remotive", "arbeitnow", "hackernews"], getConnector: (a) => connectors[a], now: () => new Date("2026-10-14T10:00:00Z") });
    expect(later.map((r) => r.outcome)).toEqual(["read", "failed", "not due"]);
    expect(readFeedBoards(out).boards.find((b) => b.slug === "beta")?.last_seen).toBe("2026-10-14");
  });

  it("starts no feed once the time is up", async () => {
    let t = Date.parse("2026-10-14T03:00:00Z");
    const now = () => new Date((t += 60_000));
    const runs = await readFeeds({ http, out: outFile(), feeds: ["remotive"], getConnector: () => fake([]), maxMs: 30_000, now });
    expect(runs).toEqual([{ feed: "remotive", outcome: "out of time" }]);
  });
});

describe("merge", () => {
  const here = fileURLToPath(new URL(".", import.meta.url));
  const root = join(here, "..", "..");
  const dir = mkdtempSync(join(tmpdir(), "rawjobs-feeds-merge-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("lists boards from job feeds as their own publishable family", () => {
    cpSync(join(here, "test-fixtures", "golden", "seeds"), join(dir, "seeds"), { recursive: true });
    mkdirSync(join(dir, "raw", "feeds"), { recursive: true });
    mkdirSync(join(dir, "data"));
    writeFileSync(
      join(dir, "raw", "feeds", "boards.json"),
      JSON.stringify({ fetched: {}, boards: [{ ats: "ashby", slug: "feedonly", feeds: ["hackernews"], first_seen: "2026-10-14", last_seen: "2026-10-14" }] }),
    );
    const r = spawnSync(process.execPath, [join(root, "node_modules/tsx/dist/cli.mjs"), join(here, "merge.ts")], {
      encoding: "utf8",
      env: { ...process.env, CATALOG_DIR: dir, CATALOG_DATA_DIR: join(dir, "data"), CONTRIBUTIONS_FILE: "" },
    });
    expect(r.status, r.stderr).toBe(0);
    const merged = JSON.parse(readFileSync(join(dir, "out", "merged.json"), "utf8")) as { input_rows: Record<string, number>; boards: { key: string; families: string[]; sources: string[] }[] };
    expect(merged.input_rows.feeds).toBe(1);
    expect(merged.boards.find((b) => b.key === "ashby:feedonly")).toMatchObject({ families: ["feeds"], sources: ["feeds"] });
  }, 60_000);
});

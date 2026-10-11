import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { newCrawlClient, queriesFor, readCrawls } from "./commoncrawl";

const INDEX = "https://cc-index.test";
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** A fake index: the crawl list always answers; `answer` handles every other URL. */
function fakeIndex(answer: (url: string) => Response) {
  const urls: string[] = [];
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = String(input);
    urls.push(url);
    return url.endsWith("/collinfo.json") ? json([{ id: "CC-MAIN-2026-30" }]) : answer(url);
  }) as typeof fetch;
  return { urls, http: newCrawlClient({ fetchImpl, sleep: async () => {}, hostDelayMs: 0 }) };
}

const outFile = () => join(mkdtempSync(join(tmpdir(), "cc-")), "boards.json");
const saved = (out: string) => JSON.parse(readFileSync(out, "utf8")) as { crawls: string[]; partial?: Record<string, string[]>; boards: { ats: string; slug: string }[] };

describe("readCrawls", () => {
  it("stops after 4 failed queries in a row when the index answers 503, and keeps the crawl for next run", async () => {
    const { urls, http } = fakeIndex(() => new Response("busy", { status: 503 }));
    const out = outFile();
    expect(await readCrawls({ http, out, index: INDEX })).toBe("index unavailable");
    // 4 queries × 3 attempts (retries: 2), then nothing more.
    expect(urls.filter((u) => !u.endsWith("/collinfo.json"))).toHaveLength(12);
    expect(existsSync(out)).toBe(true);
    expect(saved(out).crawls).toEqual([]);
  });

  it("starts no query once the time is up", async () => {
    const { urls, http } = fakeIndex(() => json({ pages: 1 }));
    let t = 0;
    const now = () => (t += 60_000);
    const out = outFile();
    expect(await readCrawls({ http, out, index: INDEX, maxMs: 30_000, now })).toBe("out of time");
    expect(urls.filter((u) => !u.endsWith("/collinfo.json"))).toEqual([]);
    expect(saved(out).crawls).toEqual([]);
  });

  it("reads a healthy crawl to the end and marks it done", async () => {
    const { http } = fakeIndex((url) =>
      url.includes("showNumPages") ? json({ pages: 1 }) : new Response(`{"url": "https://jobs.lever.co/acme/123"}\n{"url": "https://boards.greenhouse.io/beta"}\n`),
    );
    const out = outFile();
    expect(await readCrawls({ http, out, index: INDEX })).toBe("done");
    expect(saved(out).crawls).toEqual(["CC-MAIN-2026-30"]);
    expect(saved(out).boards.map((b) => `${b.ats}:${b.slug}`).sort()).toEqual(["greenhouse:beta", "lever:acme"]);
  });

  it("treats a failing crawl list as an unavailable index, without touching saved boards", async () => {
    const fetchImpl = (async () => new Response("down", { status: 503 })) as unknown as typeof fetch;
    const out = outFile();
    expect(await readCrawls({ http: newCrawlClient({ fetchImpl, sleep: async () => {}, hostDelayMs: 0 }), out, index: INDEX })).toBe("index unavailable");
    expect(existsSync(out)).toBe(false);
  });

  it("records each finished query, so the next run continues where this one stopped", async () => {
    const healthy = (url: string) => (url.includes("showNumPages") ? json({ pages: 1 }) : new Response(`{"url": "https://jobs.lever.co/acme/1"}
`));
    // Run 1: the first two queries answer, then the index goes down.
    let answered = 0;
    const first = fakeIndex((url) => (url.includes("showNumPages") && ++answered > 2 ? new Response("busy", { status: 503 }) : healthy(url)));
    const out = outFile();
    expect(await readCrawls({ http: first.http, out, index: INDEX })).toBe("index unavailable");
    expect(saved(out).partial).toEqual({ "CC-MAIN-2026-30": ["boards.greenhouse.io/*|", "job-boards.greenhouse.io/*|"] });
    expect(saved(out).crawls).toEqual([]);
    // Run 2: starts at the third query and finishes the crawl.
    const second = fakeIndex(healthy);
    expect(await readCrawls({ http: second.http, out, index: INDEX })).toBe("done");
    const counted = second.urls.filter((u) => u.includes("showNumPages"));
    expect(counted[0]).toContain(encodeURIComponent("job-boards.eu.greenhouse.io/*"));
    expect(saved(out).crawls).toEqual(["CC-MAIN-2026-30"]);
    expect(saved(out).partial).toEqual({});
  });

  it("queriesFor leaves out the queries already read", () => {
    const qs = [{ url: "a/*" }, { url: "b", matchType: "domain" }, { url: "c/*" }];
    expect(queriesFor(qs, ["a/*|", "b|domain"])).toEqual([{ url: "c/*" }]);
    expect(queriesFor(qs, undefined)).toEqual(qs);
  });
});

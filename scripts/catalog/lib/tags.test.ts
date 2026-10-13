import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { HttpClient, INDUSTRY_BY_ID } from "@rawjobs/core";
import { afterEach, describe, expect, it } from "vitest";
import { compact, mergeTitlesRow } from "../compact";
import { checkBoard, MAX_TITLES, titlesOf } from "./live-check";
import { readCheckTitles, readFeedTitles, TagBook, TITLES_SOURCE, WIKIDATA_SOURCE } from "./tags";
import { boardMatchesWebsite, domainLabel, industriesForWikidata, plainName, WIKIDATA_INDUSTRIES } from "./wikidata";

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), "rawjobs-tags-"));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("Wikidata industries", () => {
  it("maps only to industry ids that exist", () => {
    for (const [item, ids] of Object.entries(WIKIDATA_INDUSTRIES)) {
      expect(item).toMatch(/^Q\d+$/);
      for (const id of ids) expect(INDUSTRY_BY_ID.has(id), `${item} -> ${id}`).toBe(true);
    }
  });

  it("prefers a specific industry over a broad one, ignores unknown items", () => {
    // bank + financial services: a bank, not "Fintech (general)".
    expect(industriesForWikidata(["Q837171", "Q22687"])).toEqual(["banking"]);
    // Only the broad one: that's all there is to say.
    expect(industriesForWikidata(["Q837171"])).toEqual(["fintech"]);
    // Software industry + video games: a games company.
    expect(industriesForWikidata(["Q880371", "Q941594"])).toEqual(["gaming"]);
    expect(industriesForWikidata(["Q862571", "Q99999999"])).toEqual([]);
    expect(industriesForWikidata(["Q10932402"])).toEqual(["ecommerce", "food"]);
  });

  it("matches a directory board to a Wikidata company by name and website", () => {
    expect(plainName("Acme, Inc.")).toBe(plainName("ACME"));
    expect(plainName("Société Générale")).toBe("societegenerale");
    expect(domainLabel("https://corporate.visa.com/en.html")).toBe("visa");
    expect(domainLabel("http://www.nib.com.au")).toBe("nib");
    expect(domainLabel("not a url")).toBe("");
    expect(boardMatchesWebsite({ slug: "visa" }, "https://corporate.visa.com/")).toBe(true);
    expect(boardMatchesWebsite({ slug: "hubspotjobs" }, "http://www.hubspot.com")).toBe(true);
    expect(boardMatchesWebsite({ slug: "zyngacareers" }, "https://www.zynga.com/")).toBe(true);
    expect(boardMatchesWebsite({ slug: "careers.acme.com" }, "https://www.acme.com/")).toBe(true);
    // Same name, different company: the board isn't named like the website.
    expect(boardMatchesWebsite({ slug: "cedar" }, "http://www.cedar-web.com/")).toBe(false);
    expect(boardMatchesWebsite({ slug: "careportalinc" }, "http://www.cedar-web.com/")).toBe(false);
    // Too short to tell.
    expect(boardMatchesWebsite({ slug: "eon" }, "https://www.eon.se/")).toBe(false);
  });
});

describe("TagBook", () => {
  it("keeps list and Wikidata tags in tags, title-only ones in title_tags, and names the non-list sources", () => {
    const book = new TagBook();
    book.add("a", ["fintech"], "curated list");
    book.add("a", ["fintech", "payments"], TITLES_SOURCE);
    book.add("a", ["banking"], WIKIDATA_SOURCE);
    book.add("a", ["banking"], TITLES_SOURCE);
    expect(book.tagsOf("a")).toEqual({ tags: ["banking", "fintech"], title_tags: ["payments"], tag_src: { banking: "wikidata", payments: "titles" } });
    expect(book.known("a").sort()).toEqual(["banking", "fintech", "payments"]);
    // A list-only company carries no tag_src: apps read it exactly as before.
    book.add("b", ["crypto"], "seed list");
    expect(book.tagsOf("b")).toEqual({ tags: ["crypto"] });
    expect(book.tagsOf("none")).toEqual({});
    expect(JSON.parse(JSON.stringify(book)).a.banking.sort()).toEqual([TITLES_SOURCE, WIKIDATA_SOURCE].sort());
  });
});

describe("job titles for tags", () => {
  it("reads the newest titles a check kept per board, across processes, past a cut-off line", () => {
    const d = tmp();
    const line = (key: string, at: string, titles: string[]) => JSON.stringify({ key, fetched_at: at, titles });
    writeFileSync(join(d, "titles.jsonl"), `${line("bamboohr:a", "2026-10-01", ["Old"])}\n${line("bamboohr:b", "2026-10-01", ["Nurse"])}\n`);
    writeFileSync(join(d, "titles-workable.jsonl"), `${line("bamboohr:a", "2026-10-05", ["New"])}\n{"key":"bamboohr:c","fe`);
    writeFileSync(join(d, "checks.jsonl"), line("bamboohr:z", "2026-10-09", ["Not titles"]));
    const titles = readCheckTitles(d);
    expect(Object.fromEntries(titles)).toEqual({ "bamboohr:a": ["New"], "bamboohr:b": ["Nurse"] });
    // The state save keeps one newest list per board.
    compact(d, /^titles(-.+)?\.jsonl$/, "titles.jsonl", mergeTitlesRow);
    expect(Object.fromEntries(readCheckTitles(d))).toEqual({ "bamboohr:a": ["New"], "bamboohr:b": ["Nurse"] });
  });

  it("reads titles from the job feed's shards named in its manifest", () => {
    const d = tmp();
    const shard = {
      schema: 1,
      ats: "workday",
      generated_at: "2026-10-13",
      companies: {
        "workday:visa|jobs": {
          fetched_at: "2026-10-13",
          jobs: [
            ["R1", "Payments Engineer", "Austin", "onsite", "2026-10-10"],
            ["R2", "", "x", "onsite", null],
          ],
        },
      },
    };
    writeFileSync(join(d, "jobs-workday-20261013T1157.json.gz"), gzipSync(JSON.stringify(shard)));
    writeFileSync(join(d, "jobs-manifest.json"), JSON.stringify({ schema: 1, shards: { workday: { file: "jobs-workday-20261013T1157.json.gz" }, lever: { file: "jobs-lever-missing.json.gz" } } }));
    expect(Object.fromEntries(readFeedTitles(d))).toEqual({ "workday:visa|jobs": ["Payments Engineer"] });
    expect(readFeedTitles(join(d, "nowhere")).size).toBe(0);
  });

  it("keeps distinct titles, at most MAX_TITLES", () => {
    expect(titlesOf(["Nurse", " nurse ", undefined, "", "Chef  de  Partie"])).toEqual(["Nurse", "Chef de Partie"]);
    expect(titlesOf(Array.from({ length: 100 }, (_, i) => `Role ${i}`))).toHaveLength(MAX_TITLES);
  });

  it("returns the titles a full-list check read anyway", async () => {
    const offers = [
      { id: 1, title: "Staff Nurse" },
      { id: 2, title: "Registered Nurse" },
      { id: 3, title: "Staff Nurse" },
    ];
    const http = new HttpClient({
      hostDelayMs: 0,
      sleep: async () => {},
      fetchImpl: (async () => new Response(JSON.stringify({ offers }), { headers: { "content-type": "application/json" } })) as unknown as typeof fetch,
    });
    const r = await checkBoard(http, { key: "recruitee:clinic", ats: "recruitee", slug: "clinic" });
    expect(r).toMatchObject({ status: "live", jobs: 3, titles: ["Staff Nurse", "Registered Nurse"] });
  });
});

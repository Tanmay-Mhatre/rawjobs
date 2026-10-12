import { describe, expect, it } from "vitest";
import { parseConfig } from "../src/config";
import { detectCompany } from "../src/connectors";
import { arbeitnow } from "../src/connectors/arbeitnow";
import { hackernews, parseHiringPost } from "../src/connectors/hackernews";
import { remoteok } from "../src/connectors/remoteok";
import { remotive } from "../src/connectors/remotive";
import { runRadar } from "../src/run";
import type { Job } from "../src/schema";
import { company, fakeHttp, json } from "./helpers";

const now = new Date("2026-10-09T12:00:00Z");

describe("job boards", () => {
  it("are recognised from their links, named after the board", () => {
    expect(detectCompany("https://news.ycombinator.com/item?id=49922569")).toMatchObject({ ats: "hackernews", slug: "whoishiring", name: "Hacker News: Who is hiring", supported: true });
    expect(detectCompany("https://remotive.com/remote-jobs/software-dev")).toMatchObject({ ats: "remotive", slug: "software-dev", name: "Remotive" });
    expect(detectCompany("remotive.com")).toMatchObject({ ats: "remotive", slug: "all" });
    expect(detectCompany("https://www.arbeitnow.com/")).toMatchObject({ ats: "arbeitnow", slug: "all" });
    expect(detectCompany("https://remoteok.com")).toMatchObject({ ats: "remoteok", slug: "all", name: "Remote OK" });
  });

  it("reads a Who is hiring post's first line", () => {
    expect(parseHiringPost("Acme Robotics (YC W24) | Senior Backend Engineer | Remote (US) | $150k\nWe build robots.")).toEqual({
      company: "Acme Robotics",
      title: "Senior Backend Engineer",
      location: "Remote (US)",
    });
    expect(parseHiringPost("Foo | Berlin, Germany | ONSITE | Product Manager, Designer")).toMatchObject({ company: "Foo", title: "Product Manager, Designer", location: "Berlin, Germany; ONSITE" });
    expect(parseHiringPost("PrairieLearn (Remote US) — Full-Stack Software Engineer — TypeScript / Postgres")).toEqual({
      company: "PrairieLearn",
      title: "Full-Stack Software Engineer",
      location: "Remote US",
    });
  });

  it("repairs Remote OK text that was UTF-8 encoded twice, and leaves good text alone", async () => {
    const { fixMojibake } = await import("../src/connectors/remoteok");
    expect(fixMojibake("Telefondienst fÃ¼r Tierarztpraxis")).toBe("Telefondienst für Tierarztpraxis");
    expect(fixMojibake("Zürich — Senior PM")).toBe("Zürich — Senior PM");
    expect(fixMojibake("Plain text")).toBe("Plain text");
  });

  it("Hacker News: finds the current thread, one job per top-level post, linked to the post", async () => {
    const { http, calls } = fakeHttp((url) =>
      url.includes("search_by_date")
        ? json({
            hits: [
              { objectID: "1", title: "Ask HN: Who wants to be hired? (October 2026)" },
              { objectID: "2", title: "Ask HN: Who is hiring? (October 2026)" },
            ],
          })
        : json({
            children: [
              { id: 77, text: "<p>Acme | Product Manager | Dubai, UAE | Onsite</p><p>Details</p>", created_at: "2026-10-01T15:00:00Z" },
              { id: 78, text: null },
            ],
          }),
    );
    const raws = await hackernews.fetch(company("hackernews", { slug: "whoishiring" }), { http, now });
    expect(calls[1]).toBe("https://hn.algolia.com/api/v1/items/2");
    expect(raws).toHaveLength(1);
    expect(hackernews.normalize(raws[0]!, company("hackernews"))).toMatchObject({
      id: "hackernews:whoishiring:77",
      company: "Acme",
      title: "Product Manager",
      location: "Dubai, UAE; Onsite",
      url: "https://news.ycombinator.com/item?id=77",
    });
  });

  it("Remotive, Arbeitnow and Remote OK credit the real employer and link to the board's page", async () => {
    const r = remotive.normalize(
      { id: 5, url: "https://remotive.com/remote-jobs/x-5", title: "PM", company_name: "Acme", candidate_required_location: "Europe" },
      company("remotive", { slug: "all" }),
    );
    expect(r).toMatchObject({ id: "remotive:all:5", company: "Acme", location: "Remote (Europe)", workplace: "remote", url: "https://remotive.com/remote-jobs/x-5" });

    const { http } = fakeHttp(() =>
      json({
        data: [{ slug: "pm-acme", company_name: "Acme", title: "PM", url: "https://www.arbeitnow.com/jobs/pm-acme", location: "Berlin", remote: false, created_at: 1_790_000_000 }],
        links: { next: null },
      }),
    );
    const a = await arbeitnow.fetch(company("arbeitnow", { slug: "all" }), { http, now });
    expect(arbeitnow.normalize(a[0]!, company("arbeitnow", { slug: "all" }))).toMatchObject({
      id: "arbeitnow:all:pm-acme",
      company: "Acme",
      location: "Berlin",
      url: "https://www.arbeitnow.com/jobs/pm-acme",
    });

    const ok = await remoteok.fetch(company("remoteok", { slug: "all" }), {
      http: fakeHttp(() => json([{ legal: "terms" }, { id: "9", position: "PM", company: "Acme", url: "https://remoteok.com/remote-jobs/9" }])).http,
      now,
    });
    expect(ok).toHaveLength(1);
    expect(remoteok.normalize(ok[0]!, company("remoteok", { slug: "all" }))).toMatchObject({ id: "remoteok:all:9", company: "Acme", workplace: "remote" });
  });

  it("a board fetched less than its minimum interval ago reuses the last fetch", async () => {
    const config = parseConfig(`
profile:
  titles: { include: ["product manager"], exclude: [] }
  locations: { include: [], remote_ok: ["remote"], remote_exclude: [] }
companies:
  - { name: "Remotive", ats: remotive, slug: "all" }
`);
    const prev: Job = {
      id: "remotive:all:5",
      ats: "remotive",
      company: "Acme",
      title: "Product Manager",
      location: "Remote (Worldwide)",
      workplace: "remote",
      url: "https://remotive.com/remote-jobs/x-5",
      firstSeen: "2026-10-08T12:00:00Z",
      lastSeen: "2026-10-09T09:00:00Z",
      status: "open",
      score: 0,
      why: { title: 0, location: 0, keywords: [], keywordPoints: 0, freshness: 0 },
    };
    const { http, calls } = fakeHttp(() => json({ jobs: [] }));
    const r = await runRadar(config, { http, now, previous: [prev] });
    expect(calls).toHaveLength(0);
    expect(r.jobs.map((j) => j.id)).toEqual(["remotive:all:5"]);
    expect(r.health[0]).toMatchObject({ ok: true, jobsFound: 1, matches: 1 });

    const later = await runRadar(config, { http, now: new Date("2026-10-09T16:00:00Z"), previous: [prev] });
    expect(calls).toHaveLength(1);
    expect(later.jobs).toHaveLength(0);
  });
});

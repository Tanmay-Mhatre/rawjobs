import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseConfig } from "../src/config";
import { ashby } from "../src/connectors/ashby";
import { greenhouse } from "../src/connectors/greenhouse";
import { lever } from "../src/connectors/lever";
import { smartrecruiters } from "../src/connectors/smartrecruiters";
import { workday } from "../src/connectors/workday";
import { checkStillOpen, isStillOpen, jobsToRecheck, MAX_OPEN_CHECKS, pageSaysOpen } from "../src/liveness";
import { scan } from "../src/scan";
import type { Job } from "../src/schema";
import { fakeHttp, json, makeJob } from "./helpers";

const now = new Date("2026-10-14T12:00:00Z");
const ctx = (route: Parameters<typeof fakeHttp>[0]) => {
  const f = fakeHttp(route);
  return { ...f, ctx: { http: f.http, now } };
};
const html = (body: string, status = 200) => new Response(`<html><body>${body}</body></html>`, { status, headers: { "content-type": "text/html" } });
const redirected = (res: Response) => Object.defineProperty(res, "redirected", { value: true });
const LEVER_ID = "0b9b6f6e-1111-4c2a-9a55-2f3a4b5c6d7e";
const ASHBY_ID = "5e1d2c3b-2222-4a1b-8c9d-0e1f2a3b4c5d";

describe("jobsToRecheck", () => {
  const live = "2026-10-14T11:00:00Z";

  it("checks jobs not read live this run first (longest unseen first), then job-board jobs; never ones just read off a company's own board", () => {
    const fresh = makeJob({ lastSeen: live });
    const board = makeJob({ id: "remotive:all:1", ats: "remotive", lastSeen: live });
    const older = makeJob({ lastSeen: "2026-10-13T08:00:00Z" });
    const oldest = makeJob({ lastSeen: "2026-10-12T08:00:00Z" });
    expect(jobsToRecheck([fresh, board, older, oldest], live).map((j) => j.id)).toEqual([oldest.id, older.id, board.id]);
  });

  it("checks at most MAX_OPEN_CHECKS jobs", () => {
    const many = Array.from({ length: MAX_OPEN_CHECKS + 10 }, () => makeJob({ id: `remotive:all:${Math.random()}`, ats: "remotive", lastSeen: live }));
    expect(jobsToRecheck(many, live)).toHaveLength(MAX_OPEN_CHECKS);
    expect(jobsToRecheck(many, live, 5)).toHaveLength(5);
  });
});

describe("isStillOpen: the ladder", () => {
  const gh = makeJob({ id: "greenhouse:acme:123", url: "https://boards.greenhouse.io/acme/jobs/123" });

  it("asks the hiring system first, and stops there when it answers", async () => {
    const { http, calls } = fakeHttp((u) => (u.includes("boards-api") ? json({ error: "not found" }, 404) : html("Apply now")));
    expect(await isStillOpen(gh, http, now)).toBe(false);
    expect(calls).toEqual(["https://boards-api.greenhouse.io/v1/boards/acme/jobs/123"]);

    const open = fakeHttp(() => json({ id: 123 }));
    expect(await isStillOpen(gh, open.http, now)).toBe(true);
    expect(open.calls).toHaveLength(1);
  });

  it("falls back to the job's page when the system can't tell", async () => {
    const { http, calls } = fakeHttp((u) => (u.includes("boards-api") ? json({}, 503) : html("Sorry, this job has been filled.")));
    expect(await isStillOpen(gh, http, now)).toBe(false);
    expect(calls.at(-1)).toBe(gh.url);
  });

  it("uses the system a job board's job links to", async () => {
    const job = makeJob({ id: "remotive:all:9", ats: "remotive", url: `https://jobs.lever.co/acme/${LEVER_ID}` });
    const { http, calls } = fakeHttp(() => json({ ok: false }, 404));
    expect(await isStillOpen(job, http, now)).toBe(false);
    expect(calls).toEqual([`https://api.lever.co/v0/postings/acme/${LEVER_ID}`]);
  });

  it("counts anything inconclusive as open", async () => {
    const job = makeJob({ id: "remotive:all:9", ats: "remotive", url: "https://remotive.com/remote-jobs/product/pm-9" });
    const answers: (() => Response | Promise<Response>)[] = [
      () => json({}, 500),
      () => json({}, 403),
      () => Promise.reject(new TypeError("fetch failed")),
      () => redirected(html("Our careers: no longer accepting applications for this role")),
    ];
    for (const answer of answers) expect(await isStillOpen(job, fakeHttp(answer).http, now)).toBe(true);
    expect(await isStillOpen(makeJob({ url: "" }), fakeHttp(() => json({}, 404)).http, now)).toBe(true);
  });
});

describe("pageSaysOpen", () => {
  const page = (res: () => Response) => pageSaysOpen("https://acme.example/jobs/1", fakeHttp(res).http);

  it("404 and 410 are closed", async () => {
    expect(await page(() => html("", 404))).toBe(false);
    expect(await page(() => html("", 410))).toBe(false);
  });

  it("reads conservative closed wording off the page, not off its scripts", async () => {
    expect(await page(() => html("<h1>Senior PM</h1><p>This position is no longer available.</p>"))).toBe(false);
    expect(await page(() => html("We are no longer accepting applications"))).toBe(false);
    expect(await page(() => html("<h1>Senior PM</h1><button>Apply</button>"))).toBe(true);
    expect(await page(() => html('<script>const t = "This job has expired"</script><h1>Senior PM</h1>'))).toBe(true);
    // Wording about something else isn't about this job.
    expect(await page(() => html("Our old office is closed; the role is hybrid."))).toBe(true);
  });
});

describe("isOpen per hiring system", () => {
  it("greenhouse: by the link's board and id, or ?gh_jid= on a company's own page", async () => {
    const { ctx: c, calls } = ctx(() => json({}, 404));
    expect(await greenhouse.isOpen!({ id: "greenhouse:acme:1", url: "https://job-boards.eu.greenhouse.io/Acme/jobs/77" }, c)).toBe(false);
    // A slug read off the id is lowercased, so its 404 can't prove the job closed.
    expect(await greenhouse.isOpen!({ id: "greenhouse:acme:55", url: "https://acme.example/careers?gh_jid=55" }, c)).toBeUndefined();
    expect(calls).toEqual(["https://boards-api.greenhouse.io/v1/boards/Acme/jobs/77", "https://boards-api.greenhouse.io/v1/boards/acme/jobs/55"]);
    // A company page's own /jobs/5 isn't a Greenhouse id.
    expect(await greenhouse.isOpen!({ id: "remotive:all:1", url: "https://acme.example/jobs/5" }, c)).toBeUndefined();
  });

  it("lever: the posting on the board's own region", async () => {
    const { ctx: c, calls } = ctx(() => json({ id: LEVER_ID }));
    expect(await lever.isOpen!({ id: `lever:acme:${LEVER_ID}`, url: `https://jobs.eu.lever.co/acme/${LEVER_ID}/apply` }, c)).toBe(true);
    expect(calls).toEqual([`https://api.eu.lever.co/v0/postings/acme/${LEVER_ID}`]);
    expect(await lever.isOpen!({ id: "lever:acme:x", url: "https://jobs.lever.co/acme" }, c)).toBeUndefined();
  });

  it("ashby: present in or missing from the board's list; an empty or failed list can't tell", async () => {
    const job = { id: `ashby:acme:${ASHBY_ID}`, url: `https://jobs.ashbyhq.com/acme/${ASHBY_ID}` };
    expect(await ashby.isOpen!(job, ctx(() => json({ jobs: [{ id: ASHBY_ID, isListed: false }] })).ctx)).toBe(true);
    expect(await ashby.isOpen!(job, ctx(() => json({ jobs: [{ id: "other" }] })).ctx)).toBe(false);
    expect(await ashby.isOpen!(job, ctx(() => json({ jobs: [] })).ctx)).toBeUndefined();
    expect(await ashby.isOpen!(job, ctx(() => json({}, 500)).ctx)).toBeUndefined();
  });

  it("smartrecruiters: the posting's API address and its active flag", async () => {
    const job = { id: "smartrecruiters:acme:744000012345678", url: "https://jobs.smartrecruiters.com/Acme/744000012345678-senior-pm" };
    const { ctx: c, calls } = ctx(() => json({ message: "not found" }, 404));
    expect(await smartrecruiters.isOpen!(job, c)).toBe(false);
    expect(calls).toEqual(["https://api.smartrecruiters.com/v1/companies/Acme/postings/744000012345678"]);
    // A taken-down posting still answers 200, with active: false.
    expect(await smartrecruiters.isOpen!(job, ctx(() => json({ id: "744000012345678", active: false })).ctx)).toBe(false);
    expect(await smartrecruiters.isOpen!(job, ctx(() => json({ id: "744000012345678", active: true })).ctx)).toBe(true);
    expect(await smartrecruiters.isOpen!(job, ctx(() => json({ id: "744000012345678" })).ctx)).toBeUndefined();
  });

  it("workday: the job's detail address on the careers site's API", async () => {
    const { ctx: c, calls } = ctx(() => json({ jobPostingInfo: {} }));
    const url = "https://acme.wd5.myworkdayjobs.com/en-US/External/job/Dubai/Senior-PM_R123";
    expect(await workday.isOpen!({ id: "workday:acme|external:R123", url }, c)).toBe(true);
    expect(calls).toEqual(["https://acme.wd5.myworkdayjobs.com/wday/cxs/acme/External/job/Dubai/Senior-PM_R123"]);
  });

  it("workday: a 404 is checked against the board's search for the requisition number (a title edit moves the address)", async () => {
    const job = { id: "workday:acme|external:R123", url: "https://acme.wd5.myworkdayjobs.com/External/job/Dubai/Senior-PM_R123" };
    const searched = (answer: unknown) => {
      const f = ctx((_url, init) => (init?.method === "POST" ? json(answer) : json({ errorCode: "NOT_FOUND" }, 404)));
      return workday.isOpen!(job, f.ctx).then((open) => ({ open, calls: f.calls }));
    };
    const renamed = await searched({ total: 1, jobPostings: [{ title: "Lead PM", externalPath: "/job/Dubai/Lead-PM_R123" }] });
    expect(renamed.open).toBe(true);
    expect(renamed.calls.at(-1)).toBe("https://acme.wd5.myworkdayjobs.com/wday/cxs/acme/External/jobs");
    expect((await searched({ total: 0, jobPostings: [] })).open).toBe(false);
    // Other jobs that merely match the search can't say.
    expect((await searched({ total: 1, jobPostings: [{ title: "PM", externalPath: "/job/Dubai/PM_R1234" }] })).open).toBeUndefined();
  });
});

describe("checkStillOpen", () => {
  it("returns the closed ones, and starts no new check once stopped", async () => {
    const jobs = [1, 2, 3, 4, 5, 6].map((n) => makeJob({ id: `remotive:all:${n}`, ats: "remotive", url: `https://acme.example/jobs/${n}` }));
    const res = await checkStillOpen(jobs, { http: fakeHttp((u) => (u.endsWith("/2") ? html("", 404) : html("Apply"))).http });
    expect(res).toEqual({ checked: 6, closed: new Set([jobs[1]!.id]) });

    let n = 0;
    const stopped = await checkStillOpen(jobs, {
      http: fakeHttp(() => {
        n++;
        return html("Apply");
      }).http,
      stopped: () => n >= 2,
    });
    expect(stopped.checked).toBeLessThan(6);
  });
});

describe("scan with checkBeforeAlert", () => {
  const config = parseConfig(`
profile:
  titles: { include: ["product manager"] }
  locations: { include: [], remote_ok: ["remote", "worldwide"], remote_exclude: [] }
companies:
  - { name: "Remotive", ats: remotive, slug: "all" }
`);
  const remotiveJob = (id: number) => ({
    id,
    url: `https://remotive.com/remote-jobs/product/pm-${id}`,
    title: "Senior Product Manager",
    company_name: "Acme",
    candidate_required_location: "Worldwide",
  });
  const routes = (u: string) => {
    if (u.includes("/api/remote-jobs")) return json({ jobs: [remotiveJob(7), remotiveJob(8)] });
    if (u.endsWith("pm-7")) return html("", 404);
    return html("<h1>Senior Product Manager</h1>");
  };

  it("leaves a closed job out of the alert and saves it closed", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jh-live-"));
    const { http } = fakeHttp(routes);
    const r = await scan(config, { dataDir: dir, http, now, only: ["Remotive"], checkBeforeAlert: true });
    expect(r.openCheck).toEqual({ checked: 2, closed: 1 });
    expect(r.result.jobs.map((j) => j.id)).toEqual(["remotive:all:8"]);
    expect([...r.merged.newIds]).toEqual(["remotive:all:8"]);
    const saved = (JSON.parse(readFileSync(join(dir, "history.json"), "utf8")) as { jobs: Job[] }).jobs;
    expect(saved.find((j) => j.id === "remotive:all:7")).toMatchObject({ status: "closed", closedAt: now.toISOString() });
    expect(saved.find((j) => j.id === "remotive:all:8")).toMatchObject({ status: "open" });
  });

  it("checks nothing without it", async () => {
    const { http, calls } = fakeHttp(routes);
    const r = await scan(config, { dataDir: mkdtempSync(join(tmpdir(), "jh-live-")), http, now, only: ["Remotive"] });
    expect(r.openCheck).toBeUndefined();
    expect(r.result.jobs).toHaveLength(2);
    expect(calls).toHaveLength(1);
  });
});

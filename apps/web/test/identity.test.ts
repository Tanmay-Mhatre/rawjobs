import { describe, expect, it } from "vitest";
import type { Job } from "../src/lib/data";
import { foldCompanies, groupJobs, roleCount } from "../src/lib/filters";
import { attachFeedJobs, identityOf } from "../src/lib/identity";
import { makeJob } from "./helpers";

const at = (ats: string, slug: string, o: Partial<Job> = {}) =>
  makeJob({ ats: ats as Job["ats"], companyKey: `${ats}:${slug}`, title: "Account Executive", ...o, id: `${ats}:${slug}:${o.id ?? Math.random()}` });
const feed = (o: Partial<Job> = {}) => makeJob({ ats: "remotive", companyKey: "remotive:remotive", title: "Account Executive", ...o, id: `remotive:remotive:${o.id ?? Math.random()}` });

describe("company identity", () => {
  it("two different companies named Linear stay apart", () => {
    const a = at("ashby", "linear", { company: "Linear" });
    const b = at("cornerstone", "linear", { company: "Linear" });
    expect(groupJobs([a, b])).toHaveLength(2);
    expect(roleCount([a, b])).toBe(2);
    // and a job board's "Linear" joins neither: the name isn't unique.
    const copy = feed({ company: "Linear" });
    expect(attachFeedJobs([a, b, copy])[2]!.identity).toBeUndefined();
    expect(groupJobs(attachFeedJobs([a, b, copy]))).toHaveLength(3);
  });

  it("boards the directory joined (same_as) are one company: Doctolib on Ashby and Greenhouse", () => {
    const a = at("ashby", "doctolib", { company: "Doctolib", identity: "greenhouse:doctolib", title: "Senior Software Engineer (m/w/d)" });
    const g = at("greenhouse", "doctolib", { company: "Doctolib", identity: "greenhouse:doctolib", title: "Sr. Software Engineer - R12345" });
    const groups = groupJobs([a, g]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.jobs).toHaveLength(2);
    expect(identityOf(a)).toBe(identityOf(g));
  });

  it("a job board's copy joins the only company with that name when the role and places fit", () => {
    const own = at("greenhouse", "acme", { company: "Acme", score: 70, hasDescription: true });
    const copy = feed({ company: "Acme, Inc.", score: 95 });
    const list = attachFeedJobs([copy, own]);
    expect(list[0]!.identity).toBe("greenhouse:acme");
    const [group] = groupJobs(list);
    // The company's own posting leads, though the copy scores higher.
    expect(group!.lead.id).toBe(own.id);
    expect(group!.jobs).toHaveLength(2);
    expect(roleCount(list)).toBe(1);
  });

  it("no join when the places don't fit, or the role isn't posted by the company", () => {
    const own = at("greenhouse", "acme", { company: "Acme" });
    const elsewhere = feed({ company: "Acme", location: "Berlin", countries: ["Germany"], cities: ["Berlin, Germany"] });
    expect(attachFeedJobs([own, elsewhere])[1]!.identity).toBeUndefined();
    const otherRole = feed({ company: "Acme", title: "Head of Design" });
    expect(attachFeedJobs([own, otherRole])[1]!.identity).toBeUndefined();
    // Remote on both sides fits.
    const remoteOwn = at("greenhouse", "acme", { company: "Acme", workplace: "remote", location: "Remote", countries: [], cities: [] });
    const remoteCopy = feed({ company: "Acme", workplace: "remote", location: "Anywhere (Remote)", countries: [], cities: [] });
    expect(attachFeedJobs([remoteOwn, remoteCopy])[1]!.identity).toBe("greenhouse:acme");
  });

  it("two job boards' copies of one job group together", () => {
    const one = feed({ company: "Acme" });
    const two = makeJob({ ats: "himalayas", id: "himalayas:himalayas:1", company: "ACME Ltd", title: "Account Executive" });
    expect(groupJobs(attachFeedJobs([one, two]))).toHaveLength(1);
  });

  it("the lead is your scanned, open posting over the directory's estimate", () => {
    const estimate = at("greenhouse", "acme", { company: "Acme", estimated: true, score: 90 });
    const scanned = at("greenhouse", "acme", { company: "Acme", score: 60, location: "Abu Dhabi" });
    expect(groupJobs([estimate, scanned])[0]!.lead.id).toBe(scanned.id);
  });

  it("folds by identity, so one name at two companies folds apart", () => {
    const groups = groupJobs([1, 2, 3].flatMap((n) => [at("ashby", "linear", { company: "Linear", title: `Role ${n}` }), at("lever", "linear", { company: "Linear", title: `Role ${n}` })]));
    const rows = foldCompanies(groups);
    expect(rows.filter((r) => r.kind === "more").map((r) => (r.kind === "more" ? r.key : ""))).toEqual(["ashby:linear", "lever:linear"]);
  });

  it("data saved before company keys groups by name, as before", () => {
    const a = makeJob({ id: "greenhouse:acme:1", company: "Acme", title: "PM" });
    const b = makeJob({ id: "greenhouse:acme:2", company: "Acme", title: "PM", location: "London" });
    expect(groupJobs([a, b])).toHaveLength(1);
  });
});

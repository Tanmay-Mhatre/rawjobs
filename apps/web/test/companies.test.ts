import { describe, expect, it } from "vitest";
import type { AtsType } from "@rawjobs/core/schema";
import { addCompanies, groupBoards, replaceCompany } from "../src/lib/companies";
import type { CompanyRow } from "../src/lib/setup";

const b = (key: string, name: string, status = "live", open_jobs: number | null = 10) => ({ key, name, ats: key.split(":")[0]!, status, open_jobs });

describe("groupBoards", () => {
  it("shows one row per company, leading with its best board and dropping dead ones", () => {
    const groups = groupBoards([
      b("smartrecruiters:binance", "Binance", "live", 4),
      b("greenhouse:binance", "Binance", "dormant", 0),
      b("lever:binance", "Binance", "live", 311),
      b("ashby:binance.us", "Binance.US", "live", 7),
    ]);
    expect(groups.map((g) => [g.lead.key, g.others.map((o) => o.key)])).toEqual([
      ["lever:binance", ["smartrecruiters:binance"]],
      ["ashby:binance.us", []],
    ]);
  });

  it("prefers a board we can scan, and treats company suffixes as the same name", () => {
    // "kenexa": a hiring system we can't read.
    const [g] = groupBoards([b("kenexa:gusto", "Gusto", "live", 50), b("greenhouse:gusto", "Gusto, Inc.", "live", 20)]);
    expect(g!.lead.key).toBe("greenhouse:gusto");
    expect(g!.others.map((o) => o.key)).toEqual(["kenexa:gusto"]);
  });

  it("keeps a dead board you watch, and keeps dead boards when nothing is live", () => {
    const watched = new Set(["greenhouse:old"]);
    expect(groupBoards([b("lever:old", "Old"), b("greenhouse:old", "Old", "dormant", 0)], watched)[0]!.others.map((o) => o.key)).toEqual(["greenhouse:old"]);
    expect(groupBoards([b("lever:quiet", "Quiet", "dormant", 0)])[0]!.lead.key).toBe("lever:quiet");
  });
});

describe("replaceCompany", () => {
  const rowOf = (name: string, ats: AtsType, slug: string): CompanyRow => ({ id: slug, input: `${ats}: ${slug}`, state: "saved", name, ats, slug });
  const draft = { companies: [rowOf("Acme", "greenhouse", "acme"), rowOf("Globex", "lever", "globex")], muted: ["ashby:acme-co"] };

  it("puts the new board in the old one's place, keeping its name and unhiding the new board", () => {
    const done = replaceCompany(draft, "greenhouse:acme", { name: "Acme Inc", ats: "ashby", slug: "acme-co" })!;
    expect(done.patch.companies!.map((r) => [r.id, r.name, `${r.ats}:${r.slug}`])).toEqual([
      ["acme", "Acme", "ashby:acme-co"],
      ["globex", "Globex", "lever:globex"],
    ]);
    expect(done.patch.companies![0]!.input).toBe("https://jobs.ashbyhq.com/acme-co");
    expect(done.patch.muted).toEqual([]);
    expect(done.before.slug).toBe("acme");
  });

  it("remembers the old board as replaced, and forgets the new one if it was", () => {
    const done = replaceCompany({ ...draft, replaced: ["ashby:acme-co", "lever:gone"] }, "greenhouse:acme", { name: "Acme", ats: "ashby", slug: "acme-co" })!;
    expect(done.patch.replaced).toEqual(["lever:gone", "greenhouse:acme"]);
  });

  it("adding a replaced board back on purpose un-forgets it", () => {
    const { patch } = addCompanies({ ...draft, replaced: ["taleo:mashreqbank"] }, [{ name: "Mashreq", ats: "taleo", slug: "mashreqbank", careers_url: "https://www.mashreq.com/careers" }]);
    expect(patch!.replaced).toEqual([]);
    expect(addCompanies({ ...draft, replaced: ["taleo:other"] }, [{ name: "X", ats: "lever", slug: "x", careers_url: "https://jobs.lever.co/x" }]).patch!.replaced).toBeUndefined();
  });

  it("does nothing when the old one is gone or the new board is already yours", () => {
    expect(replaceCompany(draft, "greenhouse:nope", { name: "X", ats: "ashby", slug: "x" })).toBeNull();
    expect(replaceCompany(draft, "greenhouse:acme", { name: "Globex", ats: "lever", slug: "globex" })).toBeNull();
  });
});

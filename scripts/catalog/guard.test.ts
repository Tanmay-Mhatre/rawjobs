import { describe, expect, it } from "vitest";
import { gate, type Candidate, type Row } from "./guard";

/** The live release when this gate was written (10 Oct 2026). */
const LIVE = { companies: 44_157, indexed: 16_970 };

function candidate(companies: number, indexed: number, edit: (rows: Row[], index: { key?: string }[]) => void = () => {}): Candidate {
  const rows: Row[] = Array.from({ length: companies }, (_, i) => ({ key: `greenhouse:c${i}`, ats: "greenhouse", slug: `c${i}`, name: `C${i}`, careers_url: `https://job-boards.greenhouse.io/c${i}` }));
  const index = rows.slice(0, indexed).map((r) => ({ key: r.key }));
  edit(rows, index);
  return { manifest: { companies, indexed }, directory: { count: companies, companies: rows }, index: { count: indexed, companies: index } };
}

describe("release gate", () => {
  it("passes growth, a small dip, and the live release itself", () => {
    expect(gate(LIVE, candidate(46_000, 17_500)).ok).toBe(true);
    expect(gate(LIVE, candidate(LIVE.companies + 3_000, LIVE.indexed)).ok).toBe(true);
    expect(gate(LIVE, candidate(42_000, 16_000)).ok).toBe(true);
    expect(gate(LIVE, candidate(LIVE.companies, LIVE.indexed)).ok).toBe(true);
  });

  it("refuses a directory that shrank below 90% of companies or 85% of indexed", () => {
    expect(gate(LIVE, candidate(39_000, 16_970)).reasons).toEqual([expect.stringMatching(/^companies 39000 is 88\.3% of the live 44157/)]);
    expect(gate(LIVE, candidate(44_157, 14_000)).reasons).toEqual([expect.stringMatching(/^indexed 14000 is 82\.5%/)]);
  });

  it("allow_shrink lifts the shrink rules only", () => {
    const shrunk = gate(LIVE, candidate(39_000, 14_000), true);
    expect(shrunk.ok).toBe(true);
    expect(shrunk.warnings).toHaveLength(2);
    const broken = gate(LIVE, candidate(39_000, 14_000, (rows) => (rows[1]!.key = rows[0]!.key)), true);
    expect(broken.ok).toBe(false);
    expect(broken.reasons).toEqual([expect.stringMatching(/duplicate keys/), expect.stringMatching(/indexed companies not in the directory/)]);
  });

  it("refuses anything under the floors, even with no live release to compare with", () => {
    expect(gate(null, candidate(25_000, 12_000)).ok).toBe(true);
    expect(gate(null, candidate(19_000, 12_000)).reasons).toEqual([expect.stringMatching(/under the floor of 20000/)]);
    expect(gate(null, candidate(25_000, 9_000)).reasons).toEqual([expect.stringMatching(/under the floor of 10000/)]);
  });

  it("refuses counts that disagree, incomplete rows and index entries the directory doesn't have", () => {
    const c = candidate(30_000, 12_000);
    c.manifest.companies = 30_001;
    expect(gate(null, c).reasons).toEqual([expect.stringMatching(/^directory counts disagree/)]);
    expect(gate(null, candidate(30_000, 12_000, (rows) => delete rows[5]!.slug)).reasons).toEqual(["1 rows missing key, ats, slug or name"]);
    expect(gate(null, candidate(30_000, 12_000, (_, index) => (index[0]!.key = "lever:gone"))).reasons).toEqual([expect.stringMatching(/^1 indexed companies not in the directory/)]);
  });

  it("warns about a few rows without a careers_url and refuses many", () => {
    const few = gate(null, candidate(30_000, 12_000, (rows) => (rows[0]!.careers_url = "")));
    expect(few.ok).toBe(true);
    expect(few.warnings).toEqual(["1 rows without a careers_url"]);
    const many = gate(null, candidate(30_000, 12_000, (rows) => rows.slice(0, 400).forEach((r) => (r.careers_url = ""))));
    expect(many.reasons).toEqual([expect.stringMatching(/^400 rows without a careers_url \(over 1%\)/)]);
  });
});

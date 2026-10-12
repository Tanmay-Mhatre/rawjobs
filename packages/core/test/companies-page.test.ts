import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { recordAdditions } from "../src/companies-page";
import type { CompanyCheck } from "../src/protocol";

let dir: string;
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const check = (slug: string, extra: Partial<CompanyCheck> = {}): CompanyCheck => ({
  input: `https://jobs.lever.co/${slug}`,
  status: "live",
  key: `lever:${slug}`,
  name: slug,
  ats: "lever",
  slug,
  careers_url: `https://jobs.lever.co/${slug}`,
  open_jobs: 3,
  ...extra,
});

describe("recordAdditions", () => {
  it("keeps live and dormant boards the directory doesn't have, and their first added date", () => {
    dir = mkdtempSync(join(tmpdir(), "rawjobs-additions-"));
    recordAdditions(dir, [check("acme"), check("quiet", { status: "dormant", open_jobs: 0 }), check("known", { in_directory: true }), check("broken", { status: "error" })]);
    const read = () => (JSON.parse(readFileSync(join(dir, "catalog", "additions.json"), "utf8")) as { companies: { key: string; added_at: string; open_jobs: number | null }[] }).companies;
    expect(read().map((c) => c.key)).toEqual(["lever:acme", "lever:quiet"]);
    const first = read()[0]!.added_at;
    recordAdditions(dir, [check("acme", { open_jobs: 9 })]);
    expect(read()[0]).toMatchObject({ key: "lever:acme", open_jobs: 9, added_at: first });
  });
});

import { careersUrl, companyKey } from "@rawjobs/core/company-key";
import { type CompanyRef, SUPPORTED } from "@rawjobs/core/directory-search";
import { rowId, type CompanyRow, type Draft } from "./setup";

// The directory search lives in core (shared with the local server): kept importable from here.
export { ATS_LABEL, type BoardGroup, type CompanyRef, countCompanies, groupBoards, SUPPORTED } from "@rawjobs/core/directory-search";

/** "Review failing companies" links: My companies, sorted by Needs attention. */
export const FAILING_HASH = "companies?sort=attention";
/** The address asks for Needs attention (a "failing" link was followed). */
export const wantsAttention = () => new URLSearchParams(location.hash.split("?")[1] ?? "").get("sort") === "attention";

/** Directory key for a watched company or a directory entry: "ats:slug" (Workday adds shard and site). */
export const keyOf = (c: { ats?: string; slug?: string; shard?: string; site?: string }) => companyKey({ ats: c.ats ?? "", slug: c.slug ?? "", shard: c.shard, site: c.site });

/** A job's directory key: saved jobs carry it; older ones fall back to the "ats:slug:" start of their id. */
export const jobCompanyKey = (j: { id: string; companyKey?: string }) => j.companyKey ?? j.id.split(":").slice(0, 2).join(":").toLowerCase();

/**
 * The company behind a job, to add or mute it from the Radar. A directory job links to the careers
 * page already; a scanned one gets the board's address. Workday keys are "tenant|shard|site", Taleo "host|section".
 */
export function refOfJob(j: { id: string; ats: string; company: string; url: string; companyKey?: string; estimated?: boolean }): CompanyRef {
  const key = jobCompanyKey(j);
  const parts = key.slice(key.indexOf(":") + 1).split("|");
  const slug = parts[0] ?? "";
  const board: { shard?: string; site?: string } = j.ats === "workday" && parts.length === 3 ? { shard: parts[1], site: parts[2] } : j.ats === "taleo" && parts.length === 2 ? { site: parts[1] } : {};
  return { name: j.company, ats: j.ats, slug, ...board, careers_url: j.estimated ? j.url : careersUrl({ ats: j.ats as never, slug, ...board }) || j.url };
}

export function toRow(c: CompanyRef): CompanyRow {
  return {
    id: rowId(),
    input: c.careers_url,
    state: SUPPORTED.has(c.ats) ? "saved" : "soon",
    name: c.name,
    ats: c.ats as CompanyRow["ats"],
    slug: c.slug,
    region: c.region as CompanyRow["region"],
    shard: c.shard,
    site: c.site,
  };
}

/**
 * Add companies not in the draft yet (adding one also unhides it, and un-forgets a link you replaced):
 * the draft patch, and the keys actually added.
 */
export function addCompanies(draft: Pick<Draft, "companies" | "muted"> & Partial<Pick<Draft, "replaced">>, list: readonly CompanyRef[]): { patch: Partial<Draft> | null; keys: string[] } {
  const seen = new Set(draft.companies.map(keyOf));
  const rows = list.filter((c) => {
    const k = keyOf(c);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  if (!rows.length) return { patch: null, keys: [] };
  const keys = new Set(rows.map(keyOf));
  const patch: Partial<Draft> = { companies: [...draft.companies, ...rows.map(toRow)], muted: draft.muted.filter((k) => !keys.has(k)) };
  if (draft.replaced?.some((k) => keys.has(k))) patch.replaced = draft.replaced.filter((k) => !keys.has(k));
  return { patch, keys: [...keys] };
}

/**
 * Put a company's new board in place of its old one: same place in the list, same name, and the new
 * board unhidden. The old board is remembered as replaced, so suggestions and packs don't add it back.
 * Null when the old one isn't in the list or the new board already is.
 */
export function replaceCompany(
  draft: Pick<Draft, "companies" | "muted"> & Partial<Pick<Draft, "replaced">>,
  oldKey: string,
  to: Omit<CompanyRef, "careers_url"> & { careers_url?: string },
): { patch: Partial<Draft>; before: CompanyRow; key: string } | null {
  const before = draft.companies.find((r) => keyOf(r) === oldKey);
  const key = keyOf(to);
  if (!before || draft.companies.some((r) => keyOf(r) === key)) return null;
  const row = { ...toRow({ ...to, name: before.name || to.name, careers_url: to.careers_url || careersUrl(to as never) }), id: before.id };
  const replaced = [...new Set([...(draft.replaced ?? []).filter((k) => k !== key), keyOf(before)])];
  return { patch: { companies: draft.companies.map((r) => (r === before ? row : r)), muted: draft.muted.filter((k) => k !== key), replaced }, before, key };
}

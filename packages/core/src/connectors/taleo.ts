import type { NormalizedJob } from "../schema";
import { htmlToText, inferWorkplace } from "../text";
import { detectAs, isoDate } from "./parse";
import { jobCompanyKey, type Connector } from "./types";

/** A row of a Taleo career section's job board (the section's own REST search). */
export type TaleoRequisition = {
  jobId: string;
  contestNo: string;
  /** The section's list columns, in its own order: title first, then location, date… as configured. */
  column: string[];
  /** Which columns hold locations (each a JSON array as text). */
  locationsColumns?: number[];
};

type Search = { requisitionList?: TaleoRequisition[]; pagingData?: { totalCount?: number; pageSize?: number } };

const MAX_PAGES = 80;

const base = (ref: { slug: string }) => `https://${ref.slug}.taleo.net/careersection`;
/** "2" is Taleo's default external section name. */
const sectionOf = (ref: { site?: string }) => ref.site || "2";

const SEARCH = (pageNo: number) => ({
  multilineEnabled: false,
  sortingSelection: { sortBySelectionParam: "3", ascendingSortingOrder: "false" },
  fieldData: { fields: { KEYWORD: "", LOCATION: "" }, valid: true },
  filterSelectionParam: { searchFilterSelections: [] },
  advancedSearchFiltersSelectionParam: { searchFilterSelections: [] },
  pageNo,
});

function locationText(cell: string): string {
  try {
    const list = JSON.parse(cell) as unknown;
    if (Array.isArray(list)) return list.join("; ");
  } catch {
    // a plain value
  }
  return cell;
}

/** Taleo URL-encodes the description into a hidden field, with "\:" for ":". */
function decodeLoose(s: string): string {
  const raw = s.replace(/^!\*!/, "");
  let out: string;
  try {
    out = decodeURIComponent(raw);
  } catch {
    out = raw.replace(/%([0-9a-f]{2})/gi, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
  }
  return out.replace(/\\(.)/g, "$1");
}

export const taleo: Connector<TaleoRequisition> = {
  ats: "taleo",
  detect: detectAs("taleo"),

  async fetch(ref, { http }) {
    // The search needs the section's portal number, which only its search page shows.
    const page = await http.getText(`${base(ref)}/${encodeURIComponent(sectionOf(ref))}/jobsearch.ftl?lang=en`);
    const portal = page.match(/portal=(\d+)/)?.[1];
    if (!portal) throw new Error(`Taleo career section "${sectionOf(ref)}" not found on ${ref.slug}.taleo.net`);
    const out: TaleoRequisition[] = [];
    for (let pageNo = 1; pageNo <= MAX_PAGES; pageNo++) {
      const res = await http.request(`${base(ref)}/rest/jobboard/searchjobs?lang=en&portal=${portal}`, {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/json", tz: "GMT+00:00" },
        body: JSON.stringify(SEARCH(pageNo)),
      });
      const data = (await res.json()) as Search;
      if (!Array.isArray(data.requisitionList)) throw new Error("unexpected Taleo response: no requisitionList");
      out.push(...data.requisitionList);
      const size = data.pagingData?.pageSize || 25;
      if (pageNo * size >= (data.pagingData?.totalCount ?? 0) || data.requisitionList.length === 0) break;
    }
    return out;
  },

  normalize(raw, ref): NormalizedJob {
    const locCols = new Set(raw.locationsColumns ?? []);
    const location = [...locCols]
      .map((i) => locationText(raw.column[i] ?? ""))
      .filter(Boolean)
      .join("; ");
    const date = raw.column.find((c, i) => i > 0 && !locCols.has(i) && /^[A-Z][a-z]{2} \d{1,2}, \d{4}$/.test(c));
    // Columns that are neither title, location nor date: usually the job field.
    const other = raw.column.find((c, i) => i > 0 && !locCols.has(i) && c !== date && c.length < 80);
    return {
      id: `${jobCompanyKey(ref)}:${raw.contestNo || raw.jobId}`,
      ats: "taleo",
      company: ref.name,
      title: (raw.column[0] ?? "").trim(),
      location,
      workplace: inferWorkplace(location),
      department: other,
      // "Oct 7, 2026": a calendar date, read as UTC so it doesn't shift a day.
      postedAt: isoDate(date && `${date} UTC`),
      url: `${base(ref)}/${encodeURIComponent(sectionOf(ref))}/jobdetail.ftl?job=${encodeURIComponent(raw.contestNo)}&lang=en`,
      description: "",
    };
  },

  async describe(raw, ref, { http }) {
    const html = await http.getText(`${base(ref)}/${encodeURIComponent(sectionOf(ref))}/jobdetail.ftl?job=${encodeURIComponent(raw.contestNo)}&lang=en`);
    const field = html.match(/id="initialHistory"[^>]*value="([^"]*)"/)?.[1] ?? html.match(/value="([^"]*)"[^>]*id="initialHistory"/)?.[1];
    if (!field) return "";
    // The longest piece holding markup is the description (qualifications come next).
    const pieces = field
      .split("!|!")
      .filter((p) => /%3C|</i.test(p))
      .map(decodeLoose)
      .sort((a, b) => b.length - a.length);
    return pieces.slice(0, 2).map(htmlToText).filter(Boolean).join("\n\n");
  },
};

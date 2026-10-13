/**
 * Visa sponsor registers: government lists of employers allowed to sponsor work visas. The shared
 * directory tags each company found on one (scripts/catalog/visa.ts) with `visa: { GB: "2026-10-13" }`,
 * country code -> the list it was on (a date, a fiscal year or a quarter). The app shows "Sponsors
 * visas" on jobs in that country. Being on a list means the company can sponsor, not that a given role will.
 * Browser-safe: no Node imports.
 */

export type VisaCountry = "GB" | "US" | "CA" | "NL";
/** Country code -> the list it was on: "2026-10-13" (GB, NL), "FY2026" (US), "2026Q1" (CA). */
export type VisaInfo = Partial<Record<VisaCountry, string>>;

type Register = {
  /** The job's country, as job.countries names it. */
  country: string;
  /** "the UK register of licensed sponsors (Skilled Worker)" */
  name: string;
  /** Who publishes it, and under what terms. */
  source: string;
};

export const VISA_REGISTERS: Record<VisaCountry, Register> = {
  GB: { country: "United Kingdom", name: "UK register of licensed sponsors (Skilled Worker)", source: "UK Home Office, Open Government Licence" },
  US: { country: "United States", name: "USCIS list of H-1B employers with approvals", source: "USCIS H-1B Employer Data Hub" },
  CA: { country: "Canada", name: "Canadian list of employers approved to hire foreign workers (positive LMIA)", source: "ESDC, Open Government Licence – Canada" },
  NL: { country: "Netherlands", name: "Dutch register of recognised sponsors (work)", source: "IND public register of recognised sponsors" },
};

export const VISA_COUNTRIES = Object.keys(VISA_REGISTERS) as VisaCountry[];

const BY_COUNTRY = new Map(VISA_COUNTRIES.map((c) => [VISA_REGISTERS[c].country.toLowerCase(), c]));

/** "United Kingdom" -> "GB"; undefined for a country without a register here. */
export const visaCountryOf = (country: string): VisaCountry | undefined => BY_COUNTRY.get(country.trim().toLowerCase());

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const QUARTER = ["Jan–Mar", "Apr–Jun", "Jul–Sep", "Oct–Dec"];

/** "2026-10-09" -> "9 Oct 2026"; "FY2025" -> "fiscal year 2025"; "2026Q1" -> "Jan–Mar 2026". */
export function visaPeriodLabel(period: string): string {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(period);
  if (d) return `${Number(d[3])} ${MONTHS[Number(d[2]) - 1] ?? d[2]} ${d[1]}`;
  const fy = /^FY(\d{4})$/.exec(period);
  if (fy) return `fiscal year ${fy[1]}`;
  const q = /^(\d{4})Q([1-4])$/.exec(period);
  if (q) return `${QUARTER[Number(q[2]) - 1]} ${q[1]}`;
  return period;
}

export type Sponsor = { country: VisaCountry; period: string };

/**
 * Does this role's company sponsor visas where the role is? Yes when the company is on a register for
 * any posting's country (a role posted in several places: any of them). The first such country wins,
 * in the postings' order.
 */
export function sponsorOf(postings: readonly { countries: readonly string[]; visa?: VisaInfo }[]): Sponsor | undefined {
  for (const j of postings) {
    if (!j.visa) continue;
    for (const name of j.countries) {
      const country = visaCountryOf(name);
      const period = country && j.visa[country];
      if (country && period) return { country, period };
    }
  }
  return undefined;
}

/** "list of 9 Oct 2026" (a dated list), "list for fiscal year 2026", "list for Jan–Mar 2026". */
export const visaListLabel = (period: string) => `list ${/^\d{4}-\d{2}-\d{2}$/.test(period) ? "of" : "for"} ${visaPeriodLabel(period)}`;

/** The badge's tooltip: "On the UK register of licensed sponsors (Skilled Worker), list of 9 Oct 2026. Ask whether this role is open to sponsorship." */
export const sponsorTitle = (s: Sponsor) => `On the ${VISA_REGISTERS[s.country].name}, ${visaListLabel(s.period)}. Ask whether this role is open to sponsorship.`;

/** The job page's line: "Acme is on the UK register of licensed sponsors (Skilled Worker), list of 9 Oct 2026." */
export const sponsorSentence = (company: string, s: Sponsor) => `${company} is on the ${VISA_REGISTERS[s.country].name}, ${visaListLabel(s.period)}.`;

/** Keeps only known country codes with a string period (a directory from elsewhere may carry anything). */
export function cleanVisa(v: unknown): VisaInfo | undefined {
  if (!v || typeof v !== "object") return undefined;
  const out: VisaInfo = {};
  for (const c of VISA_COUNTRIES) {
    const p = (v as Record<string, unknown>)[c];
    if (typeof p === "string" && p) out[c] = p;
  }
  return Object.keys(out).length ? out : undefined;
}

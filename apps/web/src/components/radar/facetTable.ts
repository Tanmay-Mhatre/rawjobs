import type { FacetKey, FacetOption, Filters } from "../../lib/filters";

/** One filter facet as the laptop filter row and the phone filter sheet both show it. */
export type FacetDef = {
  key: FacetKey;
  label: string;
  /** One choice at a time. */
  single?: boolean;
  /** A search box over the options (long lists). */
  searchable?: boolean;
  /** Left out when no job has a value for it (industries, keywords). */
  hideEmpty?: boolean;
  /** What's picked, as option values. */
  get: (f: Filters) => string[];
  /** The filter change for a new pick. */
  set: (v: string[]) => Partial<Filters>;
};

export const FACETS: Record<FacetKey, FacetDef> = {
  posted: {
    key: "posted",
    label: "Date posted",
    single: true,
    get: (f) => (f.posted ? [String(f.posted)] : []),
    set: (v) => ({ posted: (Number(v[0]) || 0) as Filters["posted"] }),
  },
  countries: { key: "countries", label: "Country", searchable: true, get: (f) => f.countries, set: (v) => ({ countries: v }) },
  locations: { key: "locations", label: "Location", searchable: true, get: (f) => f.locations, set: (v) => ({ locations: v }) },
  workplace: { key: "workplace", label: "Workplace", get: (f) => f.workplace, set: (v) => ({ workplace: v as Filters["workplace"] }) },
  employment: { key: "employment", label: "Type", get: (f) => f.employment, set: (v) => ({ employment: v }) },
  match: {
    key: "match",
    label: "Match",
    single: true,
    get: (f) => (f.match === "all" ? [] : [f.match]),
    set: (v) => ({ match: (v[0] as Filters["match"]) ?? "all" }),
  },
  seniority: { key: "seniority", label: "Seniority", get: (f) => f.seniority, set: (v) => ({ seniority: v as Filters["seniority"] }) },
  industries: { key: "industries", label: "Industry", hideEmpty: true, get: (f) => f.industries, set: (v) => ({ industries: v }) },
  companies: { key: "companies", label: "Company", searchable: true, get: (f) => f.companies, set: (v) => ({ companies: v }) },
  topics: { key: "topics", label: "Keywords", searchable: true, hideEmpty: true, get: (f) => f.topics, set: (v) => ({ topics: v }) },
  ats: { key: "ats", label: "Hiring system", get: (f) => f.ats, set: (v) => ({ ats: v }) },
};

/** Facet counts, while the filter row or sheet shows them (undefined otherwise). */
export type FacetCounts = Record<FacetKey, FacetOption[]> | undefined;

export const facetOptions = (counts: FacetCounts, key: FacetKey) => counts?.[key] ?? [];

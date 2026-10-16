import { INDUSTRY_BY_ID, industriesFromText } from "./catalog/industries";
import { COUNTRIES, countriesIn } from "./catalog/places";
import { ROLE_FAMILIES } from "./catalog/roles";
import type { CompanySuggestion, IndexedCompany } from "./suggest";
import { termRegex } from "./text";

// ---------- company names ----------

const LEGAL_SUFFIX = /\b(inc|llc|l\.l\.c|ltd|limited|plc|gmbh|ag|sa|bv|nv|corp|corporation|co|company|pvt|private|pte|fz-?llc|fze|dmcc|holdings?|group)\b\.?/g;

/** A company name as comparable words: "Gusto, Inc." -> ["gusto"], "Fabrikam Technologies Ltd." -> ["fabrikam", "technologies"]. */
export function companyWords(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/&/g, " and ")
    .replace(LEGAL_SUFFIX, " ")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

// ---------- past employers from a resume (no AI) ----------

const SECTION_START = /^(?:#{1,3}\s*)?(?:professional\s+|work\s+|relevant\s+|career\s+)?(?:experience|employment(?:\s+history)?|work\s+history|career\s+history)\s*:?\s*$/i;
const KNOWN_SECTIONS = /^(?:#{1,3}\s*)?(?:education|skills|core skills|technical skills|projects|certifications?|awards|languages|publications|interests|summary|profile|volunteering|references)\b/i;
const DATE = /\b(?:19|20)\d{2}\b|\bpresent\b|\bcurrent\b|\bnow\b/i;
const DATE_CHUNK =
  /\(?\s*(?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+|\d{1,2}\/)?(?:19|20)\d{2}\s*(?:[-–—to]+\s*(?:(?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+|\d{1,2}\/)?(?:19|20)\d{2}|present|current|now))?\s*\)?/gi;
const TITLE_WORD =
  /\b(manager|engineer|lead|head|director|analyst|designer|developer|officer|consultant|specialist|associate|intern|vp|vice president|president|founder|co-founder|owner|architect|scientist|executive|coordinator|administrator|strategist|researcher|advisor|partner|product|marketing|sales|operations|chief|cto|ceo|cfo|coo|cpo|principal|staff|senior|junior)\b/i;

let placeNames: Set<string> | undefined;
/** Lowercase country names, aliases and cities, plus words that stand for "where" on a resume line. */
function places(): Set<string> {
  placeNames ??= new Set([...COUNTRIES.flatMap((c) => [c.name, ...c.aliases, ...c.cities]), "remote", "hybrid", "onsite", "on-site"]);
  return placeNames;
}

/** Drop a trailing location: "Northwind Abu Dhabi, UAE" -> "Northwind". Keeps at least one word. */
function stripLocation(s: string): string {
  let words = s.trim().split(/\s+/);
  for (let changed = true; changed && words.length > 1; ) {
    changed = false;
    for (let n = Math.min(4, words.length - 1); n >= 1; n--) {
      const tail = words
        .slice(-n)
        .join(" ")
        .toLowerCase()
        .replace(/^[,(\s-–—·]+|[,.)\s-–—·]+$/g, "");
      if (tail && places().has(tail)) {
        words = words.slice(0, -n);
        changed = true;
        break;
      }
    }
  }
  return words.join(" ").replace(/[\s,·\-–—(]+$/, "");
}

const looksLikeTitle = (s: string) => TITLE_WORD.test(s);
const clean = (s: string) =>
  s
    .replace(/[*_`#]/g, "")
    .replace(/\s+/g, " ")
    .trim();

/** The company in one role line, or undefined when the line isn't a role. */
function employerOfLine(raw: string, heading: boolean): string | undefined {
  const line = clean(raw);
  if (!line || line.length > 200) return undefined;
  if (!heading && !DATE.test(line)) return undefined;
  const noDates = line.replace(DATE_CHUNK, " ").replace(/\s+/g, " ").trim();

  // "Title | Company City | dates" or "Company | Title | Location"
  if (noDates.includes("|")) {
    const parts = noDates
      .split("|")
      .map((p) => p.trim())
      .filter((p) => p && !DATE.test(p) && !places().has(p.toLowerCase()));
    if (parts.length >= 2) {
      const [a, b] = parts as [string, string];
      const company = looksLikeTitle(a) && !looksLikeTitle(b) ? b : !looksLikeTitle(a) && looksLikeTitle(b) ? a : b;
      return stripLocation(company);
    }
  }
  // "Title at Company"
  const at = noDates.match(/^(.+?)\s+(?:at|@)\s+(.+)$/i);
  if (at && looksLikeTitle(at[1]!)) return stripLocation(at[2]!.split(/\s+[—–-]\s+|,/)[0]!);
  // "Title, Company — Location" or "Company — Title"
  const [left, right] = noDates.split(/\s+[—–]\s+|\s+-\s+/);
  if (right !== undefined) {
    if (left!.includes(",")) {
      const [t, ...rest] = left!.split(",");
      if (looksLikeTitle(t!)) return stripLocation(rest.join(",").trim());
    }
    if (looksLikeTitle(left!) && !looksLikeTitle(right)) return stripLocation(right.split(",")[0]!);
    if (!looksLikeTitle(left!)) return stripLocation(left!);
  }
  // "Title, Company, City, Country"
  const commas = noDates.split(",").map((p) => p.trim());
  if (commas.length >= 2 && looksLikeTitle(commas[0]!)) return stripLocation(commas[1]!);
  return undefined;
}

/**
 * Companies someone has worked at, newest first, from the Experience section of a resume (plain
 * text or Markdown). Rule-based: reads role lines like "Title | Company City | 2020 – Present",
 * "### Title, Company — City (2020 – 2022)" or "Title at Company". The user confirms the list.
 */
export function employersFromResume(text: string, max = 10): string[] {
  return rolesFromResume(text, max).map((r) => r.company);
}

/** One role on a resume: the company, and the role's own lines (its heading and bullets). */
export type ResumeRole = { company: string; text: string };

/** The Experience section's non-empty lines, trimmed. */
function experienceLines(text: string): string[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const start = lines.findIndex((l) => SECTION_START.test(clean(l)) || SECTION_START.test(l.trim()));
  if (start < 0) return [];
  const out: string[] = [];
  for (const raw of lines.slice(start + 1)) {
    const l = raw.trim();
    if (!l) continue;
    const plain = clean(l);
    // The next section: a Markdown heading of the same or higher level, a known name, or an ALL-CAPS line.
    if (/^#{1,2}\s/.test(l) || KNOWN_SECTIONS.test(plain) || (/^[A-Z][A-Z &/]{3,40}$/.test(plain) && !DATE.test(plain))) break;
    out.push(l);
  }
  return out;
}

/** Roles in the Experience section, newest first, one per company (a company's later roles fold into its first). */
export function rolesFromResume(text: string, max = 10): ResumeRole[] {
  const out: ResumeRole[] = [];
  const byKey = new Map<string, ResumeRole>();
  let current: ResumeRole | undefined;
  for (const l of experienceLines(text)) {
    const plain = clean(l);
    const bullet = /^[-*•·▪◦]\s/.test(l);
    const name = bullet ? undefined : employerOfLine(l, /^#{3,4}\s/.test(l) || /^\*\*.+\*\*$/.test(l));
    const k = name && name.length >= 2 && !(looksLikeTitle(name) && companyWords(name).length > 3) ? companyWords(name).join(" ") : "";
    if (!k) {
      if (current) current.text += `\n${plain}`;
      continue;
    }
    current = byKey.get(k);
    if (current) {
      current.text += `\n${plain}`;
      continue;
    }
    if (out.length >= max) break;
    current = { company: name!, text: plain };
    byKey.set(k, current);
    out.push(current);
  }
  return out;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const ONE_DATE = String.raw`(?:([a-z]{3,9})\.?\s+|(\d{1,2})\/)?((?:19|20)\d{2})`;
const DATE_RANGE = new RegExp(String.raw`\b${ONE_DATE}\s*(?:[-–—]+|\bto\b|\buntil\b)\s*(?:${ONE_DATE}|(present|current|now|today))\b`, "gi");
const INTERN = /\bintern(?:ship)?s?\b/i;

/** 0–11 from a month name ("Sept", "March") or number ("03"), or undefined when there's none. */
function monthOf(name: string | undefined, num: string | undefined): number | undefined {
  if (num) return Number(num) >= 1 && Number(num) <= 12 ? Number(num) - 1 : undefined;
  const i = name ? MONTHS.indexOf(name.slice(0, 3).toLowerCase()) : -1;
  return i >= 0 ? i : undefined;
}

/**
 * Years of work experience from the date ranges in the Experience section ("Mar 2018 – Present",
 * "03/2018 – 06/2021", "2018 – 2021"). Overlapping roles count once, gaps don't count, and
 * internships are left out. Rounded to whole years; undefined under a year or without dates.
 * Only ever a suggestion: the user confirms the number.
 */
export function experienceYearsFromResume(text: string, now = new Date()): { years: number; roles: number } | undefined {
  // Months as year * 12 + month; a span is [start, end).
  const today = now.getFullYear() * 12 + now.getMonth() + 1;
  const spans: [number, number][] = [];
  for (const line of experienceLines(text)) {
    if (INTERN.test(line)) continue;
    for (const [, sName, sNum, sYear, eName, eNum, eYear, open] of line.matchAll(DATE_RANGE)) {
      const start = Number(sYear) * 12 + (monthOf(sName, sNum) ?? 0);
      const eMonth = monthOf(eName, eNum);
      // An end month counts in full ("Jan – Mar" is 3 months); a bare year reads as January, and a range within one year as 6 months.
      const end = open ? today : eMonth !== undefined ? Number(eYear) * 12 + eMonth + 1 : eYear === sYear ? start + 6 : Number(eYear) * 12;
      const to = Math.min(end, today);
      if (start >= today || to <= start || to - start > 50 * 12) continue;
      spans.push([start, to]);
    }
  }
  if (!spans.length) return undefined;
  spans.sort((a, b) => a[0] - b[0]);
  let months = 0;
  let [from, to] = spans[0]!;
  for (const [s, e] of spans.slice(1)) {
    if (s <= to) to = Math.max(to, e);
    else {
      months += to - from;
      [from, to] = [s, e];
    }
  }
  months += to - from;
  return months >= 12 ? { years: Math.round(months / 12), roles: spans.length } : undefined;
}

/**
 * A lookalike seed for an employer the directory doesn't have: industries from the role's own
 * lines (one mention is enough there), its role family and country from the role's heading.
 */
export function seedFromRole(role: ResumeRole): { name: string; key: string; tags: string[]; rows: IndexedCompany["rows"]; fromResume: true } {
  const heading = role.text.split("\n")[0]!;
  // One role's lines are short and name many things in passing: keep the three most mentioned.
  const tags = industriesFromText(role.text, 1).slice(0, 3);
  return { name: role.company, key: `resume:${companyWords(role.company).join("-")}`, tags, rows: [[heading, heading, "", null, 1]], fromResume: true };
}

// ---------- matching names to directory companies ----------

type Named = { key: string; name: string; status?: string; open_jobs?: number | null; ats?: string };

/**
 * Find each employer in the directory: same name first ("Tidewave" = "TideWave"), then a directory
 * name that starts the employer's name ("Contoso Financial" -> "Contoso"). Short or ambiguous names
 * don't prefix-match. Among several boards of one company, the live one with most jobs wins.
 */
export function matchEmployers<T extends Named>(names: readonly string[], directory: readonly T[]): { name: string; match?: T }[] {
  const byName = new Map<string, T[]>();
  for (const c of directory) {
    const k = companyWords(c.name).join(" ");
    if (k) byName.set(k, [...(byName.get(k) ?? []), c]);
  }
  const best = (list: T[] | undefined) => list?.slice().sort((a, b) => Number(b.status === "live") - Number(a.status === "live") || (b.open_jobs ?? 0) - (a.open_jobs ?? 0))[0];
  return names.map((name) => {
    const words = companyWords(name);
    let match = best(byName.get(words.join(" "))) ?? best(byName.get(words.join("")));
    for (let n = words.length - 1; !match && n >= 1; n--) {
      const prefix = words.slice(0, n).join(" ");
      if (prefix.replace(/\s/g, "").length >= 4) match = best(byName.get(prefix));
    }
    return match ? { name, match } : { name };
  });
}

// ---------- lookalikes ----------

let familyRes: { id: string; re: RegExp }[] | undefined;
const families = () => (familyRes ??= ROLE_FAMILIES.map((f) => ({ id: f.id, re: new RegExp(f.titles.map((t) => termRegex(t).source).join("|"), "iu") })));

/** What a company looks like: its industries, the role families it hires and the countries it hires in. */
export type CompanyShape = { industries: Set<string>; families: Map<string, number>; countries: Set<string> };

// Titles and locations repeat a lot across companies ("Remote", "London, UK"): look each up once.
const familyCache = new Map<string, string | null>();
const countryCache = new Map<string, string[]>();
function familyOf(title: string): string | null {
  let f = familyCache.get(title);
  if (f === undefined) familyCache.set(title, (f = families().find((x) => x.re.test(title))?.id ?? null));
  return f;
}
function countriesOf(location: string): string[] {
  let c = countryCache.get(location);
  if (!c) countryCache.set(location, (c = countriesIn(location)));
  return c;
}

export function shapeOf(c: { tags?: readonly string[]; title_tags?: readonly string[]; rows?: IndexedCompany["rows"] }): CompanyShape {
  const fam = new Map<string, number>();
  const countries = new Set<string>();
  // The newest 150 rows are plenty to see what a company hires and where.
  for (const [title, location, , , count] of (c.rows ?? []).slice(0, 150)) {
    const f = familyOf(title);
    if (f) fam.set(f, (fam.get(f) ?? 0) + count);
    for (const country of countriesOf(location)) countries.add(country);
  }
  return { industries: new Set([...(c.tags ?? []), ...(c.title_tags ?? [])]), families: fam, countries };
}

const jaccard = (a: Set<string>, b: Set<string>) => {
  if (!a.size || !b.size) return 0;
  let both = 0;
  for (const x of a) if (b.has(x)) both++;
  return both / (a.size + b.size - both);
};
const cosine = (a: Map<string, number>, b: Map<string, number>) => {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const [k, v] of a) {
    na += v * v;
    dot += v * (b.get(k) ?? 0);
  }
  for (const v of b.values()) nb += v * v;
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
};

/** How alike two companies are, 0–100: industries 50, role mix 30, hiring countries 20 (missing parts dropped, the rest rescaled). */
export function similarity(a: CompanyShape, b: CompanyShape): number {
  const parts: [number, number][] = [];
  if (a.industries.size && b.industries.size) parts.push([50 * jaccard(a.industries, b.industries), 50]);
  if (a.families.size && b.families.size) parts.push([30 * cosine(a.families, b.families), 30]);
  if (a.countries.size && b.countries.size) parts.push([20 * jaccard(a.countries, b.countries), 20]);
  if (!parts.length) return 0;
  return Math.round((parts.reduce((s, [p]) => s + p, 0) / parts.reduce((s, [, m]) => s + m, 0)) * 100);
}

export type Lookalike = CompanySuggestion & { similarity: number; like: string };

type Shapeable = { tags?: readonly string[]; title_tags?: readonly string[]; rows?: IndexedCompany["rows"] };

/**
 * Companies like a past employer that also fit the user: candidates come from suggestCompanies
 * (so they already pass the user's own relevance test), must share at least one industry with the
 * employer, and rank by 0.6 fit + 0.4 similarity. The first reason says why it's alike
 * ("Like Tidewave: Crypto exchange · hires Product Management"). `source` gives a candidate's tags
 * and rows; shapes are cached in `cache` across seeds.
 */
export function lookalikes(
  seed: Shapeable & { name: string; key: string; fromResume?: boolean },
  candidates: readonly CompanySuggestion[],
  source: (key: string) => Shapeable | undefined,
  cache: Map<string, CompanyShape>,
  opts: { limit?: number; minSimilarity?: number } = {},
): Lookalike[] {
  const s = shapeOf(seed);
  // A resume seed's "rows" are just the user's own role: every candidate already hires it, so role mix says nothing.
  if (seed.fromResume) s.families.clear();
  if (!s.industries.size) return [];
  const seedWords = companyWords(seed.name).join(" ");
  const out: Lookalike[] = [];
  for (const c of candidates) {
    if (c.key === seed.key || companyWords(c.name).join(" ") === seedWords) continue;
    const src = source(c.key);
    // Cheap test first: no shared industry, not a lookalike.
    if (!src || ![...(src.tags ?? []), ...(src.title_tags ?? [])].some((t) => s.industries.has(t))) continue;
    let shape = cache.get(c.key);
    if (!shape) cache.set(c.key, (shape = shapeOf(src)));
    const sim = similarity(s, shape);
    if (sim < (opts.minSimilarity ?? 30)) continue;
    const sharedInd = [...s.industries].filter((i) => shape.industries.has(i)).map((i) => INDUSTRY_BY_ID.get(i)?.label ?? i);
    const topFam = [...s.families.entries()]
      .sort((x, y) => y[1] - x[1])
      .map(([f]) => f)
      .find((f) => shape.families.has(f));
    const famLabel = topFam ? ROLE_FAMILIES.find((f) => f.id === topFam)?.label : undefined;
    const why = [sharedInd.slice(0, 2).join(", "), famLabel && `hires ${famLabel}`].filter(Boolean).join(" · ");
    out.push({ ...c, similarity: sim, like: seed.name, reasons: [`Like ${seed.name}: ${why}`, ...c.reasons] });
  }
  return out.sort((a, b) => 0.6 * b.score + 0.4 * b.similarity - (0.6 * a.score + 0.4 * a.similarity)).slice(0, opts.limit ?? 6);
}

import { industriesForLabel, industryEvidence } from "./catalog/industries";
import type { Country } from "./catalog/places";
import { termRegex } from "./text";

/** The structured block the master-resume prompt asks the AI to append. */
export type AiProfile = {
  target_titles: string[];
  seniority: string[];
  exclude_titles: string[];
  locations: string[];
  open_to_remote: boolean;
  remote_regions: string[];
  keywords: Record<string, number>;
  /** Industry ids (catalog/industries.ts) the person has worked in or wants to. */
  industries: string[];
  /** Companies the person has worked at, newest first (original spelling). */
  past_employers: string[];
};

export type ParsedAnswer = {
  /** The master resume as Markdown, without the profile block or chat filler. */
  resume: string;
  profile?: AiProfile;
  warnings: string[];
};

/** The profile block's key; answers made before the rename to RawJobs use jobhunter_profile. */
const PROFILE_KEYS = ["rawjobs_profile", "jobhunter_profile"];
const profileKeyIn = (text: string) => PROFILE_KEYS.find((k) => text.includes(k));

const strList = (v: unknown, max = 40): string[] =>
  Array.isArray(v)
    ? [
        ...new Set(
          v
            .filter((x): x is string => typeof x === "string")
            .map((s) => s.trim().toLowerCase().replace(/\s+/g, " "))
            .filter(Boolean),
        ),
      ].slice(0, max)
    : [];

function normalizeProfile(raw: unknown): AiProfile | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  const keywords: Record<string, number> = {};
  if (o.keywords && typeof o.keywords === "object" && !Array.isArray(o.keywords)) {
    for (const [k, w] of Object.entries(o.keywords as Record<string, unknown>)) {
      const term = k.trim().toLowerCase().replace(/\s+/g, " ");
      const n = typeof w === "number" ? w : Number(w);
      if (term && Number.isFinite(n)) keywords[term] = Math.min(5, Math.max(1, Math.round(n)));
    }
  } else if (Array.isArray(o.keywords)) {
    for (const k of strList(o.keywords)) keywords[k] = 3;
  }
  const profile: AiProfile = {
    target_titles: strList(o.target_titles),
    seniority: strList(o.seniority, 12),
    exclude_titles: strList(o.exclude_titles),
    locations: strList(o.locations),
    open_to_remote: o.open_to_remote === true || o.open_to_remote === "true",
    remote_regions: strList(o.remote_regions, 12),
    keywords,
    // Accept ids or labels ("Brokerage, CFD & FX"); drop anything not in the taxonomy.
    industries: [...new Set(strList(o.industries, 12).flatMap((x) => industriesForLabel(x)))],
    // Company names keep their casing ("Northwind", "TideWave").
    past_employers: Array.isArray(o.past_employers)
      ? [
          ...new Set(
            o.past_employers
              .filter((x): x is string => typeof x === "string")
              .map((s) => s.trim().replace(/\s+/g, " "))
              .filter(Boolean),
          ),
        ].slice(0, 15)
      : [],
  };
  const empty = !profile.target_titles.length && !profile.locations.length && !Object.keys(profile.keywords).length && !profile.seniority.length && !profile.industries.length;
  return empty ? undefined : profile;
}

/** Find the JSON object that holds the profile: a ```json fence first, then any balanced {...}. */
function findProfileJson(text: string): { start: number; end: number; value: unknown } | undefined {
  const fence = /```(?:json)?\s*\n([\s\S]*?)```/gi;
  for (let m; (m = fence.exec(text)); ) {
    if (!profileKeyIn(m[1]!)) continue;
    try {
      return { start: m.index, end: m.index + m[0].length, value: JSON.parse(m[1]!) };
    } catch {
      // fall through to the brace scan
    }
  }
  const key = profileKeyIn(text);
  if (!key) return undefined;
  const at = text.indexOf(key);
  const open = text.lastIndexOf("{", at);
  if (open < 0) return undefined;
  let depth = 0;
  let inStr = false;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (ch === "\\") i++;
      else if (ch === '"') inStr = false;
    } else if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) {
      try {
        return { start: open, end: i + 1, value: JSON.parse(text.slice(open, i + 1)) };
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

/**
 * Split what the user pasted back from Claude / ChatGPT into the master resume and the profile
 * block. Tolerates chat filler ("Here's your master resume:"), Markdown fences and a missing block.
 */
export function parseAiAnswer(text: string): ParsedAnswer {
  const warnings: string[] = [];
  let body = text.replace(/\r\n/g, "\n");
  let profile: AiProfile | undefined;

  const found = findProfileJson(body);
  if (found) {
    const v = found.value as Record<string, unknown>;
    const key = PROFILE_KEYS.find((k) => k in v);
    profile = normalizeProfile(key ? v[key] : v);
    if (!profile) warnings.push("The profile block was empty, so we'll suggest details from the resume text instead.");
    // Everything after the block is chat filler ("Let me know if…").
    body = body.slice(0, found.start);
  } else if (profileKeyIn(body)) {
    warnings.push("Couldn't read the profile block (the JSON looks broken). We'll suggest details from the resume text instead.");
  }

  // Unwrap a whole-answer ```markdown fence.
  const wrapped = body.match(/```(?:markdown|md)?\s*\n([\s\S]*?)```/i);
  if (wrapped && wrapped[1]!.trim().length > body.trim().length * 0.6) body = wrapped[1]!;

  // Drop chat filler before the first heading, if the resume has headings.
  const lines = body.split("\n");
  const firstHeading = lines.findIndex((l) => /^#{1,3}\s+\S/.test(l));
  if (firstHeading > 0 && lines.slice(0, firstHeading).join(" ").trim().length < 300) body = lines.slice(firstHeading).join("\n");

  const resume = body
    .replace(/\n?-{3,}\s*$/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (resume.length < 200) warnings.push("The resume looks very short. Check you pasted the whole answer.");
  return { resume, profile, warnings };
}

const globalCache = new Map<string, RegExp>();
function countMatches(text: string, term: string): number {
  let re = globalCache.get(term);
  if (!re) {
    re = new RegExp(termRegex(term).source, "giu");
    globalCache.set(term, re);
  }
  re.lastIndex = 0;
  return (text.match(re) ?? []).length;
}

// ---------- Resume body: what counts as evidence for industries ----------

// Headings are recognised by their words, not their format: PDF text has no markers, .docx bold arrives as **EXPERIENCE**.
const KEEP_SECTIONS = new Set([
  "summary",
  "professional summary",
  "executive summary",
  "career summary",
  "profile",
  "professional profile",
  "personal profile",
  "personal statement",
  "objective",
  "career objective",
  "about",
  "about me",
  "overview",
  "positioning",
  "experience",
  "work experience",
  "professional experience",
  "relevant experience",
  "employment",
  "employment history",
  "work history",
  "career history",
  "professional background",
  "career highlights",
  "highlights",
  "key achievements",
  "achievements",
  "accomplishments",
  "selected achievements",
  "education",
  "academic background",
  "qualifications",
  "skills",
  "technical skills",
  "core skills",
  "key skills",
  "top skills",
  "skills inventory",
  "core competencies",
  "competencies",
  "expertise",
  "areas of expertise",
  "tools",
  "technologies",
  "tech stack",
  "certifications",
  "certification",
  "certificates",
  "licenses",
  "licences",
  "courses",
  "training",
  "professional development",
  "projects",
  "selected projects",
  "key projects",
  "awards",
  "honors",
  "honours",
  "honors-awards",
  "publications",
  "volunteering",
  "volunteer work",
  "volunteer experience",
  "leadership",
  "memberships",
  "affiliations",
  "professional memberships",
]);
/** Sections that say nothing about the industries someone works in ("Interests: gaming", "Work authorization & mobility"). */
const SKIP_SECTIONS = new Set([
  "languages",
  "language",
  "language skills",
  "interests",
  "hobbies",
  "personal interests",
  "outside work",
  "references",
  "contact",
  "contact details",
  "contact information",
  "personal details",
  "personal information",
  "work authorization",
  "work authorisation",
  "visa",
  "visa status",
  "right to work",
  "relocation",
  "mobility",
  "global mobility",
  "availability",
  "notice period",
  "nationality",
]);

function headingKind(line: string): "skip" | "keep" | null {
  const t = line
    .trim()
    .replace(/^#{1,6}\s+/, "")
    .replace(/\s*:$/, "")
    .replace(/^(\*\*|__)(.*)\1$/, "$2")
    .replace(/\s*\([^)]*\)\s*$/, "")
    .replace(/\s*:$/, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  if (!t || t.length > 50) return null;
  const parts = t.split(/\s*(?:&|\+|,|\/|\||—|–|\band\b)\s*/).filter(Boolean);
  if (!parts.length || parts.length > 3) return null;
  if (parts.every((p) => SKIP_SECTIONS.has(p))) return "skip";
  if (parts.every((p) => SKIP_SECTIONS.has(p) || KEEP_SECTIONS.has(p))) return "keep";
  return null;
}

// One-line sections ("Interests: gaming, football"). Not visa / mobility / availability / contact: real bullets start with those ("Visa: launched card issuing").
const INLINE_SKIP =
  /^\s*(?:[-*•]\s*)?(?:\*\*|__)?(?:languages?(?:\s+(?:skills|spoken))?|(?:personal\s+)?interests|hobbies|references|nationality|visa\s+status|work\s+authori[sz]ation|right\s+to\s+work|notice\s+period|relocation|hobbies\s*(?:&|and)\s*interests)(?:\*\*|__)?\s*[:—–](?:\*\*|__)?\s*\S/i;
const DATE_RANGE = /\b(?:19|20)\d{2}\s*(?:[–—-]|to)\s*(?:(?:[a-z]{3,9}\.?\s+)?(?:19|20)\d{2}|present|current|now|today)\b/i;
/** A skipped section ends at the next heading, or sooner when it stops looking like one (PDF text loses headings). */
const SKIP_MAX_LINES = 6;
const SKIP_MAX_WORDS = 8;
const SKIP_FIRST_MAX_WORDS = 40;
const PLACEHOLDER =
  /\[(?:your\b[^\]\n]{0,30}|name|full name|company(?: name)?|employer|(?:job )?title|role|position|dates?|start date|end date|month|year|city|country|location|phone(?: number)?|email(?: address)?|school|university|degree|institution|x+%?|n|number|amount)\]/gi;
const EMPTY_LABEL = /^\s*(?:[-*•]\s*)?[A-Za-z][A-Za-z /&]{1,30}:\s*$/;
const COMMENTS = /<!--[\s\S]*?(?:-->|$)/g;

/**
 * The resume without what isn't evidence of an industry: comments, placeholders, contact details,
 * section headings, and sections like Languages, Interests or Work authorization. Lines that only
 * look like headings ("BINANCE", "### Binance — Senior PM") stay.
 */
export function resumeBody(text: string): string {
  const cleaned = text
    .replace(/\r\n?/g, "\n")
    .replace(COMMENTS, " ")
    .replace(/\[([^\]\n]{1,80})\]\((?:[^)\s]+)\)/g, "$1")
    .replace(PLACEHOLDER, " ")
    .replace(/\[[^\]\n]{1,40}\]|\{\{[^}\n]*\}\}/g, " ")
    .replace(/\blorem ipsum\b[^\n]*/gi, " ")
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, " ")
    .replace(/\b(?:https?:\/\/|www\.)\S+|\b[\w-]+(?:\.[\w-]+)*\.(?:com|io|org|net|me|dev|ai|co)\/\S*/gi, " ")
    // Phone numbers, not "2021 - 2024".
    .replace(/\+?\d[\d\s().-]{6,}\d/g, (m) => (m.replace(/\D/g, "").length >= 9 && !DATE_RANGE.test(m) ? " " : m));
  const lines = cleaned
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const out: string[] = [];
  let skipping = false;
  let skipped = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const kind = headingKind(line);
    if (kind || /^#{1,6}\s/.test(line)) {
      skipping = kind === "skip";
      skipped = 0;
      if (!kind) out.push(line.replace(/^#{1,6}\s+/, ""));
      continue;
    }
    if (skipping) {
      const words = line.split(/\s+/).length;
      // A date range just ahead is a role (company / title / location / dates): the section is over.
      const roleAhead = lines.slice(i, i + 4).some((l) => DATE_RANGE.test(l));
      // The first line may be one long sentence ("Open to relocation…"); later ones must be short.
      if (++skipped <= SKIP_MAX_LINES && words <= (skipped === 1 ? SKIP_FIRST_MAX_WORDS : SKIP_MAX_WORDS) && !roleAhead) continue;
      skipping = false;
    }
    if (INLINE_SKIP.test(line) || EMPTY_LABEL.test(line)) continue;
    out.push(line);
  }
  return out.join("\n");
}

const wordCount = (s: string) => (s.match(/[\p{L}\p{N}]+/gu) ?? []).length;

/** The placeholders of an unfilled resume template ("[Your Name]", "[Company]"), or null for a real resume. */
export function resumeTemplate(text: string): string[] | null {
  const seen = new Set<string>();
  const found = (text.replace(COMMENTS, " ").match(PLACEHOLDER) ?? []).map((p) => p.trim()).filter((p) => !seen.has(p.toLowerCase()) && seen.add(p.toLowerCase()));
  if (found.length >= 3) return found;
  const emptyLabels = text.split(/\r?\n/).filter((l) => EMPTY_LABEL.test(l)).length;
  // A short real resume has no placeholders, and "[link]" isn't one.
  if ((found.length >= 1 || emptyLabels >= 4) && wordCount(resumeBody(text)) < 80) return found.length ? found : ["empty fields"];
  return null;
}

export type Detected = {
  titles: string[];
  places: string[];
  keywords: [string, number][];
  /** Industry ids the resume mentions repeatedly, most mentioned first. */
  industries: string[];
  /** Why each industry was suggested: its most mentioned terms, with counts. */
  industryWhy?: Record<string, [string, number][]>;
  /** How often each suggested industry is mentioned, for deciding what to pre-select. */
  industryCounts?: Record<string, number>;
  /** Set when the resume is an unfilled template: its placeholders. Nothing else is detected then. */
  template?: string[];
};

/** Offline suggestions from plain resume text, using the catalogues (no AI). */
export function detectFromResume(
  text: string,
  catalogs: { titles: readonly string[]; countries: readonly Country[]; keywords: Readonly<Record<string, number>> },
  limits = { titles: 8, places: 8, keywords: 25 },
): Detected {
  if (text.trim().length < 40) return { titles: [], places: [], keywords: [], industries: [] };
  const template = resumeTemplate(text);
  if (template) return { titles: [], places: [], keywords: [], industries: [], template };

  const lower = text.toLowerCase();
  // Plain substring check first: cheap, and rules out almost every term.
  const mentioned = (term: string) => lower.includes(term.split(/[\s-]+/)[0]!);
  const titleHits = catalogs.titles
    .filter(mentioned)
    .map((t) => [t, countMatches(text, t)] as const)
    .filter(([, n]) => n > 0)
    // More mentions first; longer (more specific) titles win ties.
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .map(([t]) => t);
  const titles = titleHits.slice(0, limits.titles);

  // A country counts once, under its full name, whichever alias the resume uses ("UAE" -> "united arab emirates").
  const placeCounts = new Map<string, number>();
  for (const country of catalogs.countries) {
    const names = [country.name, ...country.aliases];
    if (names.every((n) => !lower.includes(n))) {
      if (country.cities.every((c) => !lower.includes(c))) continue;
    }
    const n = names.reduce((sum, t) => sum + countMatches(text, t), 0);
    if (n) placeCounts.set(country.name, n);
    for (const city of country.cities) {
      const m = countMatches(text, city);
      if (m) placeCounts.set(city, (placeCounts.get(city) ?? 0) + m);
    }
  }
  const places = [...placeCounts]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([p]) => p)
    .slice(0, limits.places);

  const keywords = Object.entries(catalogs.keywords)
    .filter(([k]) => mentioned(k) && countMatches(text, k) > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limits.keywords);

  const evidence = industryEvidence(resumeBody(text)).slice(0, 5);
  return {
    titles,
    places,
    keywords,
    industries: evidence.map((e) => e.id),
    industryWhy: Object.fromEntries(evidence.map((e) => [e.id, e.terms])),
    industryCounts: Object.fromEntries(evidence.map((e) => [e.id, e.count])),
  };
}

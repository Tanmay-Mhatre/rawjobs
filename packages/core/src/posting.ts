import { countriesIn, placeOwner } from "./catalog/places";
import type { Salary } from "./schema";

/**
 * What a posting says about pay and who can take it, read from its text with plain rules. No AI.
 * Every reader is conservative: when the wording isn't clear it says nothing ("unknown"), because
 * a wrong "no sponsorship" or a wrong salary would push a good job down (see dealbreakers.ts).
 */

export type Period = "year" | "month" | "week" | "day" | "hour";
/** Pay as posted: the currency is always known, the period only when the posting (or ATS) says it. */
export type Pay = { currency: string; min?: number; max?: number; period?: Period };

/** ISO codes we read after or before an amount ("AED 25,000", "65k EUR"). */
const CODES = [
  "USD",
  "EUR",
  "GBP",
  "AED",
  "SAR",
  "QAR",
  "KWD",
  "BHD",
  "OMR",
  "SGD",
  "INR",
  "CAD",
  "AUD",
  "NZD",
  "CHF",
  "SEK",
  "NOK",
  "DKK",
  "PLN",
  "CZK",
  "HUF",
  "RON",
  "JPY",
  "HKD",
  "CNY",
  "ZAR",
  "BRL",
  "MXN",
  "ILS",
  "TRY",
  "MYR",
  "PHP",
  "IDR",
  "THB",
  "KRW",
  "EGP",
  "NGN",
  "KES",
  "PKR",
];
/** Symbols, longest first. A bare "$" is read as US dollars; "S$", "A$"… say otherwise. */
const SYMBOLS: [string, string][] = [
  ["US$", "USD"],
  ["SG$", "SGD"],
  ["S$", "SGD"],
  ["AU$", "AUD"],
  ["A$", "AUD"],
  ["CA$", "CAD"],
  ["C$", "CAD"],
  ["HK$", "HKD"],
  ["NZ$", "NZD"],
  ["$", "USD"],
  ["£", "GBP"],
  ["€", "EUR"],
  ["₹", "INR"],
];
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const CUR = `(?:${SYMBOLS.map(([s]) => esc(s)).join("|")}|\\b(?:${CODES.join("|")})\\b)`;
/** 25,000 / 25.000 / 25 000 / 25000 / 6.5, then an optional k. */
const NUM = `(\\d{1,3}(?:[,.\\u00a0\\u202f ]\\d{3})+(?!\\d)|\\d+(?:\\.\\d+)?)\\s?([kK])?(?![\\p{L}\\d])`;
const DASH = `\\s?(?:-|–|—|to|and)\\s?`;
const PAY_RE = new RegExp(`(${CUR})\\s?${NUM}(?:${DASH}(?:${CUR})?\\s?${NUM})?|${NUM}(?:${DASH}${NUM})?\\s?(${CUR})`, "gu");

/** A line that talks about pay... */
const PAY_WORDS = /\b(?:salary|salaries|base|compensation|pay|paid|package|remuneration|wage|wages|range|gross|per (?:annum|year|month|hour)|a (?:year|month)|p\.?a\.?|annual|monthly)\b/i;
/** ...and amounts that aren't the base pay: a budget, a bonus, funding, deal sizes. Checked just before the amount. */
const NOT_PAY = /\b(?:budget|stipend|allowance|bonus|equity|ote|on[- ]target|commission|signing|referral|raised|funding|revenue|arr|acv|deal|valuation|series|investment|grant)s?\b[^.]{0,25}$/i;

const PERIODS: [Period, RegExp][] = [
  ["hour", /\b(?:per hour|an hour|hourly)\b|\/\s?(?:hr|hour)\b/i],
  ["day", /\b(?:per day|daily)\b|\/\s?day\b/i],
  ["week", /\b(?:per week|weekly)\b|\/\s?(?:wk|week)\b/i],
  ["month", /\b(?:per month|a month|monthly|pcm)\b|\/\s?(?:mo|month)\b/i],
  ["year", /\b(?:per (?:annum|year)|a year|annual(?:ly)?|yearly|p\.\s?a\.?|pa)\b|\/\s?(?:yr|year|annum)\b/i],
];

/** "YEAR", "yearly", "per month", "Hourly" -> a period; undefined when it isn't one. */
export function normalizePeriod(s: string | undefined): Period | undefined {
  if (!s) return undefined;
  const t = s.toLowerCase();
  if (/hour/.test(t)) return "hour";
  if (/day|daily/.test(t)) return "day";
  if (/week/.test(t)) return "week";
  if (/month/.test(t)) return "month";
  if (/year|annum|annual/.test(t)) return "year";
  return undefined;
}

const toCurrency = (s: string) => SYMBOLS.find(([sym]) => sym === s)?.[1] ?? s.toUpperCase();

function amount(num: string | undefined, k: string | undefined): number | undefined {
  if (!num) return undefined;
  // "25,000", "25.000", "25 000" are thousands; "6.5" (with k) is a decimal.
  const grouped = /^\d{1,3}(?:[,.   ]\d{3})+$/.test(num);
  const n = grouped ? Number(num.replace(/[^\d]/g, "")) : Number(num);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return k ? n * 1000 : n;
}

/** The period named next to an amount: just after it first ("AED 25,000 per month"), then just before ("monthly salary of"). */
function periodNear(line: string, start: number, end: number): Period | undefined {
  const after = line.slice(end, end + 40);
  const before = line.slice(Math.max(0, start - 30), start);
  for (const text of [after, before]) {
    let best: { p: Period; at: number } | undefined;
    for (const [p, re] of PERIODS) {
      const m = re.exec(text);
      if (m && (!best || m.index < best.at)) best = { p, at: m.index };
    }
    if (best) return best.p;
  }
  return undefined;
}

/**
 * Base pay from a posting's text: "Compensation: base AED 28,000 - 32,000 per month", "€65k–€78k",
 * "SGD 5-6k/month", "85.000 € brutto". Only on a line that talks about pay, never an amount just after
 * "budget", "bonus", "raised" or "ACV". The first such amount wins. Undefined when there's none.
 */
export function extractPay(text: string | undefined): Pay | undefined {
  if (!text) return undefined;
  for (const line of text.split(/\n/)) {
    if (!/\d/.test(line)) continue;
    for (const m of line.matchAll(PAY_RE)) {
      const at = m.index ?? 0;
      if (NOT_PAY.test(line.slice(Math.max(0, at - 40), at))) continue;
      const period = periodNear(line, at, at + m[0].length);
      if (!period && !PAY_WORDS.test(line)) continue;
      const [, cur1, a1, k1, b1, kb1, a2, k2, b2, kb2, cur2] = m;
      const cur = cur1 ?? cur2;
      const [na, ka, nb, kb] = cur1 ? [a1, k1, b1, kb1] : [a2, k2, b2, kb2];
      let lo = amount(na, ka);
      const hi = amount(nb, kb);
      if (lo === undefined || !cur) continue;
      // "65-78k": the k on the top of a range counts for the bottom too.
      if (hi !== undefined && kb && !ka && lo < 1000) lo *= 1000;
      if (hi !== undefined && (hi < lo || hi > lo * 5)) continue;
      // A bare small number with no k and no period is rarely pay ("$5 for every referral").
      if (lo < 100 && !period) continue;
      return { currency: toCurrency(cur), min: lo, ...(hi !== undefined ? { max: hi } : {}), ...(period ? { period } : {}) };
    }
  }
  return undefined;
}

/** A job's pay: the hiring system's own field when it names a currency and an amount, else read from the description. */
export function payOf(job: { salary?: Salary; description?: string }): Pay | undefined {
  const s = job.salary;
  if (s?.currency && (s.min || s.max)) {
    const period = normalizePeriod(s.period);
    return { currency: toCurrency(s.currency.trim()), ...(s.min ? { min: s.min } : {}), ...(s.max ? { max: s.max } : {}), ...(period ? { period } : {}) };
  }
  return extractPay(job.description);
}

// ---------- who can take the job ----------

export type Eligibility = {
  /** "no": the posting won't sponsor a visa; "yes": it says it will; "unknown": it doesn't say (or only "may"). */
  sponsorship: "no" | "yes" | "unknown";
  /** The country the posting asks you to be authorised to work in ("authorised to work in the United States"). */
  authorisedIn?: string;
  /** The country you must already live in ("US residents only", "must already live in the Netherlands"). */
  residentIn?: string;
  /** The place the posting says the work is on site in ("based in our Amsterdam office five days a week"). */
  onsiteIn?: string;
  /** "no" when relocation is ruled out, "yes" when it's offered. */
  relocation: "no" | "yes" | "unknown";
};

const NO_SPONSOR = [
  /\b(?:unable|not able|cannot|can ?not|can't|won't|will not|do not|don't|does not|doesn't|is not able|are not able)\s+(?:to\s+)?(?:[\w-]+\s+){0,4}?(?:visa\s+)?sponsor/i,
  /\bno\s+(?:visa\s+)?sponsorship\b/i,
  /\b(?:visa\s+)?sponsorship\s+(?:is\s+)?not\s+(?:available|offered|provided|possible)\b/i,
  /\bwithout\s+(?:the\s+need\s+for\s+)?(?:current\s+or\s+future\s+|any\s+|future\s+)?(?:visa\s+)?sponsorship\b/i,
];
const YES_SPONSOR = [/\b(?:visa\s+)?sponsorship\s+(?:is\s+)?(?:available|offered|provided)\b/i, /\bwe\s+(?:can\s+|will\s+|do\s+)?sponsor\b/i, /\b(?:offer|provide)s?\s+visa\s+sponsorship\b/i];
const NO_RELOCATION = [
  /\b(?:no|unable to offer|not able to offer|cannot offer|can't offer|do not offer|don't offer|does not offer|not offering)\s+(?:[\w-]+\s+){0,2}?relocation\b/i,
  /\brelocation\s+(?:support\s+|assistance\s+)?(?:is\s+)?not\s+(?:available|offered|provided|possible)\b/i,
];
const YES_RELOCATION = [/\brelocation\s+(?:support|assistance|package|help)\s+(?:is\s+)?(?:available|offered|provided)\b/i, /\b(?:support|offer|provide)s?\s+relocation\b/i];

/**
 * The place a phrase starts with: "the Netherlands and have the right…" -> Netherlands, "Amsterdam
 * office" -> Amsterdam. Countries, their cities and aliases only (regions like "the EU" are too loose
 * to act on). Undefined when it doesn't start with one: "commuting distance of London" is not London.
 */
export function leadingPlace(phrase: string): { place: string; country: string } | undefined {
  const words = phrase
    .replace(/^\s*the\s+/i, "")
    .split(/[^\p{L}.'-]+/u)
    .filter(Boolean)
    .slice(0, 4);
  for (let n = words.length; n >= 1; n--) {
    const place = words.slice(0, n).join(" ").replace(/\.$/, "");
    const norm = place.replace(/\./g, "").toLowerCase();
    const owner = placeOwner(norm === "u s" ? "us" : norm);
    if (owner?.startsWith("country:")) return { place, country: owner.slice(8) };
  }
  return undefined;
}

/** The same, for the words just before a marker: "for US residents only" -> US. */
function trailingPlace(phrase: string): { place: string; country: string } | undefined {
  const words = phrase
    .split(/[^\p{L}.'-]+/u)
    .filter(Boolean)
    .slice(-3);
  for (let n = words.length; n >= 1; n--) {
    const hit = leadingPlace(words.slice(-n).join(" "));
    if (hit && hit.place.split(" ").length === n) return hit;
  }
  return undefined;
}

const AUTHORISED = /\b(?:authori[sz]ed|authori[sz]ation|eligible|entitled|right|permitted|legally able)\s+to\s+work\s+in\s+([^.;\n]{2,60})/i;
const RESIDENT_AFTER = [
  /\b(?:open|available|limited|restricted)\s+(?:only\s+)?to\s+(?:candidates|applicants|people|residents|those)\s+(?:who\s+(?:already\s+)?(?:live|reside|are\s+based)|living|residing|based|located)\s+in\s+([^.;\n]{2,60})/i,
  /\bmust\s+(?:already\s+|currently\s+)?(?:live|reside|be\s+(?:living|residing|a\s+resident))\s+in\s+([^.;\n]{2,60})/i,
  /\bmust\s+(?:already|currently)\s+be\s+(?:based|located)\s+in\s+([^.;\n]{2,60})/i,
  /\bresidents\s+of\s+([^.;\n]{2,40}?)\s+only\b/i,
];
const RESIDENT_BEFORE = /([^.;\n]{2,40}?)\s+residents\s+only\b/i;
const ONSITE = [
  /\b(?:on-?site|in[- ]office|office[- ]based)\s+(?:in|at|from)\s+(?:our\s+)?([^.;\n]{2,40})/i,
  /\bbased\s+in\s+our\s+([^.;\n]{2,30}?)\s+office\s+(?:five|5|full[- ]time|every)\b/i,
  /\b(?:in|from)\s+our\s+([^.;\n]{2,30}?)\s+office,?\s+(?:five|5)\s+days\b/i,
];

/** Sponsorship, residence, on-site place and relocation, from a posting's text (and its location, for the country). */
export function extractEligibility(text: string | undefined): Eligibility {
  const t = text ?? "";
  const no = NO_SPONSOR.some((re) => re.test(t));
  const yes = YES_SPONSOR.some((re) => re.test(t));
  const out: Eligibility = {
    sponsorship: no ? "no" : yes ? "yes" : "unknown",
    relocation: NO_RELOCATION.some((re) => re.test(t)) ? "no" : YES_RELOCATION.some((re) => re.test(t)) ? "yes" : "unknown",
  };
  const auth = AUTHORISED.exec(t);
  const authPlace = auth && leadingPlace(auth[1]!);
  if (authPlace) out.authorisedIn = authPlace.country;
  for (const re of RESIDENT_AFTER) {
    const m = re.exec(t);
    const hit = m && leadingPlace(m[1]!);
    if (hit) {
      out.residentIn = hit.country;
      break;
    }
  }
  if (!out.residentIn) {
    const m = RESIDENT_BEFORE.exec(t);
    const hit = m && trailingPlace(m[1]!);
    if (hit) out.residentIn = hit.country;
  }
  for (const re of ONSITE) {
    const m = re.exec(t);
    const hit = m && leadingPlace(m[1]!);
    if (hit) {
      out.onsiteIn = hit.place;
      break;
    }
  }
  return out;
}

/** The one country a job's location names ("Remote (US)" -> united states), or undefined for none or several. */
export function countryOfLocation(location: string): string | undefined {
  const found = countriesIn(location);
  return found.length === 1 ? found[0]!.toLowerCase() : undefined;
}

const REGION_ONLY =
  /\b(EU|EEA|UK|US|USA|EMEA|APAC|LATAM|Europe|North America|Canada|India|Germany|Spain|France|Netherlands|Poland|Portugal|Ireland|Australia|Brazil|Mexico)(?:[\s-]+(?:based|residents?))?[\s-]+only\b/i;

const ACRONYMS = new Set(["EU", "EEA", "UK", "US", "EMEA", "APAC", "LATAM"]);

/** "Product Owner (EU only)", "Remote - US only": the one region a title or location limits the job to. */
export function regionOnly(text: string | undefined): string | undefined {
  const m = text ? REGION_ONLY.exec(text) : null;
  if (!m) return undefined;
  const upper = m[1]!.toUpperCase();
  if (upper === "USA") return "US";
  if (ACRONYMS.has(upper)) return upper;
  return m[1]!.replace(/\b\p{L}/gu, (c) => c.toUpperCase());
}

// ---------- roles only a country's nationals can take ----------

/** Gulf countries with nationalisation quotas (Emiratisation, Saudization…): how postings name their people, and the program. */
const NATIONALS: { country: string; label: string; people: string; demonym: string; program: string }[] = [
  { country: "united arab emirates", label: "UAE", people: "uae|emiratis?", demonym: "emiratis?", program: "emirati[sz]ation" },
  { country: "saudi arabia", label: "Saudi", people: "saudis?|ksa", demonym: "saudis?", program: "saudi[sz]ation|saudi[sz]ed" },
  { country: "qatar", label: "Qatari", people: "qataris?", demonym: "qataris?", program: "qatari[sz]ation" },
  { country: "oman", label: "Omani", people: "omanis?", demonym: "omanis?", program: "omani[sz]ation" },
  { country: "kuwait", label: "Kuwaiti", people: "kuwaitis?", demonym: "kuwaitis?", program: "kuwaiti[sz]ation" },
  { country: "bahrain", label: "Bahraini", people: "bahrainis?", demonym: "bahrainis?", program: "bahraini[sz]ation" },
];
const WHO = "(?:nationals?|citizens?)";
const NATIONALS_RES = NATIONALS.map((n) => ({
  ...n,
  // Said outright in the text: "UAE nationals only", "reserved for Emirati nationals", "an Emiratisation role".
  text: new RegExp(
    [
      `\\b(?:${n.people})\\s+${WHO}\\s+only\\b`,
      `\\bonly\\s+(?:open\\s+to\\s+|for\\s+|accept(?:ing)?\\s+)?(?:${n.people})\\s+${WHO}\\b`,
      // Never plain "open to UAE nationals": "…and expats" often follows.
      `\\b(?:exclusively\\s+(?:for|to|open\\s+to)|restricted\\s+to|reserved\\s+for|limited\\s+to)\\s+(?:${n.people})\\s+${WHO}\\b`,
      // "Emiratis only", never "UAE only" (that's where you live, not who you are).
      `\\b(?:${n.demonym})\\s+only\\b`,
      `\\b(?:${n.program})\\s+(?:role|position|vacancy|opportunity|program(?:me)?|hire|hiring|job|initiative)\\b`,
    ].join("|"),
    "i",
  ),
  // In a title the country's people alone say it: "Relationship Manager - UAE National".
  title: new RegExp(`\\b(?:${n.people})\\s+${WHO}\\b|\\b(?:${n.program})\\b`, "i"),
}));

/** The country whose nationals alone can take this job, from its title or description ("united arab emirates"), if it says so. */
export function nationalsOnly(title: string, description?: string): string | undefined {
  return NATIONALS_RES.find((n) => n.title.test(title) || (!!description && n.text.test(description)))?.country;
}

/** "UAE", "Saudi": how a nationals-only limit is written for a country nationalsOnly returns. */
export const nationalsLabel = (country: string) => NATIONALS.find((n) => n.country === country)?.label ?? country.replace(/\b\p{L}/gu, (c) => c.toUpperCase());

// ---------- what the job requires ----------

/** What a posting asks for: its must-have lines, its nice-to-have lines and the years of experience it wants. */
export type Requirements = {
  must: string[];
  nice: string[];
  /** The highest minimum years a must line asks for ("5+ years of…" -> 5), with that line. */
  years?: { min: number; line: string };
  /** The text without its nice-to-have parts: a topic only in `nice` is a nice-to-have. */
  rest: string;
  /** A must or nice heading was found: the lines come from sections, not only cue words. */
  structured: boolean;
};

const MUST_HEADING =
  /^(?:(?:minimum|basic|required|key|essential|core)\s+)?(?:requirements?|qualifications?|skills(?: and experience)?|experience)$|^what (?:you(?:'ll| will)? need|we(?:'re| are) looking for|you(?:'ll| will)? bring|you bring|we need|we expect)(?: from you)?$|^(?:you have|you bring|you are|you'll have|you will have|who you are|about you|your profile|your background|your experience|your skills|must[- ]haves?|essentials?|ideal candidate|the ideal candidate|requirements and qualifications|is this you)$/;
const NICE_HEADING =
  /^(?:nice[- ]to[- ]haves?|(?:it's |it is )?nice if you have|bonus(?: points)?(?: if you have)?|preferred(?: qualifications| skills| experience)?|desirable(?: skills)?|extra credit|pluses|plus points|good to have|even better if(?: you have)?|ideally(?: you have)?)$/;
/** Headings of the other parts of a posting: they end a must or nice section. */
const OTHER_HEADING =
  /^(?:what you(?:'ll| will)? (?:do|work on|own|be doing)|(?:key |your |main |core )?(?:responsibilities|duties|tasks)|in this role(?: you will)?|you will|your (?:mission|role|day|impact|tasks)|the (?:role|opportunity|team|job|position)|about (?:the |this |our )?(?:role|team|company|us|job|position|[a-z]+)|(?:what )?we offer|what's in it for you|benefits(?: and perks)?|perks(?: and benefits)?|why (?:join|work)\b.*|compensation(?: and benefits)?|salary|pay|location(?: and eligibility)?|how to apply|our (?:values|culture|stack|team|process)|hiring process|interview process|equal opportunity.*|diversity.*|who we are|life at .*)$/;
/** Lines that read as a nice-to-have wherever they are. */
const NICE_CUE = /\b(?:is|are|would be|as) (?:a )?(?:plus|bonus|advantage)\b|\bnice[- ]to[- ]have\b|\bpreferred\b|\bideally\b|\bdesirable\b|\bbonus\b|\bnot required\b|\bgood to have\b/i;
/** Lines that read as a must-have outside a section. */
const MUST_CUE = /\b(?:must|required|requirement|minimum|essential|at least|you have|you bring|you'll need|you will need)\b/i;

/** A short line that isn't a sentence: a heading, read without its bullet, colon or trailing words. */
function headingOf(line: string): string | undefined {
  const t = line.replace(/^[\s#*•\-–]+|[\s*:]+$/g, "").trim();
  if (!t || t.length > 60 || /[.!?;]$/.test(t) || t.split(/\s+/).length > 9) return undefined;
  return t.toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, " ").replace(/\?$/, "");
}

const WORD_NUM: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, fifteen: 15 };
/**
 * "5+ years", "3-5 years", "at least 5 years", "minimum of five years", "10 yrs": the number before "years".
 * The years must be of experience: followed by "of", "in", "experience" or "working", or on a line that says experience.
 */
const YEARS_RE = new RegExp(
  `\\b(\\d{1,2}|${Object.keys(WORD_NUM).join("|")})\\s*(?:\\+|plus)?\\s*(?:(?:-|–|to)\\s*\\d{1,2}\\s*\\+?\\s*)?(?:years?|yrs?)\\b(?:\\s*\\+)?(\\s*(?:'|’)?\\s*(?:of|in|experience|working|hands-on|professional|relevant|post|building|leading|as|with)\\b)?`,
  "gi",
);
const NOT_EXPERIENCE = /\b(?:ago|old|founded|contract|warranty|history|anniversary|track record of \d+ years? of growth)\b/i;

function yearsIn(line: string): number | undefined {
  let best: number | undefined;
  for (const m of line.matchAll(YEARS_RE)) {
    const n = /^\d/.test(m[1]!) ? Number(m[1]) : WORD_NUM[m[1]!.toLowerCase()];
    const after = line.slice((m.index ?? 0) + m[0].length - (m[2]?.length ?? 0), (m.index ?? 0) + m[0].length + 30);
    const experience = !!m[2] || /\bexperience\b/i.test(line);
    if (!n || n > 25 || !experience || NOT_EXPERIENCE.test(after) || NOT_EXPERIENCE.test(line.slice(0, m.index ?? 0).slice(-20))) continue;
    if (best === undefined || n > best) best = n;
  }
  return best;
}

/**
 * The must-have and nice-to-have lines of a posting, and the years it asks for. Sections first ("Requirements",
 * "What you'll need", "Nice to have", "Preferred"); any other heading ("What you'll do", "Benefits") ends one.
 * A line with a nice cue ("SQL is a plus") is nice even inside a must section; outside sections, lines
 * with a must or nice cue are sorted by it. Years come from must lines only, the highest minimum.
 */
export function extractRequirements(text: string | undefined): Requirements {
  const out: Requirements = { must: [], nice: [], rest: "", structured: false };
  if (!text) return out;
  const rest: string[] = [];
  let section: "must" | "nice" | "other" | undefined;
  for (const raw of text.split(/\n/)) {
    const line = raw.replace(/^[\s•*\-–]+/, "").trim();
    if (!line) continue;
    const h = headingOf(raw);
    if (h !== undefined && (MUST_HEADING.test(h) || NICE_HEADING.test(h))) {
      section = MUST_HEADING.test(h) ? "must" : "nice";
      out.structured = true;
      continue;
    }
    // Any other heading ends the section: a known one ("What you'll do", "Benefits"), or a short line ending in a colon.
    if (h !== undefined && (OTHER_HEADING.test(h) || /:\s*$/.test(raw))) {
      section = "other";
      continue;
    }
    if (section === "nice") {
      out.nice.push(line);
      continue;
    }
    // A paragraph is read a sentence at a time. In each, the first clause decides: "4+ years in data science,
    // ideally in lending" is a must, and its later clause with a nice cue is a nice on its own.
    for (const sentence of line.split(/(?<=[.!?])\s+(?=[A-Z])/)) {
      const [first = sentence, ...clauses] = sentence.split(/\s*;\s*|,\s+(?=(?:and\s+)?(?:ideally|preferably|bonus|nice)\b)/i);
      if (NICE_CUE.test(first)) {
        out.nice.push(sentence);
        continue;
      }
      const extra = clauses.filter((c) => NICE_CUE.test(c));
      const kept = extra.length ? [first, ...clauses.filter((c) => !extra.includes(c))].join("; ") : sentence;
      rest.push(kept);
      if (extra.length) out.nice.push(extra.join("; "));
      if (section === "must" || MUST_CUE.test(kept)) out.must.push(kept);
    }
  }
  out.rest = rest.join("\n");
  for (const line of out.must) {
    const n = yearsIn(line);
    if (n !== undefined && (!out.years || n > out.years.min)) out.years = { min: n, line };
  }
  return out;
}

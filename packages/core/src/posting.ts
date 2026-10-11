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
  "USD", "EUR", "GBP", "AED", "SAR", "QAR", "KWD", "BHD", "OMR", "SGD", "INR", "CAD", "AUD", "NZD", "CHF", "SEK", "NOK", "DKK", "PLN", "CZK",
  "HUF", "RON", "JPY", "HKD", "CNY", "ZAR", "BRL", "MXN", "ILS", "TRY", "MYR", "PHP", "IDR", "THB", "KRW", "EGP", "NGN", "KES", "PKR",
];
/** Symbols, longest first. A bare "$" is read as US dollars; "S$", "A$"… say otherwise. */
const SYMBOLS: [string, string][] = [
  ["US$", "USD"], ["SG$", "SGD"], ["S$", "SGD"], ["AU$", "AUD"], ["A$", "AUD"], ["CA$", "CAD"], ["C$", "CAD"], ["HK$", "HKD"], ["NZ$", "NZD"],
  ["$", "USD"], ["£", "GBP"], ["€", "EUR"], ["₹", "INR"],
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
      let hi = amount(nb, kb);
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
const YES_SPONSOR = [
  /\b(?:visa\s+)?sponsorship\s+(?:is\s+)?(?:available|offered|provided)\b/i,
  /\bwe\s+(?:can\s+|will\s+|do\s+)?sponsor\b/i,
  /\b(?:offer|provide)s?\s+visa\s+sponsorship\b/i,
];
const NO_RELOCATION = [
  /\b(?:no|unable to offer|not able to offer|cannot offer|can't offer|do not offer|don't offer|does not offer|not offering)\s+(?:[\w-]+\s+){0,2}?relocation\b/i,
  /\brelocation\s+(?:support\s+|assistance\s+)?(?:is\s+)?not\s+(?:available|offered|provided|possible)\b/i,
];
const YES_RELOCATION = [
  /\brelocation\s+(?:support|assistance|package|help)\s+(?:is\s+)?(?:available|offered|provided)\b/i,
  /\b(?:support|offer|provide)s?\s+relocation\b/i,
];

/**
 * The place a phrase starts with: "the Netherlands and have the right…" -> Netherlands, "Amsterdam
 * office" -> Amsterdam. Countries, their cities and aliases only (regions like "the EU" are too loose
 * to act on). Undefined when it doesn't start with one: "commuting distance of London" is not London.
 */
export function leadingPlace(phrase: string): { place: string; country: string } | undefined {
  const words = phrase.replace(/^\s*the\s+/i, "").split(/[^\p{L}.'-]+/u).filter(Boolean).slice(0, 4);
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
  const words = phrase.split(/[^\p{L}.'-]+/u).filter(Boolean).slice(-3);
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
  const out: Eligibility = { sponsorship: no ? "no" : yes ? "yes" : "unknown", relocation: NO_RELOCATION.some((re) => re.test(t)) ? "no" : YES_RELOCATION.some((re) => re.test(t)) ? "yes" : "unknown" };
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

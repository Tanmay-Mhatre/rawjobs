import { decodeEntities, htmlToText } from "../text";
import { HttpError, type HttpClient } from "../http";
import type { AtsType } from "../schema";
import { detectKnownAts } from "./detect-known";
import type { DetectedCompany } from "./types";

/** detect() for connectors whose URL shapes live in detect-known.ts. */
export function detectAs(ats: AtsType): (url: URL) => DetectedCompany | null {
  return (url) => {
    const found = detectKnownAts(url);
    return found?.ats === ats ? found : null;
  };
}

let regionNames: Intl.DisplayNames | undefined;
/** "ae" -> "United Arab Emirates", using the runtime's built-in country names. */
export function countryName(code?: string | null): string | undefined {
  if (!code) return undefined;
  if (!/^[a-z]{2}$/i.test(code)) return code;
  try {
    regionNames ??= new Intl.DisplayNames(["en"], { type: "region" });
    return regionNames.of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}

/** Distinct non-empty parts joined with ", ". */
/** ISO 3166 alpha-3 -> alpha-2, for the countries job boards list most. */
const ISO3: Record<string, string> = {
  USA: "US",
  CAN: "CA",
  MEX: "MX",
  PRI: "PR",
  BRA: "BR",
  ARG: "AR",
  COL: "CO",
  CHL: "CL",
  PER: "PE",
  GBR: "GB",
  IRL: "IE",
  DEU: "DE",
  FRA: "FR",
  ESP: "ES",
  PRT: "PT",
  ITA: "IT",
  NLD: "NL",
  BEL: "BE",
  CHE: "CH",
  AUT: "AT",
  SWE: "SE",
  NOR: "NO",
  DNK: "DK",
  FIN: "FI",
  POL: "PL",
  CZE: "CZ",
  ROU: "RO",
  HUN: "HU",
  GRC: "GR",
  UKR: "UA",
  TUR: "TR",
  ISR: "IL",
  ARE: "AE",
  SAU: "SA",
  EGY: "EG",
  ZAF: "ZA",
  NGA: "NG",
  KEN: "KE",
  IND: "IN",
  PAK: "PK",
  SGP: "SG",
  MYS: "MY",
  IDN: "ID",
  PHL: "PH",
  THA: "TH",
  VNM: "VN",
  CHN: "CN",
  HKG: "HK",
  TWN: "TW",
  JPN: "JP",
  KOR: "KR",
  AUS: "AU",
  NZL: "NZ",
};

/** "GBR" -> "United Kingdom"; codes it doesn't know come back as given. */
export function iso3Country(code?: string | null): string | undefined {
  if (!code) return undefined;
  return countryName(ISO3[code.toUpperCase()] ?? code);
}

export function joinParts(...parts: (string | null | undefined)[]): string {
  const out: string[] = [];
  for (const p of parts) {
    const t = p?.trim();
    if (t && !out.some((o) => o.toLowerCase() === t.toLowerCase())) out.push(t);
  }
  return out.join(", ");
}

/**
 * The JSON value (object or array) that starts right after `marker` in a page, e.g. the job list a
 * careers page assigns to a script variable. Scans brackets with strings in mind; no eval.
 */
export function jsonAfter<T = unknown>(text: string, marker: string): T | undefined {
  const at = text.indexOf(marker);
  if (at < 0) return undefined;
  const start = text.slice(at + marker.length).search(/[[{]/);
  if (start < 0) return undefined;
  const from = at + marker.length + start;
  let depth = 0;
  let inString = false;
  for (let i = from; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "[" || ch === "{") depth++;
    else if (ch === "]" || ch === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(from, i + 1)) as T;
        } catch {
          return undefined;
        }
      }
    }
  }
  return undefined;
}

type LdPlace = { address?: { addressLocality?: string; addressRegion?: string; addressCountry?: string | { name?: string } } | string };
/** The schema.org JobPosting most job pages embed for search engines (the parts we use). */
export type LdJobPosting = {
  title?: string;
  description?: string;
  datePosted?: string;
  jobLocation?: LdPlace | LdPlace[];
  jobLocationType?: string;
  employmentType?: string | string[];
};

/** The page's JSON-LD JobPosting, if it has one. */
export function jobPostingLd(html: string): LdJobPosting | undefined {
  for (const m of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const data = JSON.parse(m[1]!.trim()) as unknown;
      const items = (Array.isArray(data) ? data : [data, ...((data as { "@graph"?: unknown[] })["@graph"] ?? [])]) as { "@type"?: string }[];
      const found = items.find((i) => i?.["@type"] === "JobPosting");
      if (found) return found as LdJobPosting;
    } catch {
      // not JSON; try the next block
    }
  }
  return undefined;
}

/** "City, Region, Country; …" from a JobPosting's jobLocation. */
export function ldLocation(p: LdJobPosting | undefined): string {
  const places = p?.jobLocation ? (Array.isArray(p.jobLocation) ? p.jobLocation : [p.jobLocation]) : [];
  const text = places.map((l) => {
    const a = l.address;
    if (!a || typeof a === "string") return a ?? "";
    return joinParts(a.addressLocality, a.addressRegion, typeof a.addressCountry === "string" ? countryName(a.addressCountry) : a.addressCountry?.name);
  });
  return [...new Set(text.filter(Boolean))].join("; ");
}

/** Inner text of every <tag>…</tag> in an XML document (CDATA unwrapped, entities decoded). */
export function xmlAll(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "g");
  return [...xml.matchAll(re)].map((m) => xmlText(m[1]!));
}

/** Inner text of the first <tag>…</tag>, or "". */
export function xmlOne(xml: string, tag: string): string {
  return xmlAll(xml, tag)[0] ?? "";
}

/** Raw inner XML of every <tag>…</tag> (for nested elements). */
export function xmlBlocks(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "g");
  return [...xml.matchAll(re)].map((m) => m[1]!);
}

function xmlText(s: string): string {
  const cdata = s.match(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/);
  return cdata ? cdata[1]!.trim() : decodeEntities(s).trim();
}

/** Plain text of an HTML fragment on one line (titles, locations). */
export function inlineText(html: string | undefined): string {
  return htmlToText(html ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

/** "Posted 3 Days Ago", "Posted Today", "Posted 30+ Days Ago" -> ISO date (lower bound for "30+"). */
export function relativePosted(text: string | undefined, now: Date): string | undefined {
  if (!text) return undefined;
  const t = text.toLowerCase();
  const day = 86_400_000;
  if (/today|just posted|hours? ago|minutes? ago/.test(t)) return new Date(now.getTime()).toISOString();
  if (/yesterday/.test(t)) return new Date(now.getTime() - day).toISOString();
  const n = t.match(/(\d+)\+?\s*(day|week|month)s?\s*ago/);
  if (!n) return undefined;
  const mult = n[2] === "week" ? 7 : n[2] === "month" ? 30 : 1;
  return new Date(now.getTime() - Number(n[1]) * mult * day).toISOString();
}

/** Date.parse that returns an ISO string, or undefined for anything unparseable. */
export function isoDate(s: string | null | undefined): string | undefined {
  if (!s) return undefined;
  const t = Date.parse(s.replace(" UTC", "Z").replace(/^(\d{4}-\d{2}-\d{2}) (\d)/, "$1T$2"));
  return Number.isNaN(t) ? undefined : new Date(t).toISOString();
}

/** A Workplace from a free-text remote/hybrid hint. */
export function workplaceFrom(hint: string | null | undefined): "remote" | "hybrid" | "onsite" | undefined {
  const h = hint?.toLowerCase() ?? "";
  if (/remote|telecommut|home/.test(h)) return "remote";
  if (/hybrid/.test(h)) return "hybrid";
  if (/on.?site|office/.test(h)) return "onsite";
  return undefined;
}

/**
 * The hiring system says this company has no public board any more: the account is gone, blocked,
 * or its careers page is switched off. Its message says "board not found", which the directory's
 * check (scripts/catalog/lib/live-check.ts) records as dead instead of an error to retry.
 */
export class BoardClosedError extends Error {
  override name = "BoardClosedError";
  constructor(system: string, slug: string, why: string) {
    super(`${system} board not found: "${slug}" ${why}`);
  }
}

/** A job's link as a URL; undefined when it isn't one. */
export function urlOf(link: string | undefined): URL | undefined {
  try {
    return link ? new URL(link) : undefined;
  } catch {
    return undefined;
  }
}

/** The board slug and posting id in a job id ("ashby:acme:abc-123"), when the job came from that system. */
export function postingOfId(id: string, ats: AtsType): { slug: string; posting: string } | undefined {
  const [system, slug, ...rest] = id.split(":");
  return system === ats && slug && rest.length ? { slug, posting: rest.join(":") } : undefined;
}

/**
 * isOpen() for a posting's own API address: 200 = still open, 404 or 410 = taken down. Anything else
 * (a timeout, a 5xx, a 403, a redirect somewhere else) can't say, so undefined.
 */
export async function openByStatus(http: HttpClient, url: string): Promise<boolean | undefined> {
  try {
    const res = await http.request(url, { headers: { accept: "application/json" } });
    await res.body?.cancel().catch(() => {});
    return res.status === 200 && !res.redirected ? true : undefined;
  } catch (err) {
    return err instanceof HttpError && (err.status === 404 || err.status === 410) ? false : undefined;
  }
}

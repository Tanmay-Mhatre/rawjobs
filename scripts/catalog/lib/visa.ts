/**
 * Visa sponsor registers: parse each government list into normalised employer names, and match them
 * to directory companies by name. Precision over recall: a name that's short or generic, or that
 * several directory companies share, is never matched. Used by scripts/catalog/visa.ts (download)
 * and publish.ts (the `visa` field in directory.json). No network here.
 */
import { inflateRawSync } from "node:zlib";
import type { VisaCountry, VisaInfo } from "@rawjobs/core/catalog/visa";

/** raw/visa/<country>.json: one register, already reduced to normalised names. */
export type RegisterFile = {
  country: VisaCountry;
  /** The list it was built from: "2026-10-13", "FY2026", "2026Q1" (the newest one used). */
  period: string;
  fetched_at: string;
  /** How many employer rows the register had (before normalising). */
  rows: number;
  /** Normalised name -> the list it was last on (US: fiscal year; CA: quarter; else `period`). */
  names: Record<string, string>;
};

// ---------- reading files ----------

/** RFC 4180 CSV: quoted fields with commas, "" and line breaks. Strips a BOM. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let q = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (q) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          cur += '"';
          i++;
        } else q = false;
      } else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") {
      row.push(cur);
      cur = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(cur);
      rows.push(row);
      row = [];
      cur = "";
    } else cur += ch;
  }
  if (cur || row.length) {
    row.push(cur);
    rows.push(row);
  }
  return rows;
}

const XML_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
export const decodeXml = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) =>
    e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? Number.parseInt(e.slice(2), 16) : Number(e.slice(1))) : (XML_ENTITIES[e.toLowerCase()] ?? m),
  );

/** The files in a zip archive (stored or deflated), by name. Enough for .xlsx. */
export function unzip(buf: Buffer): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--)
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  if (eocd < 0) throw new Error("not a zip file");
  const entries = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < entries; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("bad zip directory");
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(start, start + size);
    if (method === 0) out.set(name, data);
    else if (method === 8) out.set(name, inflateRawSync(data));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

const colIndex = (ref: string) => {
  let n = 0;
  for (const ch of ref.replace(/\d+$/, "")) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};

/** The first sheet of an .xlsx file as rows of text cells. */
export function readXlsx(buf: Buffer): string[][] {
  const files = unzip(buf);
  const shared: string[] = [];
  const sst = files.get("xl/sharedStrings.xml")?.toString("utf8") ?? "";
  for (const si of sst.matchAll(/<si>([\s\S]*?)<\/si>/g)) shared.push(decodeXml([...si[1]!.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join("")));
  const sheet = files.get("xl/worksheets/sheet1.xml")?.toString("utf8");
  if (!sheet) throw new Error("no first sheet");
  const rows: string[][] = [];
  for (const r of sheet.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const row: string[] = [];
    for (const c of r[1]!.matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1]!;
      const ref = /\br="([A-Z]+\d+)"/.exec(attrs)?.[1];
      const type = /\bt="(\w+)"/.exec(attrs)?.[1];
      const body = c[2] ?? "";
      const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      const text = type === "s" ? (shared[Number(v)] ?? "") : type === "inlineStr" ? decodeXml([...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join("")) : decodeXml(v ?? "");
      row[ref ? colIndex(ref) : row.length] = text;
    }
    rows.push(Array.from(row, (x) => x ?? ""));
  }
  return rows;
}

// ---------- names ----------

/** Legal forms and filler at the end of a name: "Acme UK Holdings Ltd" -> "acme". */
const TRAILING = new Set([
  "ltd",
  "limited",
  "llc",
  "llp",
  "lp",
  "plc",
  "inc",
  "incorporated",
  "corp",
  "corporation",
  "co",
  "company",
  "gmbh",
  "ag",
  "bv",
  "nv",
  "sa",
  "sas",
  "sarl",
  "srl",
  "spa",
  "ab",
  "as",
  "oy",
  "pty",
  "pte",
  "pvt",
  "private",
  "pc",
  "pllc",
  "ulc",
  "ltee",
  "cic",
  "uk",
  "gb",
  "usa",
  "us",
  "america",
  "americas",
  "canada",
  "nederland",
  "netherlands",
  "holding",
  "holdings",
  "group",
]);

/**
 * Names too generic to say which company is meant (after normalising): a directory company called
 * one of these is never matched. Words many unrelated firms use, plus the ones the spot checks caught.
 */
export const VISA_STOPLIST = new Set([
  "about",
  "access",
  "action",
  "active",
  "advance",
  "agency",
  "alpha",
  "apex",
  "arc",
  "atlas",
  "bank",
  "beacon",
  "blue",
  "bridge",
  "capital",
  "care",
  "central",
  "clear",
  "cloud",
  "core",
  "creative",
  "data",
  "delta",
  "design",
  "digital",
  "direct",
  "edge",
  "energy",
  "elite",
  "engineering",
  "evolve",
  "first",
  "focus",
  "fusion",
  "global",
  "green",
  "health",
  "healthcare",
  "home",
  "horizon",
  "impact",
  "insight",
  "international",
  "jobs",
  "labs",
  "legal",
  "life",
  "link",
  "logistics",
  "management",
  "media",
  "medical",
  "nova",
  "one",
  "online",
  "partners",
  "people",
  "pioneer",
  "premier",
  "prime",
  "pulse",
  "quantum",
  "recruitment",
  "research",
  "resources",
  "royal",
  "security",
  "select",
  "services",
  "smart",
  "software",
  "solutions",
  "spark",
  "staffing",
  "star",
  "studio",
  "summit",
  "support",
  "systems",
  "talent",
  "team",
  "tech",
  "technology",
  "technologies",
  "the",
  "trust",
  "united",
  "unity",
  "vision",
  "wave",
  "works",
]);

/** Shortest name (letters and digits, spaces left out) that can be matched. */
export const MIN_NAME = 4;

/**
 * Normalised forms of an employer name: lower case, accents and punctuation gone, "&" read as "and",
 * a leading "The" and trailing legal forms ("Ltd", "& Co", "Inc", "UK") dropped. A trading name
 * ("Acme Ltd t/a Widgets", "ACME INC DBA WIDGETS") is a second form. Empty forms are left out.
 */
export function normaliseEmployer(name: string): string[] {
  const parts = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/\s+(?:t\/a|d\/b\/a|dba|trading as|also known as|aka|formerly)\s+/);
  const out = new Set<string>();
  for (const part of parts) {
    const words = part
      .replace(/&/g, " and ")
      .replace(/\([^)]*\)/g, " ")
      .replace(/(\w)\.(?=\w\b)/g, "$1") // "B.V." -> "BV", "L.L.C." -> "LLC"
      .replace(/['’`]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .split(" ")
      .filter(Boolean);
    if (words[0] === "the" && words.length > 1) words.shift();
    while (words.length > 1 && TRAILING.has(words.at(-1)!)) {
      words.pop();
      // "Smith & Co" -> "smith"
      if (words.length > 1 && words.at(-1) === "and") words.pop();
    }
    const key = words.join(" ");
    if (key) out.add(key);
  }
  return [...out];
}

/** Can this normalised directory name be matched at all? */
export const matchable = (key: string) => key.replace(/ /g, "").length >= MIN_NAME && !/^\d+$/.test(key.replace(/ /g, "")) && !VISA_STOPLIST.has(key);

// ---------- registers ----------

/** UK routes that are work sponsorship (not religion, sport, charity, exchange schemes or creative work). */
const UK_ROUTES = /^(Skilled Worker|Global Business Mobility: (Senior or Specialist Worker|Graduate Trainee|UK Expansion Worker)|Scale-up)$/i;

/** The UK register (CSV: Organisation Name, Town/City, County, Type & Rating, Route): work routes only. */
export function ukEmployers(csv: string): { rows: number; names: string[] } {
  const rows = parseCsv(csv);
  const head = rows[0]?.map((h) => h.trim().toLowerCase()) ?? [];
  const name = head.indexOf("organisation name");
  const route = head.indexOf("route");
  if (name < 0 || route < 0) throw new Error("UK register: unexpected columns");
  const out = rows.slice(1).filter((r) => r[name]?.trim() && UK_ROUTES.test((r[route] ?? "").trim()));
  return { rows: rows.length - 1, names: out.map((r) => r[name]!.trim()) };
}

/**
 * The USCIS H-1B Employer Data Hub export (one row per employer and measure): employers with at least
 * one new-employment or continuation approval in the year.
 */
export function usEmployers(csv: string, year?: number): { rows: number; names: string[] } {
  const rows = parseCsv(csv);
  // A year with no data yet comes back empty.
  if (!csv.trim()) return { rows: 0, names: [] };
  const head = rows[0]?.map((h) => h.trim().toLowerCase()) ?? [];
  const name = head.findIndex((h) => h.startsWith("employer"));
  const fy = head.indexOf("fiscal year");
  const measure = head.indexOf("measure names");
  const value = head.indexOf("measure values");
  if (name >= 0 && measure >= 0 && value >= 0) {
    const names = new Set<string>();
    const all = new Set<string>();
    for (const r of rows.slice(1)) {
      const n = r[name]?.trim();
      // A year asked for and a row from another one: the export ignored the filter.
      if (!n || (year && fy >= 0 && Number(r[fy]) !== year)) continue;
      all.add(n);
      if (/^(New Employment|Continuation) Approval$/i.test(r[measure]?.trim() ?? "") && Number((r[value] ?? "").replace(/,/g, "")) > 0) names.add(n);
    }
    return { rows: all.size, names: [...names] };
  }
  // The yearly files (h1b_datahubexport-YYYY.csv): a column per measure.
  const initial = head.findIndex((h) => /initial approval/.test(h));
  const continuing = head.findIndex((h) => /continuing approval/.test(h));
  if (name < 0 || initial < 0 || continuing < 0) throw new Error("H-1B data: unexpected columns");
  const ok = rows.slice(1).filter((r) => r[name]?.trim() && (Number(r[initial]) > 0 || Number(r[continuing]) > 0));
  return { rows: rows.length - 1, names: ok.map((r) => r[name]!.trim()) };
}

/** A quarter's positive-LMIA list (xlsx rows, a title row first): every stream but primary agriculture. */
export function caEmployers(rows: string[][]): { rows: number; names: string[] } {
  const h = rows.findIndex((r) => r.some((c) => /^employer$/i.test(c.trim())));
  if (h < 0) throw new Error("LMIA list: no Employer column");
  const head = rows[h]!.map((c) => c.trim().toLowerCase());
  const name = head.indexOf("employer");
  const stream = head.findIndex((c) => /stream/.test(c));
  const data = rows.slice(h + 1).filter((r) => r[name]?.trim() && !/^(note|total)/i.test(r[0] ?? ""));
  const names = data.filter((r) => stream < 0 || !/agricultur/i.test(r[stream] ?? "")).map((r) => r[name]!.trim());
  return { rows: data.length, names };
}

/** The IND public register (work), an HTML table: Organisation, KVK number. */
export function nlEmployers(html: string): { rows: number; names: string[]; updated?: string } {
  const names: string[] = [];
  for (const m of html.matchAll(/<tr>\s*<th scope="row">([\s\S]*?)<\/th>\s*<td>/g)) {
    const n = decodeXml(m[1]!.replace(/<[^>]+>/g, ""))
      .replace(/""/g, '"')
      .trim();
    if (n) names.push(n);
  }
  if (!names.length) throw new Error("IND register: no table rows");
  const d = /last updated on (\d{1,2}) (\w+) (\d{4})/i.exec(html);
  const month = d ? ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"].indexOf(d[2]!.toLowerCase()) + 1 : 0;
  return { rows: names.length, names, ...(d && month ? { updated: `${d[3]}-${String(month).padStart(2, "0")}-${d[1]!.padStart(2, "0")}` } : {}) };
}

/** Normalised names -> period. Later calls win only with a newer period (pass lists oldest first or not, either works). */
export function addNames(into: Record<string, string>, names: readonly string[], period: string): void {
  for (const n of names) for (const key of normaliseEmployer(n)) if (!into[key] || into[key]! < period) into[key] = period;
}

// ---------- matching ----------

/**
 * A name other employers on the registers also use ("Passion" is in "Passion Foods", "Passion Care"...)
 * is common: it could be anyone's. At this many other register names, a common name only matches a
 * company big enough to be the obvious one (BIG_JOBS open jobs, or hand-picked); at NEVER_AT, never
 * ("Nationwide", "Ideal", "Dream": the register's one is as likely someone else).
 */
export const COMMON_AT = 3;
export const NEVER_AT = 10;
export const BIG_JOBS = 25;

export type MatchStats = {
  country: VisaCountry;
  period: string;
  registerRows: number;
  registerNames: number;
  matched: number;
  /** Several directory companies share the name. */
  skippedAmbiguous: number;
  /** A common name at a small company. */
  skippedCommon: number;
};

export type VisaCompany = { key: string; name: string; open_jobs?: number | null; tier?: string };

/**
 * How many other register names (all countries) use each name: for a one-word name, names with that
 * word anywhere; for longer ones, names that start with it.
 */
export function commonness(registers: readonly RegisterFile[]): (key: string) => number {
  const all = new Set(registers.flatMap((r) => Object.keys(r.names)));
  const word = new Map<string, number>();
  const prefix = new Map<string, number>();
  const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
  for (const n of all) {
    const words = n.split(" ");
    if (words.length < 2) continue;
    for (const w of new Set(words)) bump(word, w);
    for (let i = 2; i < words.length; i++) bump(prefix, words.slice(0, i).join(" "));
  }
  return (key) => (key.includes(" ") ? (prefix.get(key) ?? 0) : (word.get(key) ?? 0));
}

/**
 * Tag directory companies found on the registers. A company matches when one of its normalised names
 * is on the register. Never matched: names that are too short, numeric or on the stoplist; names that
 * several directory companies share (we can't tell which one the register means); and common names
 * (COMMON_AT at small companies, NEVER_AT at any).
 */
export function matchVisa(
  companies: readonly VisaCompany[],
  registers: readonly RegisterFile[],
): { visa: Map<string, VisaInfo>; stats: MatchStats[]; matches: { key: string; name: string; country: VisaCountry; as: string }[] } {
  const byName = new Map<string, Set<string>>();
  for (const c of companies)
    for (const n of normaliseEmployer(c.name)) {
      let s = byName.get(n);
      if (!s) byName.set(n, (s = new Set()));
      s.add(c.key);
    }
  const byKey = new Map(companies.map((c) => [c.key, c]));
  const common = commonness(registers);
  const big = (c: VisaCompany) => c.tier === "curated" || (c.open_jobs ?? 0) >= BIG_JOBS;
  const visa = new Map<string, VisaInfo>();
  const stats: MatchStats[] = [];
  const matches: { key: string; name: string; country: VisaCountry; as: string }[] = [];
  for (const reg of registers) {
    let matched = 0;
    let ambiguous = 0;
    let commonSkipped = 0;
    for (const [n, keys] of byName) {
      const period = reg.names[n];
      if (!period || !matchable(n)) continue;
      if (keys.size > 1) {
        ambiguous++;
        continue;
      }
      const c = byKey.get([...keys][0]!)!;
      const used = common(n);
      if (used >= NEVER_AT || (used >= COMMON_AT && !big(c))) {
        commonSkipped++;
        continue;
      }
      const v = visa.get(c.key) ?? {};
      if (v[reg.country]) continue;
      v[reg.country] = period;
      visa.set(c.key, v);
      matched++;
      matches.push({ key: c.key, name: c.name, country: reg.country, as: n });
    }
    stats.push({ country: reg.country, period: reg.period, registerRows: reg.rows, registerNames: Object.keys(reg.names).length, matched, skippedAmbiguous: ambiguous, skippedCommon: commonSkipped });
  }
  return { visa, stats, matches };
}

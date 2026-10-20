/**
 * LinkedIn's data export, read into a NetworkFile. Pure. Columns are picked by an allowlist, so the
 * "Email Address" column is never even looked up.
 */
import { findHeader, parseCsv } from "./csv";
import type { NetworkConnection, NetworkFile, NetworkPosition, NetworkSchool } from "./types";
import { type ZipEntry, zipBasename } from "./zip";

/** The only files read from the export, by lower-case basename, so a subfolder still works. */
export const ALLOWED = ["connections.csv", "positions.csv", "education.csv"] as const;

export const CAPS = {
  csvChars: 10_000_000,
  rows: 30_000,
  field: 200,
  positions: 100,
  education: 30,
  friends: 2_000,
} as const;

export type ExportErrorCode = "NO_CONNECTIONS" | "TOO_BIG";

export class ExportError extends Error {
  constructor(readonly code: ExportErrorCode) {
    super(code);
    this.name = "ExportError";
  }
}

export type ExportFiles = { connections?: string; positions?: string; education?: string };

export function isAllowedEntry(name: string): boolean {
  return (ALLOWED as readonly string[]).includes(zipBasename(name).toLowerCase());
}

/** The allowlisted files from a ZIP's entries; the shallowest wins when one name appears twice. */
export function exportFilesFromEntries(entries: readonly ZipEntry[]): ExportFiles {
  const files: ExportFiles = {};
  const depth = (n: string) => n.split(/[/\\]/).length;
  const decoder = new TextDecoder("utf-8");
  for (const e of [...entries].sort((a, b) => depth(a.name) - depth(b.name))) {
    const key = zipBasename(e.name)
      .toLowerCase()
      .replace(/\.csv$/, "") as keyof ExportFiles;
    if (isAllowedEntry(e.name) && files[key] === undefined) files[key] = decoder.decode(e.data);
  }
  return files;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const pad = (n: number) => String(n).padStart(2, "0");

/** A date as far as it's known. Tolerates "15 Oct 2024", "Oct 2024", "2024", "10/15/24" and ISO. */
export function parseExportDate(raw: string | undefined): { y: number; m?: number; d?: number } | null {
  const s = (raw ?? "").trim();
  let m: RegExpMatchArray | null;
  const month = (name: string) => MONTHS.indexOf(name.slice(0, 3).toLowerCase()) + 1;
  const ok = (y: number, mo?: number, d?: number) => (y >= 1900 && y <= 2200 && (mo === undefined || (mo >= 1 && mo <= 12)) && (d === undefined || (d >= 1 && d <= 31)) ? { y, m: mo, d } : null);
  if ((m = s.match(/^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?(?:[T ].*)?$/))) return ok(+m[1]!, +m[2]!, m[3] ? +m[3] : undefined);
  if ((m = s.match(/^(\d{1,2})\s+([A-Za-z]{3,})\.?,?\s+(\d{4})$/))) return month(m[2]!) ? ok(+m[3]!, month(m[2]!), +m[1]!) : null;
  if ((m = s.match(/^([A-Za-z]{3,})\.?\s+(\d{1,2}),?\s+(\d{4})$/))) return month(m[1]!) ? ok(+m[3]!, month(m[1]!), +m[2]!) : null;
  if ((m = s.match(/^([A-Za-z]{3,})\.?\s+(\d{4})$/))) return month(m[1]!) ? ok(+m[2]!, month(m[1]!)) : null;
  if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/))) return ok(m[3]!.length === 2 ? 2000 + +m[3]! : +m[3]!, +m[1]!, +m[2]!);
  if ((m = s.match(/^(\d{4})$/))) return ok(+m[1]!);
  return null;
}

const toDay = (raw: string | undefined) => {
  const d = parseExportDate(raw);
  return d?.m && d.d ? `${d.y}-${pad(d.m)}-${pad(d.d)}` : undefined;
};
const toMonth = (raw: string | undefined) => {
  const d = parseExportDate(raw);
  return d?.m ? `${d.y}-${pad(d.m)}` : undefined;
};
const toYear = (raw: string | undefined) => {
  const d = parseExportDate(raw);
  return d ? String(d.y) : undefined;
};

const clip = (s: string | undefined, n: number) => {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  return t ? t.slice(0, n) : undefined;
};

/** A short, stable, browser-safe hash (two FNV-1a passes), for connections without a profile URL. */
function shortHash(text: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ c, 0x01000193) ^ (b >>> 15);
  }
  return ((a >>> 0).toString(16).padStart(8, "0") + (b >>> 0).toString(16).padStart(8, "0")).slice(0, 12);
}

/** A LinkedIn profile URL as https://www.linkedin.com/in/<slug>, or null for anything else. */
export function profileUrl(raw: string | undefined): { url: string; slug: string } | null {
  let u: URL;
  try {
    u = new URL((raw ?? "").trim());
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase();
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  if (host !== "linkedin.com" && !host.endsWith(".linkedin.com")) return null;
  const m = u.pathname.match(/^\/in\/([^/]+)\/?$/);
  return m ? { url: `https://www.linkedin.com/in/${m[1]}`, slug: m[1]! } : null;
}

/** Rows from one CSV, after its header; null when the header isn't there. */
function table(text: string, required: readonly string[]) {
  if (text.length > CAPS.csvChars) throw new ExportError("TOO_BIG");
  const rows = parseCsv(text, { maxRows: CAPS.rows + 50, maxField: CAPS.field });
  const header = findHeader(rows, required);
  if (!header) return null;
  const body = rows.slice(header.index + 1, header.index + 1 + CAPS.rows).filter((r) => r.some((c) => c.trim()));
  return {
    rows: body,
    /** A getter for one allowlisted column. */
    get: (name: string) => {
      const i = header.col(name);
      return (row: string[]) => (i < 0 ? undefined : row[i]);
    },
  };
}

/** Connections.csv. Null when it has no "First Name" + "URL" header. */
export function parseConnections(text: string): NetworkConnection[] | null {
  const t = table(text, ["First Name", "URL"]);
  if (!t) return null;
  const [first, last, url, company, position, on] = ["First Name", "Last Name", "URL", "Company", "Position", "Connected On"].map(t.get) as ((r: string[]) => string | undefined)[];
  const seen = new Set<string>();
  const out: NetworkConnection[] = [];
  for (const r of t.rows) {
    const f = clip(first!(r), 80) ?? "";
    const l = clip(last!(r), 80) ?? "";
    if (!f && !l) continue;
    if (`${f} ${l}`.trim().toLowerCase() === "linkedin member") continue;
    const profile = profileUrl(url!(r));
    const c: NetworkConnection = { id: "", first: f, last: l };
    if (profile) c.url = profile.url;
    const co = clip(company!(r), 120);
    if (co) c.company = co;
    const pos = clip(position!(r), 160);
    if (pos) c.position = pos;
    const day = toDay(on!(r));
    if (day) c.connectedOn = day;
    const slug = profile?.slug.toLowerCase();
    c.id = slug && /^[\w-]{1,100}$/.test(slug) ? `u:${slug}` : `n:${shortHash(slug ?? `${f}|${l}|${co ?? ""}`.toLowerCase())}`;
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    out.push(c);
  }
  return out;
}

/** Positions.csv: your own jobs. Description and Location are dropped. */
export function parsePositions(text: string): NetworkPosition[] {
  const t = table(text, ["Company Name"]);
  if (!t) return [];
  const [company, title, from, to] = ["Company Name", "Title", "Started On", "Finished On"].map(t.get) as ((r: string[]) => string | undefined)[];
  const out: NetworkPosition[] = [];
  for (const r of t.rows) {
    const co = clip(company!(r), 120);
    if (!co) continue;
    const p: NetworkPosition = { company: co };
    const ti = clip(title!(r), 160);
    if (ti) p.title = ti;
    const f = toMonth(from!(r));
    if (f) p.from = f;
    const e = toMonth(to!(r));
    if (e) p.to = e;
    out.push(p);
    if (out.length >= CAPS.positions) break;
  }
  return out;
}

/** Education.csv: your schools. Notes and Activities are dropped. */
export function parseEducation(text: string): NetworkSchool[] {
  const t = table(text, ["School Name"]);
  if (!t) return [];
  const [name, from, to, degree] = ["School Name", "Start Date", "End Date", "Degree Name"].map(t.get) as ((r: string[]) => string | undefined)[];
  const out: NetworkSchool[] = [];
  for (const r of t.rows) {
    const n = clip(name!(r), 120);
    if (!n) continue;
    const s: NetworkSchool = { name: n };
    const f = toYear(from!(r));
    if (f) s.from = f;
    const e = toYear(to!(r));
    if (e) s.to = e;
    const d = clip(degree!(r), 120);
    if (d) s.degree = d;
    out.push(s);
    if (out.length >= CAPS.education) break;
  }
  return out;
}

export type BuildOptions = { source: "downloads" | "file"; fileName?: string; now: Date; keepFriends?: readonly string[] };

/** The whole import: a NetworkFile, or why it can't be made. */
export function buildNetwork(files: ExportFiles, opts: BuildOptions): NetworkFile | { error: ExportErrorCode } {
  try {
    const connections = files.connections === undefined ? null : parseConnections(files.connections);
    if (!connections?.length) return { error: "NO_CONNECTIONS" };
    const ids = new Set(connections.map((c) => c.id));
    const file: NetworkFile = {
      app: "rawjobs",
      kind: "network",
      version: 1,
      importedAt: opts.now.toISOString(),
      source: opts.source,
      connections,
      positions: files.positions === undefined ? [] : parsePositions(files.positions),
      education: files.education === undefined ? [] : parseEducation(files.education),
      friends: [...new Set(opts.keepFriends ?? [])].filter((id) => ids.has(id)).slice(0, CAPS.friends),
    };
    const name = clip(opts.fileName && zipBasename(opts.fileName), 200);
    if (name) file.fileName = name;
    return file;
  } catch (e) {
    if (e instanceof ExportError) return { error: e.code };
    throw e;
  }
}

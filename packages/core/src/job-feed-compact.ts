import { Readable } from "node:stream";
import { createBrotliDecompress } from "node:zlib";
import { feedHashOf, type FeedRow, type FeedState } from "./job-feed-diff";
import type { Workplace } from "./schema";

/**
 * The job feed's compact text format (schema 3): the full copy the build publishes, and the pieces the
 * app keeps (job-feed-store.ts). With every hiring system the feed has millions of jobs; as JSON objects
 * that is ~2 GB in memory. Here each distinct title and place is stored once, and each company's jobs
 * are one string, so the app can work through the feed a slice at a time.
 *
 *   rawjobs-feed \t 3 \t <seq> \t <generated_at>
 *   <number of titles>, then one title per line
 *   <number of places>, then one place per line
 *   <number of companies>, then per company (sorted by key):
 *     <key> \t <verified> \t <1 if partial, else 0> \t <number of jobs>, then one job per line:
 *     <id> \t <title #> \t <place #> \t <o|h|r|u> \t <posted or empty> \t <resolved place # or empty>
 * Numbers after "#" are base 36. Every line ends in a line break. No field holds a tab or a line break
 * (the build replaces them).
 */
export const COMPACT_MAGIC = "rawjobs-feed";
export const COMPACT_SCHEMA = 3;

const W: Record<Workplace, string> = { onsite: "o", hybrid: "h", remote: "r", unknown: "u" };
const W_BACK: Record<string, Workplace> = { o: "onsite", h: "hybrid", r: "remote", u: "unknown" };

/** A list of strings by position: an array, or (in the app) lines in one Buffer. */
export type StringList = { readonly length: number; at(i: number): string | undefined };

/** Lines of one Buffer as a list, without a JS string per line until one is asked for. */
export class BufferList implements StringList {
  private readonly ends: Uint32Array;
  constructor(
    /** The lines, each ending in a line break. */
    readonly buf: Buffer,
    readonly length: number,
  ) {
    this.ends = new Uint32Array(length);
    let pos = 0;
    for (let i = 0; i < length; i++) {
      const nl = buf.indexOf(10, pos);
      if (nl < 0) throw new Error("broken job feed dictionary");
      this.ends[i] = nl;
      pos = nl + 1;
    }
  }
  at(i: number): string | undefined {
    if (!(i >= 0 && i < this.length)) return undefined;
    return this.buf.toString("utf8", i ? this.ends[i - 1]! + 1 : 0, this.ends[i]);
  }
}

/** The title and place dictionaries rows point into. */
export type FeedDict = { titles: StringList; places: StringList };
/** Gives a title or place its number in a dictionary, adding it when new. */
export type DictWriter = { title(s: string): number; place(s: string): number };

/** A dictionary built from scratch (the build): every distinct string once. */
export function arrayDict(): FeedDict & DictWriter & { titles: string[]; places: string[] } {
  const titles: string[] = [];
  const places: string[] = [];
  const tIx = new Map<string, number>();
  const pIx = new Map<string, number>();
  const add = (list: string[], ix: Map<string, number>, s: string) => {
    let i = ix.get(s);
    if (i === undefined) {
      i = list.length;
      list.push(s);
      ix.set(s, i);
    }
    return i;
  };
  return { titles, places, title: (s) => add(titles, tIx, s), place: (s) => add(places, pIx, s) };
}

/** One job as a line. */
export function encodeRow(w: DictWriter, r: FeedRow): string {
  const resolved = r.length > 5 && r[5] !== undefined ? w.place(r[5]).toString(36) : "";
  return `${r[0]}\t${w.title(r[1]).toString(36)}\t${w.place(r[2]).toString(36)}\t${W[r[3]] ?? "u"}\t${r[4] ?? ""}\t${resolved}`;
}

export function decodeRow(d: FeedDict, line: string): FeedRow {
  const f = line.split("\t");
  const row: FeedRow = [f[0]!, d.titles.at(Number.parseInt(f[1]!, 36)) ?? "", d.places.at(Number.parseInt(f[2]!, 36)) ?? "", W_BACK[f[3]!] ?? "unknown", f[4] ? f[4] : null];
  // Only rows that have it get a sixth field: the fingerprint compares rows as JSON.
  if (f[5]) row.push(d.places.at(Number.parseInt(f[5], 36)) ?? "");
  return row;
}

/** A company's packed jobs (lines joined by line breaks) as rows. */
export const decodeRows = (d: FeedDict, packed: string | undefined): FeedRow[] => (packed ? packed.split("\n").map((l) => decodeRow(d, l)) : []);
/** The job id a packed line starts with. */
export const idOfLine = (line: string) => line.slice(0, line.indexOf("\t"));
/** How many jobs a packed string holds. */
export const countRows = (packed: string) => (packed ? packed.split("\n").length : 0);

export const companyLine = (key: string, verified: string, partial: boolean, packed: string) => `${key}\t${verified}\t${partial ? 1 : 0}\t${countRows(packed)}`;
export function parseCompanyLine(line: string): { key: string; verified: string; partial: boolean; n: number } {
  const [key, verified, partial, count] = line.split("\t");
  const n = Number(count);
  if (!key || !Number.isInteger(n) || n < 0) throw new Error("broken compact job feed");
  return { key, verified: verified ?? "", partial: partial === "1", n };
}

/** Lines collected into Buffers in pieces, so no one string gets near V8's string size limit. */
export class LineBuffer {
  private parts: Buffer[] = [];
  private lines: string[] = [];
  count = 0;
  push(line: string) {
    this.lines.push(line);
    this.count++;
    if (this.lines.length >= 20_000) this.flush();
  }
  private flush() {
    if (this.lines.length) this.parts.push(Buffer.from(`${this.lines.join("\n")}\n`, "utf8"));
    this.lines = [];
  }
  done(): Buffer {
    this.flush();
    const out = Buffer.concat(this.parts);
    this.parts = [];
    return out;
  }
}

/** A whole compact feed in memory: the build's side (CI has the memory). */
export type CompactFeed = {
  seq: number;
  generated_at: string;
  titles: string[];
  places: string[];
  verified: Record<string, string>;
  partial: Set<string>;
  /** Per company: its jobs, one per line, as in the file. "" for none. */
  jobs: Map<string, string>;
};

/** A state (the build's) as a compact feed. */
export function compactOf(state: FeedState, meta: { seq: number; generated_at: string }): CompactFeed {
  const d = arrayDict();
  const jobs = new Map<string, string>();
  for (const key of Object.keys(state.jobs).sort()) jobs.set(key, state.jobs[key]!.map((r) => encodeRow(d, r)).join("\n"));
  return { ...meta, titles: d.titles, places: d.places, verified: { ...state.verified }, partial: new Set(state.partial ?? []), jobs };
}

/** A compact feed as a state (the build reads its previous full copy this way). */
export function stateOfCompact(c: CompactFeed): FeedState {
  const jobs: Record<string, FeedRow[]> = {};
  for (const [key, packed] of c.jobs) jobs[key] = decodeRows(c, packed);
  return { verified: { ...c.verified }, jobs, partial: [...c.partial].sort() };
}

/** The file's bytes. */
export function encodeCompact(c: CompactFeed): Buffer {
  const out = new LineBuffer();
  out.push(`${COMPACT_MAGIC}\t${COMPACT_SCHEMA}\t${c.seq}\t${c.generated_at}`);
  out.push(String(c.titles.length));
  for (const t of c.titles) out.push(t);
  out.push(String(c.places.length));
  for (const p of c.places) out.push(p);
  out.push(String(c.jobs.size));
  for (const key of [...c.jobs.keys()].sort()) {
    const packed = c.jobs.get(key)!;
    out.push(companyLine(key, c.verified[key] ?? "", c.partial.has(key), packed));
    if (packed) out.push(packed);
  }
  return out.done();
}

/**
 * Reads a compact feed one line at a time (feed it lines in order): the header, each dictionary line,
 * then each company with its packed jobs.
 */
export class CompactReader {
  private state: "header" | "titles#" | "titles" | "places#" | "places" | "companies#" | "company" | "rows" | "end" = "header";
  private left = 0;
  private companiesLeft = 0;
  private company?: { key: string; verified: string; partial: boolean };
  private rows: string[] = [];
  meta?: { seq: number; generated_at: string };
  constructor(
    private readonly on: {
      dictLine(kind: "title" | "place", line: string): void;
      dictCount?(kind: "title" | "place", n: number): void;
      company(key: string, verified: string, partial: boolean, packed: string): void;
    },
  ) {}
  private count(line: string) {
    const n = Number(line);
    if (!Number.isInteger(n) || n < 0) throw new Error("broken compact job feed");
    return n;
  }
  line(line: string) {
    switch (this.state) {
      case "header": {
        const [magic, schema, seq, generated_at] = line.split("\t");
        if (magic !== COMPACT_MAGIC || Number(schema) !== COMPACT_SCHEMA) throw new Error("not a compact job feed of a known format");
        this.meta = { seq: Number(seq), generated_at: generated_at ?? "" };
        this.state = "titles#";
        return;
      }
      case "titles#":
      case "places#": {
        const kind = this.state === "titles#" ? "title" : "place";
        this.left = this.count(line);
        this.on.dictCount?.(kind, this.left);
        this.state = this.left ? (kind === "title" ? "titles" : "places") : kind === "title" ? "places#" : "companies#";
        return;
      }
      case "titles":
      case "places": {
        const kind = this.state === "titles" ? "title" : "place";
        this.on.dictLine(kind, line);
        if (--this.left === 0) this.state = kind === "title" ? "places#" : "companies#";
        return;
      }
      case "companies#":
        this.companiesLeft = this.count(line);
        this.state = this.companiesLeft ? "company" : "end";
        return;
      case "company": {
        const c = parseCompanyLine(line);
        this.company = c;
        this.left = c.n;
        this.rows = [];
        if (!c.n) this.endCompany();
        else this.state = "rows";
        return;
      }
      case "rows":
        this.rows.push(line);
        if (--this.left === 0) this.endCompany();
        return;
      case "end":
        if (line) throw new Error("broken compact job feed: extra lines");
    }
  }
  private endCompany() {
    const c = this.company!;
    this.on.company(c.key, c.verified, c.partial, this.rows.join("\n"));
    this.rows = [];
    this.state = --this.companiesLeft ? "company" : "end";
  }
  /** Throws unless the whole feed was read. */
  end() {
    if (this.state !== "end") throw new Error("broken compact job feed: cut short");
  }
}

/** Every line of a Buffer, in order (the last line break ends the last line). */
export function forEachLine(buf: Buffer, fn: (line: string) => void) {
  let pos = 0;
  while (pos < buf.length) {
    const nl = buf.indexOf(10, pos);
    const end = nl < 0 ? buf.length : nl;
    fn(buf.toString("utf8", pos, end));
    pos = end + 1;
  }
}

/** Every line of a brotli-compressed Buffer, decompressed a chunk at a time: the whole text is never in memory. */
export async function forEachBrotliLine(compressed: Buffer, fn: (line: string) => void): Promise<void> {
  let carry: Buffer = Buffer.alloc(0);
  for await (const chunk of Readable.from([compressed]).pipe(createBrotliDecompress({ chunkSize: 1 << 20 }))) {
    const buf: Buffer = carry.length ? Buffer.concat([carry, chunk as Buffer]) : (chunk as Buffer);
    const last = buf.lastIndexOf(10);
    if (last < 0) {
      carry = buf;
      continue;
    }
    forEachLine(buf.subarray(0, last + 1), fn);
    carry = Buffer.from(buf.subarray(last + 1));
  }
  if (carry.length) forEachLine(carry, fn);
}

/** Read a whole compact feed into memory (the build, and tests). */
export function decodeCompact(buf: Buffer): CompactFeed {
  const c: CompactFeed = { seq: 0, generated_at: "", titles: [], places: [], verified: {}, partial: new Set(), jobs: new Map() };
  const reader = new CompactReader({
    dictLine: (kind, line) => (kind === "title" ? c.titles : c.places).push(line),
    company: (key, verified, partial, packed) => {
      c.verified[key] = verified;
      if (partial) c.partial.add(key);
      c.jobs.set(key, packed);
    },
  });
  forEachLine(buf, (l) => reader.line(l));
  reader.end();
  return Object.assign(c, reader.meta);
}

/** feedStateHash of a compact feed, unpacking one company at a time. */
export const compactHash = (c: CompactFeed): string => feedHashOf(c.jobs.keys(), c.verified, c.partial, (key) => decodeRows(c, c.jobs.get(key)));

/** "3 Locations": the list doesn't say where, so only the title (or the looked-up place) can rule the job out. */
export const VAGUE_LOCATION = /^\s*(\d+\s+locations?|multiple locations?|various)?\s*$/i;

/**
 * A test for one company's packed jobs: does any pass the title and location gates? Each distinct title
 * and place is checked once, against the dictionary.
 */
export function compactMatcher(d: FeedDict, titleOk: (title: string) => boolean, placeOk: (location: string, workplace: Workplace) => boolean): (packed: string) => boolean {
  const titles = new Int8Array(d.titles.length);
  const places = new Map<string, boolean>();
  const place = (pi: string, w: string) => {
    const k = `${w}${pi}`;
    let ok = places.get(k);
    if (ok === undefined) places.set(k, (ok = placeOk(d.places.at(Number.parseInt(pi, 36)) ?? "", W_BACK[w] ?? "unknown")));
    return ok;
  };
  return (packed) => {
    if (!packed) return false;
    for (const line of packed.split("\n")) {
      const f = line.split("\t");
      const ti = Number.parseInt(f[1]!, 36);
      if (titles[ti] === 0) titles[ti] = titleOk(d.titles.at(ti) ?? "") ? 1 : 2;
      if (titles[ti] !== 1) continue;
      const location = d.places.at(Number.parseInt(f[2]!, 36)) ?? "";
      if (!VAGUE_LOCATION.test(location)) {
        if (place(f[2]!, f[3]!)) return true;
      } else if (!f[5] || place(f[5], f[3]!)) return true;
    }
    return false;
  };
}

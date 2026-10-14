import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { brotliCompressSync, brotliDecompressSync, constants } from "node:zlib";
import {
  BufferList,
  CompactReader,
  companyLine,
  decodeRows,
  encodeRow,
  forEachBrotliLine,
  forEachLine,
  idOfLine,
  LineBuffer,
  parseCompanyLine,
  type DictWriter,
  type FeedDict,
} from "./job-feed-compact";
import { FeedHasher, type FeedDiff, type FeedRow } from "./job-feed-diff";

/**
 * The app's copy of the job feed's third format, kept in pieces so it never has to be in memory at
 * once: a dictionary file (titles, then places) and part files of PART_COMPANIES companies each, in key
 * order, in the compact format (job-feed-compact.ts). The dictionary stays one Buffer in memory, not a
 * string per title. Updating streams through the parts once, applying every change file on the way and
 * checking the result's fingerprint; matching reads one part at a time. New files get new names, so the
 * old copy stays whole until the caller switches its index over.
 */
export const PART_COMPANIES = 2_000;

export type StoreFiles = { dict: string; parts: string[] };
export type StoreResult = StoreFiles & {
  verified: Record<string, string>;
  partial: string[];
  /** feedStateHash() of what was written. */
  hash: string;
  /** Titles + places in the dictionary (change files add to it, never remove). */
  dictSize: number;
  /** Company -> the change file's version that last changed its jobs. */
  touched: Record<string, number>;
};

const fast = (b: Buffer) => brotliCompressSync(b, { params: { [constants.BROTLI_PARAM_QUALITY]: 1 } });
const unbrotli = (dir: string, file: string) => brotliDecompressSync(readFileSync(join(dir, file)));

/** A dictionary as kept in memory: each list one Buffer of lines. */
type BufferDict = { titles: BufferList; places: BufferList };

class StoreWriter {
  readonly parts: string[] = [];
  readonly hasher = new FeedHasher();
  private out = new LineBuffer();
  private count = 0;
  private dict?: string;
  constructor(
    private readonly dir: string,
    private readonly tag: string,
  ) {}
  add(key: string, verified: string, partial: boolean, packed: string, d: FeedDict) {
    this.hasher.add(key, verified, partial, decodeRows(d, packed));
    this.out.push(companyLine(key, verified, partial, packed));
    if (packed) this.out.push(packed);
    if (++this.count >= PART_COMPANIES) this.flush();
  }
  private flush() {
    if (!this.count) return;
    const name = `v3-part-${this.tag}-${this.parts.length}.txt.br`;
    writeFileSync(join(this.dir, name), fast(this.out.done()));
    this.parts.push(name);
    this.out = new LineBuffer();
    this.count = 0;
  }
  /** Write the dictionary: each list's lines as Buffers, already ending in line breaks. */
  finish(titles: { count: number; bufs: Buffer[] }, places: { count: number; bufs: Buffer[] }): StoreFiles {
    this.flush();
    this.dict = `v3-dict-${this.tag}.txt.br`;
    writeFileSync(join(this.dir, this.dict), fast(Buffer.concat([Buffer.from(`${titles.count}\n`), ...titles.bufs, Buffer.from(`${places.count}\n`), ...places.bufs])));
    return { dict: this.dict, parts: this.parts };
  }
  abandon() {
    for (const f of [...this.parts, ...(this.dict ? [this.dict] : [])]) rmSync(join(this.dir, f), { force: true });
  }
}

/** Delete a store's files (one that turned out wrong, or that a newer one replaced). */
export function removeStore(dir: string, files: StoreFiles) {
  for (const f of [files.dict, ...files.parts]) rmSync(join(dir, f), { force: true });
}

export function readDict(dir: string, file: string): BufferDict {
  const buf = unbrotli(dir, file);
  const list = (from: number): [BufferList, number] => {
    const nl = buf.indexOf(10, from);
    const n = Number(buf.toString("utf8", from, nl));
    if (nl < 0 || !Number.isInteger(n) || n < 0) throw new Error("broken job feed dictionary");
    const start = nl + 1;
    let end = start;
    for (let i = 0; i < n; i++) {
      const at = buf.indexOf(10, end);
      if (at < 0) throw new Error("broken job feed dictionary");
      end = at + 1;
    }
    return [new BufferList(buf.subarray(start, end), n), end];
  };
  const [titles, next] = list(0);
  return { titles, places: list(next)[0] };
}

/** Every company's packed jobs, in key order, one part in memory at a time. `only`: skip the others' jobs. */
export function* readStore(dir: string, parts: string[], only?: (key: string) => boolean): Generator<{ key: string; packed: string }> {
  for (const file of parts) {
    const found: { key: string; packed: string }[] = [];
    let company: ReturnType<typeof parseCompanyLine> | undefined;
    let rows: string[] = [];
    const end = () => {
      if (!only || only(company!.key)) found.push({ key: company!.key, packed: rows.join("\n") });
      company = undefined;
      rows = [];
    };
    forEachLine(unbrotli(dir, file), (line) => {
      if (!company) {
        company = parseCompanyLine(line);
        if (!company.n) end();
      } else {
        rows.push(line);
        if (rows.length === company.n) end();
      }
    });
    if (company) throw new Error("broken job feed part");
    yield* found;
  }
}

/** A downloaded full copy (brotli-compressed compact text) into a new store, decompressed as it's read. */
export async function storeFromSnapshot(dir: string, snapshot: Buffer, tag: string): Promise<StoreResult> {
  const w = new StoreWriter(dir, tag);
  try {
    const lists = { title: new LineBuffer(), place: new LineBuffer() };
    const bufs: { title?: Buffer; place?: Buffer } = {};
    let dict: BufferDict | undefined;
    const verified: Record<string, string> = {};
    const partial: string[] = [];
    const reader = new CompactReader({
      dictLine: (kind, line) => lists[kind].push(line),
      company: (key, v, p, packed) => {
        if (!dict) {
          bufs.title = lists.title.done();
          bufs.place = lists.place.done();
          dict = { titles: new BufferList(bufs.title, lists.title.count), places: new BufferList(bufs.place, lists.place.count) };
        }
        verified[key] = v;
        if (p) partial.push(key);
        w.add(key, v, p, packed, dict);
      },
    });
    await forEachBrotliLine(snapshot, (line) => reader.line(line));
    reader.end();
    bufs.title ??= lists.title.done();
    bufs.place ??= lists.place.done();
    const files = w.finish({ count: lists.title.count, bufs: [bufs.title] }, { count: lists.place.count, bufs: [bufs.place] });
    return { ...files, verified, partial, hash: w.hasher.digest(), dictSize: lists.title.count + lists.place.count, touched: {} };
  } catch (err) {
    w.abandon();
    throw err;
  }
}

const fnv = (s: string) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
};

/** Finds a string's position in a BufferList: an open-addressing table of positions, a few MB for millions. */
class ListIndex {
  private readonly table: Int32Array;
  private readonly mask: number;
  constructor(private readonly list: BufferList) {
    let size = 1024;
    while (size < list.length * 2) size *= 2;
    this.table = new Int32Array(size).fill(-1);
    this.mask = size - 1;
    for (let i = 0; i < list.length; i++) {
      let slot = fnv(list.at(i)!) & this.mask;
      while (this.table[slot] !== -1) slot = (slot + 1) & this.mask;
      this.table[slot] = i;
    }
  }
  find(s: string): number | undefined {
    for (let slot = fnv(s) & this.mask; this.table[slot] !== -1; slot = (slot + 1) & this.mask) if (this.list.at(this.table[slot]!) === s) return this.table[slot];
    return undefined;
  }
}

/** New titles and places from change files, numbered after the dictionary's. */
class Appender implements DictWriter, FeedDict {
  readonly newTitles: string[] = [];
  readonly newPlaces: string[] = [];
  private readonly tIx = new Map<string, number>();
  private readonly pIx = new Map<string, number>();
  readonly titles: FeedDict["titles"];
  readonly places: FeedDict["places"];
  constructor(private readonly base: BufferDict) {
    const view = (b: BufferList, extra: string[]) => ({
      get length() {
        return b.length + extra.length;
      },
      at: (i: number) => (i < b.length ? b.at(i) : extra[i - b.length]),
    });
    this.titles = view(base.titles, this.newTitles);
    this.places = view(base.places, this.newPlaces);
  }
  private baseTitles?: ListIndex;
  private basePlaces?: ListIndex;
  private add(list: string[], ix: Map<string, number>, base: BufferList, known: ListIndex, s: string) {
    let i = known.find(s) ?? ix.get(s);
    if (i === undefined) {
      i = base.length + list.length;
      list.push(s);
      ix.set(s, i);
    }
    return i;
  }
  title(s: string) {
    return this.add(this.newTitles, this.tIx, this.base.titles, (this.baseTitles ??= new ListIndex(this.base.titles)), s);
  }
  place(s: string) {
    return this.add(this.newPlaces, this.pIx, this.base.places, (this.basePlaces ??= new ListIndex(this.base.places)), s);
  }
}

type Op = { remove?: string[]; add?: FeedRow[] } | null;
const lines = (list: string[]) => (list.length ? [Buffer.from(`${list.join("\n")}\n`, "utf8")] : []);

/** The store after `diffs` (in order), as a new store. */
export function storeApplyDiffs(dir: string, from: StoreFiles & { verified: Record<string, string>; partial: string[] }, diffs: FeedDiff[], tag: string): StoreResult {
  // When each company was read, which are partial, and what happens to each company's jobs, in order.
  const verified = { ...from.verified };
  let partial = new Set(from.partial);
  const ops = new Map<string, Op[]>();
  const touched: Record<string, number> = {};
  const push = (key: string, op: Op) => {
    const list = ops.get(key);
    if (list) list.push(op);
    else ops.set(key, [op]);
  };
  for (const d of diffs) {
    for (const key of d.removed) {
      delete verified[key];
      partial.delete(key);
      push(key, null);
    }
    for (const [key, change] of Object.entries(d.changes)) {
      push(key, change);
      if (!(key in verified)) verified[key] = "";
      touched[key] = d.seq;
    }
    if (d.partial) partial = new Set(d.partial);
    const stale = new Set(d.stale);
    for (const key of Object.keys(verified)) {
      if (d.verified_on[key]) verified[key] = d.verified_on[key]!;
      else if (!stale.has(key)) verified[key] = d.date;
    }
  }

  const base = readDict(dir, from.dict);
  const dict = new Appender(base);
  const w = new StoreWriter(dir, tag);
  const emit = (key: string, packed: string | undefined) => {
    let p = packed;
    for (const op of ops.get(key) ?? []) {
      if (op === null) {
        p = undefined;
        continue;
      }
      const gone = new Set(op.remove ?? []);
      const kept = p ? p.split("\n").filter((l) => !gone.has(idOfLine(l))) : [];
      for (const r of op.add ?? []) kept.push(encodeRow(dict, r));
      p = kept.join("\n");
    }
    if (p !== undefined && key in verified) w.add(key, verified[key]!, partial.has(key), p, dict);
  };
  try {
    // New companies merge into the old ones in key order.
    const added = Object.keys(verified)
      .filter((k) => !(k in from.verified))
      .sort();
    let a = 0;
    for (const { key, packed } of readStore(dir, from.parts)) {
      while (a < added.length && added[a]! < key) emit(added[a++]!, undefined);
      emit(key, packed);
    }
    while (a < added.length) emit(added[a++]!, undefined);
    const files = w.finish({ count: dict.titles.length, bufs: [base.titles.buf, ...lines(dict.newTitles)] }, { count: dict.places.length, bufs: [base.places.buf, ...lines(dict.newPlaces)] });
    return { ...files, verified, partial: [...partial], hash: w.hasher.digest(), dictSize: dict.titles.length + dict.places.length, touched };
  } catch (err) {
    w.abandon();
    throw err;
  }
}

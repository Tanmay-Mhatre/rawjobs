import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { gunzip, gzip } from "node:zlib";
import type { HttpCache } from "./http";

const gunzipAsync = promisify(gunzip);
const gzipAsync = promisify(gzip);

/** Responses bigger than this aren't kept (a 6 MB Lever board still is). */
const MAX_BODY_BYTES = 12_000_000;
/** Entries not used for this long are dropped on save. */
const KEEP_DAYS = 30;
/** Bodies nothing points to are removed at most this often (it lists the whole folder): the time is kept in PRUNED_AT. */
const PRUNE_EVERY_MS = 86_400_000;
const PRUNED_AT = "pruned-at";

type Entry = { etag: string; file: string; usedAt: number };

/**
 * HttpCache on disk: data/cache/http/index.json (url -> ETag) plus one gzipped body per URL.
 * A body is zipped and written off the main thread, and read (and unzipped) only when the server answers 304.
 * Call save() as a scan goes (cheap: only a changed index is written), and when it ends await flush()
 * then save({ prune: true }).
 */
export class FileHttpCache implements HttpCache {
  private readonly index: Map<string, Entry>;
  /** The index changed since it was last written. */
  private dirty = false;
  /** Bodies being written, by file: the index points at one only once it's on disk. */
  private readonly writing = new Map<string, Promise<void>>();

  constructor(private readonly dir: string) {
    const file = join(dir, "index.json");
    let saved: Record<string, Entry> = {};
    try {
      if (existsSync(file)) saved = JSON.parse(readFileSync(file, "utf8")) as Record<string, Entry>;
    } catch {
      // A broken index only costs one full download per board.
    }
    this.index = new Map(Object.entries(saved));
  }

  /** Just the ETag: the body is read by load(), on a 304. */
  get(url: string): { etag: string } | undefined {
    const e = this.index.get(url);
    return e ? { etag: e.etag } : undefined;
  }

  async load(url: string): Promise<string | undefined> {
    const e = this.index.get(url);
    if (!e) return undefined;
    try {
      const body = (await gunzipAsync(await readFile(join(this.dir, e.file)))).toString("utf8");
      e.usedAt = Date.now();
      this.dirty = true;
      return body;
    } catch {
      this.index.delete(url);
      this.dirty = true;
      return undefined;
    }
  }

  set(url: string, etag: string, body: string): void {
    if (body.length > MAX_BODY_BYTES) return;
    const file = `${createHash("sha1").update(url).digest("hex")}.gz`;
    // After any earlier write of the same file, so the last body set is the one kept.
    const write: Promise<void> = (this.writing.get(file) ?? Promise.resolve())
      .then(async () => {
        const zipped = await gzipAsync(body);
        await mkdir(this.dir, { recursive: true });
        await writeFile(join(this.dir, file), zipped);
        this.index.set(url, { etag, file, usedAt: Date.now() });
        this.dirty = true;
      })
      .catch(() => {
        // Not kept: the next fetch downloads the board in full.
      })
      .finally(() => {
        if (this.writing.get(file) === write) this.writing.delete(file);
      });
    this.writing.set(file, write);
  }

  /** Wait for the bodies still being written (and so their index entries). */
  async flush(): Promise<void> {
    while (this.writing.size) await Promise.all(this.writing.values());
  }

  /**
   * Write the index when it changed, dropping entries unused for KEEP_DAYS. With prune (at the end of
   * a scan), also remove the bodies nothing points to, once a day at most: that lists the whole folder.
   */
  save(opts: { now?: number; prune?: boolean } = {}): void {
    const now = opts.now ?? Date.now();
    for (const [url, e] of this.index)
      if (now - e.usedAt > KEEP_DAYS * 86_400_000) {
        this.index.delete(url);
        this.dirty = true;
      }
    if (this.dirty) {
      mkdirSync(this.dir, { recursive: true });
      writeFileSync(join(this.dir, "index.json"), JSON.stringify(Object.fromEntries(this.index)));
      this.dirty = false;
    }
    if (!opts.prune || !existsSync(this.dir) || now - this.prunedAt() < PRUNE_EVERY_MS) return;
    const live = new Set([...this.index.values()].map((e) => e.file));
    for (const f of readdirSync(this.dir)) if (f.endsWith(".gz") && !live.has(f) && !this.writing.has(f)) rmSync(join(this.dir, f), { force: true });
    writeFileSync(join(this.dir, PRUNED_AT), String(now));
  }

  private prunedAt(): number {
    try {
      return Number(readFileSync(join(this.dir, PRUNED_AT), "utf8")) || 0;
    } catch {
      return 0;
    }
  }
}

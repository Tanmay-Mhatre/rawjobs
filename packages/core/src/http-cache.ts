import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { gunzip, gzipSync } from "node:zlib";
import type { HttpCache } from "./http";

const gunzipAsync = promisify(gunzip);

/** Responses bigger than this aren't kept (a 6 MB Lever board still is). */
const MAX_BODY_BYTES = 12_000_000;
/** Entries not used for this long are dropped on save. */
const KEEP_DAYS = 30;

type Entry = { etag: string; file: string; usedAt: number };

/**
 * HttpCache on disk: data/cache/http/index.json (url -> ETag) plus one gzipped body per URL.
 * A body is read (and unzipped, off the main thread) only when the server answers 304.
 * Call save() as a scan goes (cheap: only a changed index is written) and save({ prune: true }) when it ends.
 */
export class FileHttpCache implements HttpCache {
  private readonly index: Map<string, Entry>;
  /** The index changed since it was last written. */
  private dirty = false;

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
    mkdirSync(this.dir, { recursive: true });
    writeFileSync(join(this.dir, file), gzipSync(body));
    this.index.set(url, { etag, file, usedAt: Date.now() });
    this.dirty = true;
  }

  /**
   * Write the index when it changed, dropping entries unused for KEEP_DAYS. With prune (once, at the
   * end of a scan), also remove the bodies nothing points to: that lists the whole folder.
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
    if (!opts.prune || !existsSync(this.dir)) return;
    const live = new Set([...this.index.values()].map((e) => e.file));
    for (const f of readdirSync(this.dir)) if (f.endsWith(".gz") && !live.has(f)) rmSync(join(this.dir, f), { force: true });
  }
}

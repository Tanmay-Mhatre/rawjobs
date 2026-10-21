import { existsSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FileHttpCache } from "../src/http-cache";

let dir: string;
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("FileHttpCache", () => {
  it("keeps a body by its ETag across runs, once saved, and reads the body only when asked", async () => {
    dir = mkdtempSync(join(tmpdir(), "rawjobs-cache-"));
    const a = new FileHttpCache(dir);
    expect(a.get("https://boards.example/acme")).toBeUndefined();
    a.set("https://boards.example/acme", 'W/"1"', '{"jobs":[]}');
    await a.flush();
    a.save();
    const b = new FileHttpCache(dir);
    expect(b.get("https://boards.example/acme")).toEqual({ etag: 'W/"1"' });
    await expect(b.load("https://boards.example/acme")).resolves.toBe('{"jobs":[]}');
  });

  it("drops entries unused for a month, with their bodies (on a pruning save)", async () => {
    dir = mkdtempSync(join(tmpdir(), "rawjobs-cache-"));
    const c = new FileHttpCache(dir);
    c.set("https://boards.example/old", "e1", "old");
    c.set("https://boards.example/new", "e2", "new");
    await c.flush();
    c.save({ now: Date.now() + 31 * 86_400_000, prune: true });
    const again = new FileHttpCache(dir);
    expect(again.get("https://boards.example/old")).toBeUndefined();
    expect(readdirSync(dir).filter((f) => f.endsWith(".gz"))).toHaveLength(0);
  });

  it("writes the index only when it changed", async () => {
    dir = mkdtempSync(join(tmpdir(), "rawjobs-cache-"));
    const c = new FileHttpCache(dir);
    c.set("https://boards.example/acme", "e", "body");
    await c.flush();
    c.save();
    const index = join(dir, "index.json");
    rmSync(index);
    c.save();
    expect(existsSync(index)).toBe(false);
    c.set("https://boards.example/beta", "e", "body");
    await c.flush();
    c.save();
    expect(statSync(index).size).toBeGreaterThan(0);
  });

  it("treats a broken index, or a body that's gone, as not cached", async () => {
    dir = mkdtempSync(join(tmpdir(), "rawjobs-cache-"));
    writeFileSync(join(dir, "index.json"), "{ broken");
    const c = new FileHttpCache(dir);
    expect(c.get("https://boards.example/acme")).toBeUndefined();
    c.set("https://boards.example/acme", "e", "body");
    await c.flush();
    for (const f of readdirSync(dir)) if (f.endsWith(".gz")) rmSync(join(dir, f));
    await expect(c.load("https://boards.example/acme")).resolves.toBeUndefined();
    expect(c.get("https://boards.example/acme")).toBeUndefined();
    c.save();
    expect(existsSync(join(dir, "index.json"))).toBe(true);
  });

  it("points the index at a body only once it's on disk, and keeps the last one set", async () => {
    dir = mkdtempSync(join(tmpdir(), "rawjobs-cache-"));
    const c = new FileHttpCache(dir);
    c.set("https://boards.example/acme", "e1", "first");
    c.set("https://boards.example/acme", "e2", "second");
    expect(c.get("https://boards.example/acme")).toBeUndefined();
    await c.flush();
    expect(c.get("https://boards.example/acme")).toEqual({ etag: "e2" });
    await expect(c.load("https://boards.example/acme")).resolves.toBe("second");
  });

  it("removes unused bodies once a day at most", async () => {
    dir = mkdtempSync(join(tmpdir(), "rawjobs-cache-"));
    const c = new FileHttpCache(dir);
    const now = Date.now();
    c.save({ now, prune: true });
    writeFileSync(join(dir, "orphan.gz"), "x");
    c.save({ now: now + 3_600_000, prune: true });
    expect(existsSync(join(dir, "orphan.gz"))).toBe(true);
    c.save({ now: now + 25 * 3_600_000, prune: true });
    expect(existsSync(join(dir, "orphan.gz"))).toBe(false);
  });
});

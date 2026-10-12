import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FileHttpCache } from "../src/http-cache";

let dir: string;
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("FileHttpCache", () => {
  it("keeps a body by its ETag across runs, once saved", () => {
    dir = mkdtempSync(join(tmpdir(), "rawjobs-cache-"));
    const a = new FileHttpCache(dir);
    expect(a.get("https://boards.example/acme")).toBeUndefined();
    a.set("https://boards.example/acme", 'W/"1"', '{"jobs":[]}');
    a.save();
    expect(new FileHttpCache(dir).get("https://boards.example/acme")).toEqual({ etag: 'W/"1"', body: '{"jobs":[]}' });
  });

  it("drops entries unused for a month, with their bodies", () => {
    dir = mkdtempSync(join(tmpdir(), "rawjobs-cache-"));
    const c = new FileHttpCache(dir);
    c.set("https://boards.example/old", "e1", "old");
    c.set("https://boards.example/new", "e2", "new");
    c.save(Date.now() + 31 * 86_400_000);
    const again = new FileHttpCache(dir);
    expect(again.get("https://boards.example/old")).toBeUndefined();
    expect(readdirSync(dir).filter((f) => f.endsWith(".gz"))).toHaveLength(0);
  });

  it("treats a broken index, or a body that's gone, as not cached", () => {
    dir = mkdtempSync(join(tmpdir(), "rawjobs-cache-"));
    writeFileSync(join(dir, "index.json"), "{ broken");
    const c = new FileHttpCache(dir);
    expect(c.get("https://boards.example/acme")).toBeUndefined();
    c.set("https://boards.example/acme", "e", "body");
    for (const f of readdirSync(dir)) if (f.endsWith(".gz")) rmSync(join(dir, f));
    expect(c.get("https://boards.example/acme")).toBeUndefined();
    c.save();
    expect(existsSync(join(dir, "index.json"))).toBe(true);
  });
});

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { acquireLock, lockHolder, releaseLock, tryWithLock } from "../src/lock";

const root = resolve(__dirname, "../../..");
const dir = () => mkdtempSync(join(tmpdir(), "rj-lock-"));
const age = (path: string, ms: number) => {
  const t = new Date(Date.now() - ms);
  utimesSync(path, t, t);
};

afterEach(() => vi.useRealTimers());

describe("acquireLock", () => {
  it("holds a lock until it's released, and only one at a time", () => {
    const path = join(dir(), "x.lock");
    const lock = acquireLock(path);
    expect(lock).not.toBeNull();
    expect(readFileSync(path, "utf8")).toBe(String(process.pid));
    // The same process asking again gets it (a scan's own retry).
    expect(acquireLock(path)).not.toBeNull();
    lock!.release();
    expect(existsSync(path)).toBe(false);
  });

  it("is refused while a live process holds it, and takes over one whose process is gone", () => {
    const path = join(dir(), "x.lock");
    writeFileSync(path, String(process.ppid));
    expect(acquireLock(path)).toBeNull();
    expect(lockHolder(path)).toBe(process.ppid);
    writeFileSync(path, "999999999");
    expect(lockHolder(path)).toBeUndefined();
    expect(acquireLock(path)).not.toBeNull();
    releaseLock(path);
  });

  it("treats an empty lock file that was just created as held: its process is about to write its id", () => {
    // Without this, a second process reading between the other's create and write removed a live lock.
    const path = join(dir(), "x.lock");
    writeFileSync(path, "");
    expect(acquireLock(path)).toBeNull();
    expect(readFileSync(path, "utf8")).toBe("");
    // Still empty seconds later: its process died between the two steps.
    age(path, 10_000);
    expect(acquireLock(path)).not.toBeNull();
    releaseLock(path);
  });

  it("takes over a lock nobody touched for staleMs, even when its process id is in use again", () => {
    const path = join(dir(), "x.lock");
    writeFileSync(path, String(process.ppid));
    age(path, 3 * 60_000);
    expect(acquireLock(path, { staleMs: 2 * 60_000 })).not.toBeNull();
    releaseLock(path);
  });

  it("release leaves alone a lock another process holds now", () => {
    const path = join(dir(), "x.lock");
    acquireLock(path);
    writeFileSync(path, String(process.ppid));
    releaseLock(path);
    expect(readFileSync(path, "utf8")).toBe(String(process.ppid));
  });

  it("keeps every lock it holds fresh, not just the last one", () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const d = dir();
    const a = join(d, "a.lock");
    const b = join(d, "b.lock");
    acquireLock(a, { beatMs: 1000 });
    acquireLock(b, { beatMs: 1000 });
    age(a, 60_000);
    age(b, 60_000);
    vi.advanceTimersByTime(1000);
    expect(Date.now() - statSync(a).mtimeMs).toBeLessThan(5_000);
    expect(Date.now() - statSync(b).mtimeMs).toBeLessThan(5_000);
    releaseLock(a);
    releaseLock(b);
  });
});

describe("tryWithLock", () => {
  it("lets go of the lock when fn throws", async () => {
    const path = join(dir(), "x.lock");
    await expect(tryWithLock(path, () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    expect(existsSync(path)).toBe(false);
  });

  it("waits up to waitMs for a busy lock, then answers null without running fn", async () => {
    const path = join(dir(), "x.lock");
    writeFileSync(path, String(process.ppid));
    const fn = vi.fn();
    const started = Date.now();
    expect(await tryWithLock(path, fn, { waitMs: 500 })).toBeNull();
    expect(Date.now() - started).toBeGreaterThanOrEqual(400);
    expect(fn).not.toHaveBeenCalled();
  });
});

describe("processes racing for one lock", () => {
  it("never lets two live processes hold it at once", async () => {
    const d = dir();
    const path = join(d, "race.lock");
    const at = Date.now() + 4_000;
    // Each child waits for the same moment, tries once, holds a winning lock for 1.5 s, and says when it had it.
    const script = `
      import { acquireLock } from ${JSON.stringify(pathToFileURL(join(root, "packages/core/src/lock.ts")).href)};
      while (Date.now() < ${at}) {}
      const lock = acquireLock(${JSON.stringify(path)});
      const from = Date.now();
      if (lock) { const until = from + 1500; while (Date.now() < until) {} lock.release(); }
      process.stdout.write(lock ? from + " " + Date.now() : "-");`;
    const runs = await Promise.all(
      Array.from(
        { length: 6 },
        () =>
          new Promise<string>((done) => {
            const child = spawn(process.execPath, [join(root, "node_modules/tsx/dist/cli.mjs"), "--eval", script], { cwd: root, windowsHide: true });
            let out = "";
            child.stdout.on("data", (b) => (out += b));
            child.on("close", () => done(out));
          }),
      ),
    );
    const held = runs.filter((r) => r !== "-").map((r) => r.split(" ").map(Number) as [number, number]);
    expect(held.length).toBeGreaterThanOrEqual(1);
    for (const [i, a] of held.entries()) for (const b of held.slice(i + 1)) expect(a[0] < b[1] && b[0] < a[1]).toBe(false);
  });
});

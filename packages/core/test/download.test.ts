import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DownloadError, downloadVerified, fetchToFile, withBudget } from "../src/download";

const body = Buffer.from("0123456789".repeat(100));
const sha = createHash("sha256").update(body).digest("hex");
const tmp = () => mkdtempSync(join(tmpdir(), "rawjobs-dl-"));

/** A server that honours Range requests; `cutAt` drops the connection after that many bytes. */
function server(opts: { cutAt?: number; ignoreRange?: boolean } = {}) {
  const ranges: (string | undefined)[] = [];
  const get = (async (_url: string, init?: RequestInit) => {
    const range = (init?.headers as Record<string, string> | undefined)?.range;
    ranges.push(range);
    const from = range && !opts.ignoreRange ? Number(/bytes=(\d+)-/.exec(range)![1]) : 0;
    const rest = body.subarray(from);
    const cut = opts.cutAt;
    opts.cutAt = undefined;
    let sent = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(c) {
        if (sent) return cut === undefined ? c.close() : c.error(new Error("socket hang up"));
        sent = true;
        c.enqueue(new Uint8Array(cut === undefined ? rest : rest.subarray(0, cut)));
      },
    });
    return new Response(stream, { status: from ? 206 : 200 });
  }) as typeof fetch;
  return { get, ranges };
}

describe("resumable downloads", () => {
  it("continues a dropped download where it stopped, with a Range request", async () => {
    const dir = tmp();
    const s = server({ cutAt: 400 });
    await expect(downloadVerified(s.get, "https://x/feed.br", sha, dir)).rejects.toMatchObject({ transient: true });
    expect(statSync(join(dir, `${sha}.part`)).size).toBe(400);
    expect((await downloadVerified(s.get, "https://x/feed.br", sha, dir)).equals(body)).toBe(true);
    expect(s.ranges).toEqual([undefined, "bytes=400-"]);
  });

  it("starts afresh when the server ignores the Range and sends the whole file", async () => {
    const dir = tmp();
    writeFileSync(join(dir, `${sha}.part`), body.subarray(0, 300));
    const s = server({ ignoreRange: true });
    expect((await downloadVerified(s.get, "https://x/f", sha, dir)).equals(body)).toBe(true);
  });

  it("keeps a checked file, so the next sync needs no network for it", async () => {
    const dir = tmp();
    await downloadVerified(server().get, "https://x/f", sha, dir);
    const offline = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    expect((await downloadVerified(offline, "https://x/f", sha, dir)).equals(body)).toBe(true);
  });

  it("throws away a file that doesn't match its checksum, and says it isn't worth retrying as is", async () => {
    const dir = tmp();
    const err = await downloadVerified(server().get, "https://x/f", "a".repeat(64), dir).catch((e) => e);
    expect(err).toBeInstanceOf(DownloadError);
    expect(err.transient).toBe(false);
    expect(existsSync(join(dir, `${"a".repeat(64)}.part`))).toBe(false);
  });

  it("gives up only when no data arrives for the idle time", async () => {
    const dir = tmp();
    const stalled = (async (_u: string, init?: RequestInit) =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(c) {
            c.enqueue(new Uint8Array(body.subarray(0, 10)));
            init?.signal?.addEventListener("abort", () => c.error(init.signal!.reason));
          },
        }),
      )) as typeof fetch;
    const err = await fetchToFile(stalled, "https://x/f", join(dir, "f.part"), { idleMs: 50 }).catch((e) => e);
    expect(err).toBeInstanceOf(DownloadError);
    expect(err.message).toMatch(/no data/);
    expect(readFileSync(join(dir, "f.part")).length).toBe(10);
  });

  it("treats 5xx and 429 as worth retrying, 404 as not", async () => {
    const status = (n: number) => (async () => new Response("", { status: n })) as unknown as typeof fetch;
    for (const [n, transient] of [
      [503, true],
      [429, true],
      [404, false],
    ] as const)
      await expect(fetchToFile(status(n), "https://x/f", join(tmp(), "f.part"))).rejects.toMatchObject({ transient });
  });
});

describe("withBudget", () => {
  it("answers with the fallback past the budget, and the work sees it's expired", async () => {
    let sawExpired: boolean | undefined;
    const r = await withBudget(
      20,
      async (expired) => {
        await new Promise((res) => setTimeout(res, 60));
        sawExpired = expired();
        return "applied";
      },
      () => "late",
    );
    expect(r).toBe("late");
    await new Promise((res) => setTimeout(res, 80));
    expect(sawExpired).toBe(true);
  });

  it("returns the work's answer when it finishes in time", async () => {
    expect(
      await withBudget(
        1000,
        async () => "applied",
        () => "late",
      ),
    ).toBe("applied");
  });
});

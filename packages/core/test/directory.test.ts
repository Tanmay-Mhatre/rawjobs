import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { contributeUrl, directoryStatus, directoryUrl, queueContributions, sendContributions, updateDirectory } from "../src/directory";
import { suggestPoolSize } from "../src/scope";
import { testDataKey } from "./helpers";

const key = testDataKey();
afterAll(key.restore);

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "rawjobs-dir-"));
  process.env.RAWJOBS_DIRECTORY_URL = "https://example.test/latest";
  process.env.RAWJOBS_CONTRIBUTE_URL = "https://inbox.example.test";
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.RAWJOBS_DIRECTORY_URL;
  delete process.env.RAWJOBS_CONTRIBUTE_URL;
  delete process.env.JOBHUNTER_DIRECTORY_URL;
  delete process.env.JOBHUNTER_CONTRIBUTE_URL;
});

describe("directory settings", () => {
  it("reads RAWJOBS_ first, then the JOBHUNTER_ names from before the rename", () => {
    delete process.env.RAWJOBS_DIRECTORY_URL;
    process.env.JOBHUNTER_DIRECTORY_URL = "https://old.example.test/latest/";
    expect(directoryUrl()).toBe("https://old.example.test/latest");
    process.env.JOBHUNTER_CONTRIBUTE_URL = "https://old-inbox.example.test";
    expect(contributeUrl()).toBe("https://inbox.example.test");
  });
});

const directory = gzipSync(JSON.stringify({ generated_at: "2026-10-06T00:00:00Z", count: 2, companies: [{ key: "lever:a" }, { key: "lever:b" }] }));
const index = gzipSync(JSON.stringify({ generated_at: "2026-10-06T00:00:00Z", count: 0, companies: [] }));
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const manifest = (version: string, badSum = false) => ({
  version,
  generated_at: "2026-10-06T00:00:00Z",
  companies: 2,
  indexed: 0,
  files: {
    "directory.json.gz": { sha256: badSum ? "0".repeat(64) : sha(directory), bytes: directory.length },
    "index.json.gz": { sha256: sha(index), bytes: index.length },
  },
});
const server = (m: object) =>
  (async (url: string) => {
    if (url.endsWith("manifest.json")) return new Response(JSON.stringify(m));
    if (url.endsWith("manifest.json.sig")) return new Response(key.sign(JSON.stringify(m)));
    if (url.endsWith("directory.json.gz")) return new Response(directory);
    if (url.endsWith("index.json.gz")) return new Response(index);
    return new Response("", { status: 404 });
  }) as unknown as typeof fetch;

describe("updateDirectory", () => {
  it("downloads, verifies and installs a newer directory, then reports up to date", async () => {
    const r = await updateDirectory(dir, { fetchImpl: server(manifest("v1")) });
    expect(r).toMatchObject({ updated: true, version: "v1", companies: 2 });
    expect(JSON.parse(readFileSync(join(dir, "catalog", "directory.json"), "utf8")).count).toBe(2);
    expect(directoryStatus(dir).local?.version).toBe("v1");
    expect(await updateDirectory(dir, { fetchImpl: server(manifest("v1")) })).toMatchObject({ updated: false, message: "Already up to date." });
  });

  it("keeps the current copy when a file doesn't match its checksum", async () => {
    const r = await updateDirectory(dir, { fetchImpl: server(manifest("v2", true)) });
    expect(r.updated).toBe(false);
    expect(r.message).toMatch(/checksum/);
    expect(existsSync(join(dir, "catalog", "directory.json"))).toBe(false);
  });
});

describe("updateDirectory with a tampered manifest", () => {
  it("refuses file names that would leave the catalog folder, before downloading anything", async () => {
    const calls: string[] = [];
    const evil = { ...manifest("v3"), files: { "../../bin/rawjobs.gz": { sha256: sha(directory), bytes: directory.length } } };
    const fetchImpl = (async (url: string) => {
      calls.push(url);
      if (url.endsWith("manifest.json.sig")) return new Response(key.sign(JSON.stringify(evil)));
      return url.endsWith("manifest.json") ? new Response(JSON.stringify(evil)) : new Response(directory);
    }) as unknown as typeof fetch;
    const r = await updateDirectory(dir, { fetchImpl });
    expect(r).toMatchObject({ updated: false, message: expect.stringMatching(/unsafe file/) });
    expect(calls.sort()).toEqual(["https://example.test/latest/manifest.json", "https://example.test/latest/manifest.json.sig"]);
    expect(existsSync(join(dir, "bin"))).toBe(false);
  });
});

describe("updateDirectory signatures", () => {
  const serve = (sig: (body: string) => Response) =>
    (async (url: string) => {
      const body = JSON.stringify(manifest("v4"));
      if (url.endsWith("manifest.json")) return new Response(body);
      if (url.endsWith("manifest.json.sig")) return sig(body);
      return new Response(url.endsWith("directory.json.gz") ? directory : index);
    }) as unknown as typeof fetch;

  it("refuses a manifest without a signature", async () => {
    const r = await updateDirectory(dir, { fetchImpl: serve(() => new Response("", { status: 404 })) });
    expect(r).toMatchObject({ updated: false, message: expect.stringMatching(/signature isn't valid/) });
    expect(existsSync(join(dir, "catalog", "directory.json"))).toBe(false);
  });

  it("refuses a manifest signed by another key, or changed after signing", async () => {
    const other = testDataKey();
    const forged = other.sign(JSON.stringify(manifest("v4")));
    other.restore();
    expect((await updateDirectory(dir, { fetchImpl: serve(() => new Response(forged)) })).updated).toBe(false);
    expect((await updateDirectory(dir, { fetchImpl: serve((b) => new Response(key.sign(b.replace("v4", "v5")))) })).updated).toBe(false);
    expect(existsSync(join(dir, "catalog", "directory.json"))).toBe(false);
  });
});

describe("sharing additions", () => {
  it("queues boards once, sends them, and keeps them when the inbox is down", async () => {
    expect(
      queueContributions(dir, [
        { ats: "lever", slug: "acme" },
        { ats: "lever", slug: "ACME" },
      ]),
    ).toBe(1);
    const down = (async () => new Response("", { status: 503 })) as unknown as typeof fetch;
    expect((await sendContributions(dir, { fetchImpl: down })).sent).toBe(0);
    expect(directoryStatus(dir).outbox).toBe(1);

    const bodies: unknown[] = [];
    const up = (async (_u: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return new Response("{}", { status: 202 });
    }) as unknown as typeof fetch;
    expect(await sendContributions(dir, { fetchImpl: up })).toMatchObject({ sent: 1 });
    expect(bodies[0]).toMatchObject({ boards: [{ ats: "lever", slug: "acme" }] });
    expect(directoryStatus(dir).outbox).toBe(0);
  });

  it("drops waiting boards without sending them once sharing is turned off", async () => {
    queueContributions(dir, [{ ats: "lever", slug: "acme" }]);
    let calls = 0;
    const up = (async () => {
      calls++;
      return new Response("{}", { status: 202 });
    }) as unknown as typeof fetch;
    expect(await sendContributions(dir, { fetchImpl: up, enabled: false })).toMatchObject({ sent: 0 });
    expect(calls).toBe(0);
    expect(directoryStatus(dir).outbox).toBe(0);
  });

  it("does nothing when no inbox is configured", async () => {
    process.env.RAWJOBS_CONTRIBUTE_URL = "";
    queueContributions(dir, [{ ats: "lever", slug: "acme" }]);
    expect((await sendContributions(dir)).message).toMatch(/isn't set up/);
  });
});

describe("suggestPoolSize", () => {
  const write = (name: string, body: unknown) => {
    mkdirSync(join(dir, "catalog"), { recursive: true });
    writeFileSync(join(dir, "catalog", name), JSON.stringify(body));
  };
  const entry = (slug: string, indexed?: boolean) => ({ key: `greenhouse:${slug}`, name: slug, ats: "greenhouse", slug, ...(indexed ? { indexed } : {}) });

  it("counts the index plus the directory companies without job rows, as a suggestion request checks them", () => {
    write("index.json", { generated_at: "2026-10-07T09:55:42.522Z", count: 3, companies: [{}, {}, {}] });
    write("directory.json", { count: 4, companies: [entry("a", true), entry("b", true), entry("c"), entry("d")] });
    write("additions.json", { companies: [entry("e"), entry("c")] });
    expect(suggestPoolSize(dir)).toBe(3 + 3);
  });

  it("is null without an index, or when its head doesn't say how many", () => {
    expect(suggestPoolSize(dir)).toBeNull();
    write("index.json", { companies: [] });
    expect(suggestPoolSize(dir)).toBeNull();
  });
});

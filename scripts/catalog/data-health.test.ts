import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { checkSharedData, reportMarkdown } from "./data-health";

const NOW = Date.parse("2026-10-12T12:00:00Z");
const DAY = 86_400_000;
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const pub = publicKey.export({ type: "spki", format: "der" }).toString("base64");
const sigOf = (body: string) => sign(null, Buffer.from(body), privateKey).toString("base64");
const ago = (days: number) => new Date(NOW - days * DAY).toISOString();

/** A data repo as the releases serve it: files by URL; overrides replace or (null) remove one. */
function repo(over: Record<string, string | null> = {}) {
  const dir = JSON.stringify({ generated_at: ago(2), files: { "directory.json.gz": {}, "index.json.gz": {} } });
  const v2 = JSON.stringify({ generated_at: ago(0.3), snapshot: { file: "jobs-v2-snapshot-9.json.br" }, diffs: [{ file: "jobs-v2-diff-10.json.br" }] });
  const v3 = JSON.stringify({ generated_at: ago(0.3), snapshot: { file: "jobs-v3-snapshot-9.txt.br" }, diffs: [{ file: "jobs-v3-diff-10.json.br" }] });
  const v1 = JSON.stringify({ generated_at: ago(0.3) });
  const files: Record<string, string | null> = {
    "D/manifest.json": dir,
    "D/manifest.json.sig": sigOf(dir),
    "D/directory.json.gz": "x",
    "D/index.json.gz": "x",
    "F/jobs-v3-manifest.json": v3,
    "F/jobs-v3-manifest.json.sig": sigOf(v3),
    "F/jobs-v3-snapshot-9.txt.br": "x",
    "F/jobs-v3-diff-10.json.br": "x",
    "F/jobs-v2-manifest.json": v2,
    "F/jobs-v2-manifest.json.sig": sigOf(v2),
    "F/jobs-v2-snapshot-9.json.br": "x",
    "F/jobs-v2-diff-10.json.br": "x",
    "F/jobs-manifest.json": v1,
    "F/jobs-manifest.json.sig": sigOf(v1),
    ...over,
  };
  return (async (url: string) => {
    const body = files[url];
    return body == null ? new Response("", { status: 404 }) : new Response(body);
  }) as unknown as typeof fetch;
}
const check = (fetchImpl: typeof fetch) => checkSharedData({ publicKey: pub, directoryUrl: "D", feedUrl: "F", fetchImpl, now: NOW });

describe("the shared data health check", () => {
  it("is healthy when everything is signed, fresh and present", async () => {
    const r = await check(repo());
    expect(r.problems).toEqual([]);
    expect(r.checked).toHaveLength(4);
    expect(reportMarkdown(r)).toMatch(/healthy/);
  });

  it("spots a missing signature, and one that doesn't match (an upload cut off between the two)", async () => {
    const other = JSON.stringify({ generated_at: ago(0.1) });
    const r = await check(repo({ "D/manifest.json.sig": null, "F/jobs-v2-manifest.json.sig": sigOf(other) }));
    expect(r.problems).toEqual([expect.stringMatching(/`manifest.json` has no signature/), expect.stringMatching(/`jobs-v2-manifest.json`'s signature doesn't match/)]);
  });

  it("spots data too old to be current: a schedule that didn't run", async () => {
    const dir = JSON.stringify({ generated_at: ago(10), files: {} });
    // The feed is rebuilt every 6 hours: 18 hours old means three runs went missing.
    const v3 = JSON.stringify({ generated_at: ago(0.75), diffs: [] });
    const r = await check(repo({ "D/manifest.json": dir, "D/manifest.json.sig": sigOf(dir), "F/jobs-v3-manifest.json": v3, "F/jobs-v3-manifest.json.sig": sigOf(v3) }));
    expect(r.problems).toEqual([expect.stringMatching(/`manifest.json` is 10\.0 days old/), expect.stringMatching(/`jobs-v3-manifest.json` is 0\.8 days old \(expected under 0\.5\)/)]);
  });

  it("spots files a manifest lists that aren't there, and a manifest that can't be downloaded", async () => {
    const r = await check(repo({ "D/index.json.gz": null, "F/jobs-manifest.json": null }));
    expect(r.problems).toEqual([expect.stringMatching(/`index.json.gz`, listed in `manifest.json`, is missing/), expect.stringMatching(/`jobs-manifest.json` can't be downloaded \(HTTP 404\)/)]);
    expect(reportMarkdown(r)).toMatch(/has a problem/);
  });
});

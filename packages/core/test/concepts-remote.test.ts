import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { conceptsVersion, namesTopic, setConcepts } from "../src/concepts";
import { isConceptsFile, loadConcepts } from "../src/concepts-remote";

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const file = { version: "2026-10-19", concepts: { payments: ["payment orchestration"] } };
const body = JSON.stringify(file);
const sig = sign(null, Buffer.from(body), privateKey).toString("base64");
const serve = (ok = true) => (async (url: string) => (ok ? new Response(url.endsWith(".sig") ? sig : body) : new Response("", { status: 503 }))) as unknown as typeof fetch;

afterEach(() => {
  setConcepts();
  delete process.env.RAWJOBS_DATA_PUBLIC_KEY;
});

describe("loadConcepts", () => {
  it("uses a signed weekly list and caches it", async () => {
    process.env.RAWJOBS_DATA_PUBLIC_KEY = publicKey.export({ type: "spki", format: "der" }).toString("base64");
    const dir = mkdtempSync(join(tmpdir(), "rj-concepts-"));
    expect(await loadConcepts(dir, serve())).toBe("2026-10-19");
    expect(namesTopic("Lead payment orchestration", "payments")).toBe(true);
    expect(JSON.parse(readFileSync(join(dir, "cache", "concepts.json"), "utf8")).file).toEqual(file);
  });

  it("keeps the last good copy when the network or signature fails, and the built-in list without one", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rj-concepts-"));
    expect(await loadConcepts(dir, serve())).toBe("base"); // no key for this signature: refused
    expect(conceptsVersion()).toBe("base");
    mkdirSync(join(dir, "cache"), { recursive: true });
    writeFileSync(join(dir, "cache", "concepts.json"), JSON.stringify({ fetchedAt: "2026-01-01T00:00:00Z", file }));
    expect(await loadConcepts(dir, serve(false))).toBe("2026-10-19");
  });

  it("refuses a malformed list", () => {
    expect(isConceptsFile({ version: "x", concepts: { a: ["ok"] } })).toBe(true);
    expect(isConceptsFile({ version: "x", concepts: { a: "not a list" } })).toBe(false);
    expect(isConceptsFile({ concepts: {} })).toBe(false);
  });
});

import { spawnSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { fetchSignedJson } from "../src/data-signing";

const SIGN = fileURLToPath(new URL("../../../scripts/catalog/sign.mjs", import.meta.url));
let dir: string;
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.RAWJOBS_DATA_PUBLIC_KEY;
});

describe("scripts/catalog/sign.mjs", () => {
  it("signs a manifest the app then accepts, and refuses a key that isn't the expected one", async () => {
    dir = mkdtempSync(join(tmpdir(), "rawjobs-sign-"));
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const pub = publicKey.export({ type: "spki", format: "der" }).toString("base64");
    const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const file = join(dir, "manifest.json");
    writeFileSync(file, JSON.stringify({ version: "v1" }));

    const run = (env: Record<string, string>) => spawnSync(process.execPath, [SIGN, file], { env: { ...process.env, ...env }, encoding: "utf8" });
    expect(run({ RAWJOBS_DATA_SIGNING_KEY: pem, RAWJOBS_DATA_PUBLIC_KEY: pub }).status).toBe(0);

    process.env.RAWJOBS_DATA_PUBLIC_KEY = pub;
    const serve = (async (url: string) => new Response(readFileSync(url.endsWith(".sig") ? `${file}.sig` : file))) as unknown as typeof fetch;
    expect(await fetchSignedJson(serve, "https://x.test/manifest.json")).toEqual({ ok: true, value: { version: "v1" } });

    const other = generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "der" }).toString("base64");
    const wrong = run({ RAWJOBS_DATA_SIGNING_KEY: pem, RAWJOBS_DATA_PUBLIC_KEY: other });
    expect(wrong.status).toBe(1);
    expect(wrong.stderr).toMatch(/wrong signing key/);
    expect(run({ RAWJOBS_DATA_SIGNING_KEY: "" }).status).toBe(1);
  });
});

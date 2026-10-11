import { generateKeyPairSync, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { compareVersions, nodeArchive, RELEASE_PUBLIC_KEY, verifyRelease } from "../src/release";

const root = join(import.meta.dirname, "../../..");

describe("release signatures", () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const pub = publicKey.export({ type: "spki", format: "der" }).toString("base64");
  const body = '{\n  "app": "rawjobs",\n  "version": "0.3.0"\n}\n';
  const sig = sign(null, Buffer.from(body), privateKey).toString("base64");

  it("accepts a manifest signed by the key, byte for byte", () => {
    expect(verifyRelease(body, sig, pub)).toBe(true);
    expect(verifyRelease(body, `${sig}\n`, pub)).toBe(true);
  });

  it("refuses a changed manifest, another key, or garbage", () => {
    expect(verifyRelease(body.replace("0.3.0", "0.3.1"), sig, pub)).toBe(false);
    expect(verifyRelease(body, sig)).toBe(false);
    expect(verifyRelease(body, "not base64!", pub)).toBe(false);
    expect(verifyRelease(body, sig, "bad key")).toBe(false);
  });

  it("is the same key in the code and in both installers", () => {
    for (const f of ["packaging/install.sh", "packaging/install.ps1"]) {
      expect(readFileSync(join(root, f), "utf8")).toContain(`'${RELEASE_PUBLIC_KEY}'`);
    }
  });
});

describe("compareVersions", () => {
  it("orders versions as numbers, with pre-releases first", () => {
    expect(compareVersions("0.10.0", "0.9.9")).toBe(1);
    expect(compareVersions("0.3.0", "v0.3.0")).toBe(0);
    expect(compareVersions("0.3.0-beta.1", "0.3.0")).toBe(-1);
    expect(compareVersions("0.3.0-beta.2", "0.3.0-beta.1")).toBe(1);
    expect(compareVersions("1.0.0", "0.99.99")).toBe(1);
  });
});

describe("nodeArchive", () => {
  it("names nodejs.org's file for each platform", () => {
    expect(nodeArchive("v24.21.0", "win-x64")).toBe("node-v24.21.0-win-x64.zip");
    expect(nodeArchive("v24.21.0", "darwin-arm64")).toBe("node-v24.21.0-darwin-arm64.tar.gz");
  });
});

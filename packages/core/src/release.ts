import { createPublicKey, verify } from "node:crypto";

/**
 * What a release publishes next to its bundle (docs/plans/local-install.md, section 5):
 *   latest.json       this manifest, one key per line (install.sh reads it without a JSON parser)
 *   latest.json.sig   an ed25519 signature of latest.json's exact bytes, base64
 *   rawjobs-<version>.tar.gz   the bundle (pnpm bundle)
 * Installs and updates accept a manifest only with a valid signature, and a bundle or a Node only
 * with the SHA-256 the manifest names.
 */
export type ReleaseManifest = {
  app: "rawjobs";
  version: string;
  date: string;
  bundleFile: string;
  bundleSha256: string;
  /** The Node this version runs on, from nodejs.org, e.g. "v24.11.0". */
  nodeVersion: string;
  /** SHA-256 of each platform's Node archive (NODE_PLATFORMS), from nodejs.org's SHASUMS256.txt. */
  nodeSha256: Record<string, string>;
  /** Older versions can't update straight to this one: they're asked to run the install line again. */
  minVersion: string;
  /** A required update: the dashboard asks for it in a window that only closes by updating. */
  critical: boolean;
  notes: string;
};

/** Where releases are downloaded from (the latest one). */
export const RELEASE_URL = "https://github.com/Tanmay-Mhatre/rawjobs/releases/latest/download";

/**
 * The public half of the release signing key (ed25519, SPKI DER, base64). The private half is the
 * RAWJOBS_SIGNING_KEY secret of the release workflow. install.sh and install.ps1 carry the same value.
 */
export const RELEASE_PUBLIC_KEY = "MCowBQYDK2VwAyEAJFEm6OjkG2omc8RkYCVBBvcuGeIjl6MVvRy4eFX8Jtc=";

/** Platforms with a Node build and an installer: our key → nodejs.org's archive name. */
export const NODE_PLATFORMS: Record<string, string> = {
  "win-x64": "win-x64.zip",
  "win-arm64": "win-arm64.zip",
  "darwin-arm64": "darwin-arm64.tar.gz",
  "darwin-x64": "darwin-x64.tar.gz",
  "linux-x64": "linux-x64.tar.gz",
  "linux-arm64": "linux-arm64.tar.gz",
};

/** nodejs.org's file name for a Node version on one platform: "node-v24.11.0-win-x64.zip". */
export const nodeArchive = (nodeVersion: string, platform: string) => `node-${nodeVersion}-${NODE_PLATFORMS[platform]}`;

/** True when `signature` (base64) is a valid signature of `data` by the release key (or `publicKey`). */
export function verifyRelease(data: Buffer | string, signature: string, publicKey = RELEASE_PUBLIC_KEY): boolean {
  try {
    const key = createPublicKey({ key: Buffer.from(publicKey, "base64"), format: "der", type: "spki" });
    return verify(null, typeof data === "string" ? Buffer.from(data) : data, key, Buffer.from(signature.trim(), "base64"));
  } catch {
    return false;
  }
}

/**
 * A release's notes, from its tag message, with the lines that set how it's offered taken out:
 *   Update: mandatory     a required update (critical): the dashboard asks until you update
 *   Min-version: 0.5.0    older versions can't update by themselves (run the install line again)
 */
export function parseReleaseNotes(text: string): { notes: string; critical: boolean; minVersion: string | null } {
  let critical = false;
  let minVersion: string | null = null;
  const kept = text.split(/\r?\n/).filter((line) => {
    const update = line.match(/^\s*Update:\s*(\S+)\s*$/i);
    if (update) {
      critical ||= /^(mandatory|required|critical)$/i.test(update[1]!);
      return false;
    }
    const min = line.match(/^\s*Min-version:\s*v?(\d+\.\d+\.\d+\S*)\s*$/i);
    if (min) {
      minVersion = min[1]!;
      return false;
    }
    return true;
  });
  return { notes: kept.join("\n").trim(), critical, minVersion };
}

/** Compare "0.10.2" and "0.9.0" as versions (a pre-release like 0.3.0-beta.1 sorts before 0.3.0). */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => {
    const [main, pre] = v.replace(/^v/, "").split("-", 2);
    return { nums: main!.split(".").map((n) => Number(n) || 0), pre };
  };
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < 3; i++) {
    const d = (x.nums[i] ?? 0) - (y.nums[i] ?? 0);
    if (d) return Math.sign(d);
  }
  if (x.pre === y.pre) return 0;
  if (!x.pre) return 1;
  if (!y.pre) return -1;
  return x.pre < y.pre ? -1 : 1;
}

import { spawnSync } from "node:child_process";
import { createHash, createPrivateKey, sign } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { NODE_PLATFORMS, nodeArchive, parseReleaseNotes, verifyRelease, type ReleaseManifest } from "@rawjobs/core/release";

/**
 * Turn a built bundle (pnpm bundle) into the files a release publishes, in dist/release/:
 *   rawjobs-<version>.tar.gz, latest.json, latest.json.sig, install.sh, install.ps1
 *
 *   pnpm release:files [--node v24.11.0] [--min-version 0.2.0] [--critical] [--notes-file notes.md]
 *                      [--key key.pem] [--public-key <base64>]
 * The signing key is RAWJOBS_SIGNING_KEY (PEM text) or --key. --public-key checks the signature
 * against another key than the release key (tests sign with a throwaway one). --unsigned leaves
 * latest.json.sig out: the release workflow signs in a job of its own, with no dependencies
 * installed (scripts/catalog/sign.mjs), so no package can reach the key.
 * Without --node it uses the newest Node 24 LTS on nodejs.org.
 * The notes (the tag's message) can carry "Update: mandatory" and "Min-version: x.y.z" lines: they
 * set --critical and --min-version and are left out of the notes (parseReleaseNotes).
 */
const root = resolve(import.meta.dirname, "../..");
const { values } = parseArgs({
  options: {
    node: { type: "string" },
    "min-version": { type: "string" },
    critical: { type: "boolean", default: false },
    "notes-file": { type: "string" },
    key: { type: "string" },
    unsigned: { type: "boolean", default: false },
    "public-key": { type: "string" },
    out: { type: "string", default: "dist/release" },
    /** The bundle's version when it isn't package.json's (pnpm bundle --version; update tests). */
    version: { type: "string" },
  },
});

const version = values.version ?? (JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version: string }).version;
const bundleName = `rawjobs-${version}`;
const bundleDir = join(root, "dist/bundle", bundleName);
if (!existsSync(join(bundleDir, "cli.mjs"))) fail(`${bundleDir} is missing: run pnpm bundle first.`);

const pem = values.key ? readFileSync(values.key, "utf8") : process.env.RAWJOBS_SIGNING_KEY;
if (!pem && !values.unsigned) fail("No signing key: set RAWJOBS_SIGNING_KEY or pass --key <file> (or --unsigned).");

const out = resolve(root, values.out);
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

// The bundle, with its folder at the top (installs unpack it with --strip-components=1).
const bundleFile = `${bundleName}.tar.gz`;
// On Windows, the system's bsdtar: Git's GNU tar reads "C:\…" as a remote host.
const tarExe = process.platform === "win32" ? join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe") : "tar";
const tar = spawnSync(tarExe, ["-czf", join(out, bundleFile), "-C", join(root, "dist/bundle"), bundleName], { stdio: "inherit" });
if (tar.status !== 0) fail("tar failed.");

const nodeVersion = values.node ?? (await newestNode24());
const sums = await text(`https://nodejs.org/dist/${nodeVersion}/SHASUMS256.txt`);
const nodeSha256: Record<string, string> = {};
for (const platform of Object.keys(NODE_PLATFORMS)) {
  const file = nodeArchive(nodeVersion, platform);
  const line = sums.split("\n").find((l) => l.trim().endsWith(`  ${file}`));
  if (!line) fail(`nodejs.org has no ${file} for ${nodeVersion}.`);
  nodeSha256[platform] = line.split(/\s+/)[0]!;
}

const parsed = parseReleaseNotes(values["notes-file"] ? readFileSync(values["notes-file"], "utf8") : "");
const manifest: ReleaseManifest = {
  app: "rawjobs",
  version,
  date: new Date().toISOString().slice(0, 10),
  bundleFile,
  bundleSha256: sha256(readFileSync(join(out, bundleFile))),
  nodeVersion,
  nodeSha256,
  minVersion: values["min-version"] ?? parsed.minVersion ?? "0.0.0",
  critical: values.critical || parsed.critical,
  notes: parsed.notes,
};
// One key per line: install.sh picks values out with sed.
const body = `${JSON.stringify(manifest, null, 2)}\n`;
writeFileSync(join(out, "latest.json"), body);
if (pem && !values.unsigned) {
  const signature = sign(null, Buffer.from(body), createPrivateKey(pem)).toString("base64");
  if (!verifyRelease(body, signature, values["public-key"])) fail("The signature doesn't match the public key: wrong signing key?");
  writeFileSync(join(out, "latest.json.sig"), `${signature}\n`);
}
for (const f of ["install.sh", "install.ps1"]) copyFileSync(join(root, "packaging", f), join(out, f));

console.log(
  `Release files for RawJobs ${version} (Node ${nodeVersion}${manifest.critical ? ", required update" : ""}${manifest.minVersion !== "0.0.0" ? `, min version ${manifest.minVersion}` : ""}) in ${out}`,
);

async function newestNode24(): Promise<string> {
  const list = JSON.parse(await text("https://nodejs.org/dist/index.json")) as { version: string; lts: string | false }[];
  const v = list.find((r) => r.version.startsWith("v24.") && r.lts);
  if (!v) fail("No Node 24 LTS on nodejs.org.");
  return v.version;
}

async function text(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) fail(`${url}: HTTP ${res.status}`);
  return res.text();
}

function sha256(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

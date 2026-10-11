import { spawnSync } from "node:child_process";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ReleaseManifest } from "../src/release";
import {
  backupData,
  fetchManifest,
  finishUpdate,
  installedVersions,
  judge,
  platformKey,
  prepareVersion,
  readLastUpdate,
  readUpdateFile,
  switchTo,
} from "../src/update";

const tar = process.platform === "win32" ? join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe") : "tar";
const servers: Server[] = [];
afterEach(() => {
  for (const s of servers.splice(0)) s.close();
});

function serve(handler: Parameters<typeof createServer>[1]): Promise<number> {
  const s = createServer(handler);
  servers.push(s);
  return new Promise((done) => s.listen(0, "127.0.0.1", () => done((s.address() as AddressInfo).port)));
}

/** An installed copy on 0.1.0, with its Node already there (so no Node download). */
function installedCopy(nodeVersion = "v24.0.0") {
  const home = mkdtempSync(join(tmpdir(), "rj-upd-"));
  const node = `node-${nodeVersion}-${platformKey()}`;
  mkdirSync(join(home, "app/versions/0.1.0"), { recursive: true });
  mkdirSync(join(home, "runtime", node), { recursive: true });
  writeFileSync(join(home, "app/current.txt"), "0.1.0");
  writeFileSync(join(home, "runtime/current.txt"), node);
  mkdirSync(join(home, "profile"));
  writeFileSync(join(home, "profile/resume.md"), "v1 resume");
  return home;
}

/** A signed release of `version` served over http, with a bundle like pnpm bundle's. */
async function release(version: string, nodeVersion = "v24.0.0", tamper = false) {
  const dir = mkdtempSync(join(tmpdir(), "rj-rel-"));
  mkdirSync(join(dir, `rawjobs-${version}`));
  writeFileSync(join(dir, `rawjobs-${version}`, "cli.mjs"), "console.log('hi')\n");
  const file = `rawjobs-${version}.tar.gz`;
  expect(spawnSync(tar, ["-czf", join(dir, file), "-C", dir, `rawjobs-${version}`]).status).toBe(0);
  const m: ReleaseManifest = {
    app: "rawjobs",
    version,
    date: "2026-10-11",
    bundleFile: file,
    bundleSha256: createHash("sha256").update(readFileSync(join(dir, file))).digest("hex"),
    nodeVersion,
    nodeSha256: { [platformKey()]: "0".repeat(64) },
    minVersion: "0.0.0",
    critical: false,
    notes: "Faster scans.",
  };
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const body = `${JSON.stringify(m, null, 2)}\n`;
  writeFileSync(join(dir, "latest.json"), tamper ? body.replace("Faster", "Slower") : body);
  writeFileSync(join(dir, "latest.json.sig"), sign(null, Buffer.from(body), privateKey).toString("base64"));
  const port = await serve((req, res) => {
    const f = join(dir, (req.url ?? "/").slice(1));
    if (!existsSync(f)) {
      res.statusCode = 404;
      return res.end();
    }
    res.end(readFileSync(f));
  });
  return { base: `http://127.0.0.1:${port}`, publicKey: publicKey.export({ type: "spki", format: "der" }).toString("base64"), manifest: m };
}

describe("judge", () => {
  const m = (version: string, minVersion = "0.0.0") => ({ version, minVersion }) as ReleaseManifest;
  it("offers newer versions, not ones that failed here, and says when this one is too old", () => {
    expect(judge("0.2.0", m("0.3.0")).available).toBe(true);
    expect(judge("0.3.0", m("0.3.0")).available).toBe(false);
    expect(judge("0.2.0", m("0.3.0"), ["0.3.0"]).available).toBe(false);
    expect(judge("0.2.0", m("0.3.0", "0.2.5")).tooOld).toBe(true);
    expect(judge("0.9.0", m("1.0.0")).major).toBe(true);
    expect(judge("0.2.0", m("0.3.0")).major).toBe(false);
  });
});

describe("updating an installed copy", () => {
  it("accepts only a release signed by the key", async () => {
    const r = await release("0.2.0");
    await expect(fetchManifest(r.base, { publicKey: r.publicKey })).resolves.toMatchObject({ version: "0.2.0" });
    await expect(fetchManifest(r.base)).rejects.toThrow(/signature/);
    const bad = await release("0.2.0", "v24.0.0", true);
    await expect(fetchManifest(bad.base, { publicKey: bad.publicKey })).rejects.toThrow(/signature/);
  });

  it("puts the new version next to the old one, then switches and remembers the old one", async () => {
    const home = installedCopy();
    const r = await release("0.2.0");
    const v = await prepareVersion(home, r.base, r.manifest);
    expect(readFileSync(join(home, "app/versions/0.2.0/cli.mjs"), "utf8")).toContain("hi");
    expect(installedVersions(home)?.current).toBe("0.1.0");
    switchTo(home, v.version, v.node);
    expect(installedVersions(home)).toMatchObject({ current: "0.2.0", previous: "0.1.0" });
  });

  it("refuses a bundle that doesn't match the checksum", async () => {
    const home = installedCopy();
    const r = await release("0.2.0");
    await expect(prepareVersion(home, r.base, { ...r.manifest, bundleSha256: "f".repeat(64) })).rejects.toThrow(/checksum/);
    expect(existsSync(join(home, "app/versions/0.2.0"))).toBe(false);
  });

  it("keeps the new version when it answers, and cleans up older ones", async () => {
    const home = installedCopy();
    mkdirSync(join(home, "app/versions/0.0.9"));
    const r = await release("0.2.0");
    const v = await prepareVersion(home, r.base, r.manifest);
    switchTo(home, v.version, v.node);
    const record = await finishUpdate({
      home,
      from: "0.1.0",
      to: "0.2.0",
      notes: "Faster scans.",
      timeoutMs: 5000,
      // "Starting the server": one that answers as the new version.
      start: () => void serve((_q, res) => res.end(JSON.stringify({ ok: true, version: "0.2.0" }))).then((port) => writeFileSync(join(home, "state.json"), JSON.stringify({ port }))),
    });
    expect(record).toMatchObject({ ok: true, from: "0.1.0", to: "0.2.0", notes: "Faster scans." });
    expect(readLastUpdate(home)?.ok).toBe(true);
    expect(existsSync(join(home, "app/versions/0.0.9"))).toBe(false);
    expect(existsSync(join(home, "app/versions/0.1.0"))).toBe(true);
  });

  it("goes back, restores the backup, and won't retry when the new version doesn't answer", async () => {
    const home = installedCopy();
    const r = await release("0.2.0");
    const v = await prepareVersion(home, r.base, r.manifest);
    const backup = backupData(home, "before-0.2.0");
    switchTo(home, v.version, v.node);
    writeFileSync(join(home, "profile/resume.md"), "changed by a broken migration");
    const starts: string[] = [];
    const record = await finishUpdate({
      home,
      from: "0.1.0",
      to: "0.2.0",
      backup,
      timeoutMs: 2500,
      // The new version never answers; the old one does once it's started again.
      start: () => {
        const v = installedVersions(home)!.current;
        starts.push(v);
        if (v === "0.1.0") void serve((_q, res) => res.end(JSON.stringify({ ok: true, version: "0.1.0" }))).then((port) => writeFileSync(join(home, "state.json"), JSON.stringify({ port })));
      },
    });
    expect(record.ok).toBe(false);
    expect(record.error).toMatch(/0\.1\.0 is back/);
    expect(installedVersions(home)?.current).toBe("0.1.0");
    expect(readFileSync(join(home, "profile/resume.md"), "utf8")).toBe("v1 resume");
    expect(readUpdateFile(home).skip).toEqual(["0.2.0"]);
    // Started the new version, then the old one again.
    expect(starts).toEqual(["0.2.0", "0.1.0"]);
    // The failed version is gone; nothing is left to go back to from 0.1.0.
    expect(existsSync(join(home, "app/versions/0.2.0"))).toBe(false);
    expect(installedVersions(home)?.previous).toBeNull();
  });
});

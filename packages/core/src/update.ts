import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { compareVersions, nodeArchive, RELEASE_URL, verifyRelease, type ReleaseManifest } from "./release";
import { cliCommand } from "./runtime";
import { writeFileAtomic } from "./atomic";
import { readDataFormat } from "./migrate";

/**
 * Updates for an installed copy (docs/plans/local-install.md, section 5). The layout in your RawJobs
 * folder: app/versions/<v>/ (at most two), app/current.txt and previous.txt, runtime/<node>/ and
 * runtime/current.txt. A new version is downloaded and checked ahead of time into app/ready/<v>/;
 * nothing installs until you say so. Updating = move it next to the old one, back up your data,
 * point current.txt at it and restart; the old version watches the new one start and switches back
 * if it doesn't (finishUpdate).
 */

/** "ask": check every day and tell you; you choose when to install. "off": never check. */
export type UpdateMode = "ask" | "off";
export type UpdateChannel = "stable" | "beta";
export type UpdateSettings = { mode: UpdateMode; channel: UpdateChannel };
/** updates.json: your choices, and what the last check found. */
export type UpdateFile = UpdateSettings & {
  lastCheck?: string;
  /** The newest release seen at the last check (for "Update available" after a restart). */
  latest?: { version: string; notes: string; critical: boolean; date: string; minVersion: string };
  /** Versions that failed to start here: not offered again. */
  skip?: string[];
  /** A newer version downloaded and checked ahead of time (app/ready/<version>), waiting for you. */
  ready?: { version: string; node: string };
  /** When this copy first ran the version it's on: "Updated on" / "Installed on" in Settings → About. */
  installed?: { version: string; at: string };
};
/** app/last-update.json: how the last update went, for the dashboard's note. */
export type UpdateRecord = { from: string; to: string; ok: boolean; at: string; error?: string; notes?: string; seen?: boolean };

export const DEFAULT_UPDATE_SETTINGS: UpdateSettings = { mode: "ask", channel: "stable" };
const REPO = "Tanmay-Mhatre/rawjobs";
/** How long a new version gets to answer before the old one takes over again. */
export const START_TIMEOUT_MS = 60_000;

const read = <T>(path: string): T | null => {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
};
const readText = (path: string) => {
  try {
    return readFileSync(path, "utf8").trim() || null;
  } catch {
    return null;
  }
};
const writeJson = (path: string, value: unknown) => writeFileAtomic(path, `${JSON.stringify(value, null, 1)}\n`);

// ---------- settings and records ----------

export function readUpdateFile(home: string): UpdateFile {
  const f = read<Partial<UpdateFile>>(join(home, "updates.json")) ?? {};
  return {
    ...f,
    // "auto" (before 0.5) installed by itself: it's "ask" now. Only "off" stays off.
    mode: (f.mode as string) === "off" ? "off" : "ask",
    channel: f.channel === "beta" ? "beta" : "stable",
  };
}

export function writeUpdateFile(home: string, patch: Partial<UpdateFile>): UpdateFile {
  const next = { ...readUpdateFile(home), ...patch };
  writeJson(join(home, "updates.json"), next);
  return next;
}

export const readLastUpdate = (home: string) => read<UpdateRecord>(join(home, "app/last-update.json"));
export function markLastUpdateSeen(home: string): void {
  const r = readLastUpdate(home);
  if (r) writeJson(join(home, "app/last-update.json"), { ...r, seen: true });
}

/** This folder's versions, or null when it isn't an installed copy. */
export function installedVersions(home: string): { current: string; previous: string | null; node: string } | null {
  const current = readText(join(home, "app/current.txt"));
  const node = readText(join(home, "runtime/current.txt"));
  return current && node ? { current, previous: readText(join(home, "app/previous.txt")), node } : null;
}

// ---------- finding the newest release ----------

/** Where the newest release's files are: the latest stable release, or the newest one of any kind for Beta. */
export async function releaseBase(channel: UpdateChannel, fetchImpl: typeof fetch = fetch): Promise<string> {
  if (process.env.RAWJOBS_RELEASE_URL) return process.env.RAWJOBS_RELEASE_URL.replace(/\/$/, "");
  if (channel === "stable") return RELEASE_URL;
  const res = await fetchImpl(`https://api.github.com/repos/${REPO}/releases?per_page=10`, { headers: { accept: "application/vnd.github+json" } });
  if (!res.ok) throw new Error(`Couldn't list releases (HTTP ${res.status}).`);
  const list = (await res.json()) as { tag_name: string; draft: boolean }[];
  const newest = list.find((r) => !r.draft);
  if (!newest) throw new Error("There are no releases yet.");
  return `https://github.com/${REPO}/releases/download/${newest.tag_name}`;
}

/** A release's base address by version (`rawjobs update --to 0.3.0`). */
export const releaseBaseFor = (version: string) => process.env.RAWJOBS_RELEASE_URL?.replace(/\/$/, "") ?? `https://github.com/${REPO}/releases/download/v${version.replace(/^v/, "")}`;

/** Download latest.json and its signature, and accept it only when the signature is the release key's. */
export async function fetchManifest(base: string, opts: { fetchImpl?: typeof fetch; publicKey?: string } = {}): Promise<ReleaseManifest> {
  const f = opts.fetchImpl ?? fetch;
  const get = async (name: string) => {
    const res = await f(`${base}/${name}`, { redirect: "follow", signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`Couldn't download ${name} (HTTP ${res.status}).`);
    return Buffer.from(await res.arrayBuffer());
  };
  const [body, sig] = await Promise.all([get("latest.json"), get("latest.json.sig")]);
  if (!verifyRelease(body, sig.toString("utf8"), opts.publicKey ?? (process.env.RAWJOBS_PUBLIC_KEY || undefined))) {
    throw new Error("The release's signature isn't valid, so it wasn't installed.");
  }
  const m = JSON.parse(body.toString("utf8")) as ReleaseManifest;
  if (m.app !== "rawjobs" || !m.version || !m.bundleFile || !m.bundleSha256) throw new Error("That isn't a RawJobs release.");
  return m;
}

export type UpdateCheck = {
  current: string;
  manifest: ReleaseManifest;
  /** Newer than this version, and not one that failed here before. */
  available: boolean;
  /** This version is too old to update straight to it: run the install line again. */
  tooOld: boolean;
  /** A new major version: installs only when you say so. */
  major: boolean;
};

export function judge(current: string, manifest: ReleaseManifest, skip: string[] = []): UpdateCheck {
  const majorOf = (v: string) => Number(v.replace(/^v/, "").split(".")[0]) || 0;
  return {
    current,
    manifest,
    available: compareVersions(manifest.version, current) > 0 && !skip.includes(manifest.version),
    tooOld: compareVersions(current, manifest.minVersion || "0.0.0") < 0,
    major: majorOf(manifest.version) > majorOf(current),
  };
}

// ---------- installing a version next to the current one ----------

export function platformKey(): string {
  const os = process.platform === "win32" ? "win" : process.platform;
  return `${os}-${process.arch}`;
}

function sha256(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

/** The system's tar (on Windows its own bsdtar, which also unpacks .zip). */
function untar(archive: string, into: string, strip: number): void {
  mkdirSync(into, { recursive: true });
  const tar = process.platform === "win32" ? join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe") : "tar";
  const r = spawnSync(tar, ["-xf", archive, "-C", into, ...(strip ? [`--strip-components=${strip}`] : [])], { windowsHide: true, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`Couldn't unpack ${archive}: ${(r.stderr || String(r.error ?? "")).trim()}`);
}

async function download(url: string, file: string, fetchImpl: typeof fetch): Promise<void> {
  // A bundle or a Node archive is tens of MB: generous, but never forever.
  const res = await fetchImpl(url, { redirect: "follow", signal: AbortSignal.timeout(600_000) });
  if (!res.ok) throw new Error(`Couldn't download ${url} (HTTP ${res.status}).`);
  writeFileSync(file, Buffer.from(await res.arrayBuffer()));
}

/**
 * Download the release's bundle (and its Node, when this copy doesn't have it yet), check each
 * against the signed manifest's SHA-256, and unpack them next to the running version. Nothing the
 * running version uses is touched.
 */
export async function prepareVersion(
  home: string,
  base: string,
  m: ReleaseManifest,
  fetchImpl: typeof fetch = fetch,
  /** "ready": download ahead of time, into app/ready/<v>, to install later (startUpdate). */
  into: "versions" | "ready" = "versions",
): Promise<{ version: string; node: string }> {
  const tmp = join(home, "app", `.download-${m.version}`);
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  try {
    const bundle = join(tmp, m.bundleFile);
    await download(`${base}/${m.bundleFile}`, bundle, fetchImpl);
    if (sha256(bundle) !== m.bundleSha256) throw new Error("The download doesn't match the release's checksum.");
    const unpacked = join(tmp, "app");
    untar(bundle, unpacked, 1);
    if (!existsSync(join(unpacked, "cli.mjs"))) throw new Error("The release is missing cli.mjs.");

    const platform = platformKey();
    const node = `node-${m.nodeVersion}-${platform}`;
    const nodeDir = join(home, "runtime", node);
    if (!existsSync(nodeDir)) {
      const archive = nodeArchive(m.nodeVersion, platform);
      const want = m.nodeSha256[platform];
      if (!want) throw new Error(`This release has no Node for ${platform}.`);
      const file = join(tmp, archive);
      await download(`${process.env.RAWJOBS_NODE_DIST ?? "https://nodejs.org/dist"}/${m.nodeVersion}/${archive}`, file, fetchImpl);
      if (sha256(file) !== want) throw new Error("The Node download doesn't match the release's checksum.");
      untar(file, join(tmp, "node"), 0);
      mkdirSync(join(home, "runtime"), { recursive: true });
      renameSync(join(tmp, "node", node), nodeDir);
    }

    const target = join(home, "app", into, m.version);
    if (into === "ready") rmSync(join(home, "app/ready"), { recursive: true, force: true });
    mkdirSync(join(home, "app", into), { recursive: true });
    rmSync(target, { recursive: true, force: true });
    renameSync(unpacked, target);
    return { version: m.version, node };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** In data/, what downloads again by itself, so a backup leaves it out: caches and the company directory. */
const REFETCHED = new Set(["cache", "catalog"]);
/** A running scan's lock and stop flags belong to that scan, not to a backup. */
const SCAN_FLAGS = new Set(["scan.lock", "scan-stop", "scan-notify"]);

/**
 * Copy everything that's yours before an update or a reinstall: the config, profile/ (resume,
 * tracking, secrets), all of data/ (jobs, history, scan runs and progress, the data format) except
 * what downloads again, plus the companies you added to the directory. The last three backups are kept.
 */
export function backupData(home: string, label: string): string {
  const dir = join(home, "backups", `${new Date().toISOString().replace(/[:.]/g, "-")}-${label}`);
  mkdirSync(dir, { recursive: true });
  for (const f of ["rawjobs.config.local.yaml", "rawjobs.config.local.backup.yaml"]) if (existsSync(join(home, f))) cpSync(join(home, f), join(dir, f));
  if (existsSync(join(home, "profile"))) cpSync(join(home, "profile"), join(dir, "profile"), { recursive: true });
  const data = join(home, "data");
  if (existsSync(data)) {
    mkdirSync(join(dir, "data"), { recursive: true });
    for (const f of readdirSync(data)) if (!REFETCHED.has(f) && !SCAN_FLAGS.has(f)) cpSync(join(data, f), join(dir, "data", f), { recursive: true });
    const additions = join(data, "catalog/additions.json");
    if (existsSync(additions)) cpSync(additions, join(dir, "data/catalog/additions.json"));
  }
  const all = readdirSync(join(home, "backups")).sort();
  for (const old of all.slice(0, -3)) rmSync(join(home, "backups", old), { recursive: true, force: true });
  return dir;
}

/**
 * Put a backup back (after a failed update). Files the backup doesn't have are left as they are,
 * except the data format: without one in the backup, the data is the first format again.
 */
export function restoreBackup(home: string, dir: string): void {
  for (const f of readdirSync(dir)) cpSync(join(dir, f), join(home, f), { recursive: true, force: true });
  if (!existsSync(join(dir, "data/format.json"))) rmSync(join(home, "data/format.json"), { force: true });
}

/**
 * Whether going back to the old version also needs the backup put back: only when the new version
 * had converted the data to a new format, which the old one can't read. Otherwise your data,
 * including whatever was saved since the update began (a scheduled scan's jobs), stays as it is.
 */
export function needsRestore(home: string, backup: string): boolean {
  return readDataFormat(join(home, "data")) !== readDataFormat(join(backup, "data"));
}

/** Make `version` the one the launcher runs, remembering the one before it. */
export function switchTo(home: string, version: string, node: string): void {
  const now = installedVersions(home);
  if (now && now.current !== version) {
    writeFileAtomic(join(home, "app/previous.txt"), now.current);
    writeFileAtomic(join(home, "app/previous-node.txt"), now.node);
  }
  writeFileAtomic(join(home, "app/current.txt"), version);
  writeFileAtomic(join(home, "runtime/current.txt"), node);
}

/**
 * Go back to the version before (and its Node), and drop the one that failed. "Previous" becomes
 * the newest other version still here, so the next update can go back too.
 */
export function switchBack(home: string, previous: string, failed?: string): void {
  writeFileAtomic(join(home, "app/current.txt"), previous);
  const node = readText(join(home, "app/previous-node.txt"));
  if (node && existsSync(join(home, "runtime", node))) writeFileAtomic(join(home, "runtime/current.txt"), node);
  if (failed && failed !== previous) rmSync(join(home, "app/versions", failed), { recursive: true, force: true });
  const others = readdirSync(join(home, "app/versions"))
    .filter((v) => v !== previous && !v.startsWith("."))
    .sort((a, b) => compareVersions(b, a));
  if (others[0]) writeFileAtomic(join(home, "app/previous.txt"), others[0]);
  else rmSync(join(home, "app/previous.txt"), { force: true });
}

/** Keep the current version and the one before it; also the Nodes they use. */
export function cleanUpVersions(home: string): void {
  const v = installedVersions(home);
  if (!v) return;
  const keep = new Set([v.current, v.previous].filter(Boolean));
  for (const d of readdirSync(join(home, "app/versions"))) if (!keep.has(d)) rmSync(join(home, "app/versions", d), { recursive: true, force: true });
  const nodes = new Set([v.node, readText(join(home, "app/previous-node.txt"))].filter(Boolean));
  for (const d of readdirSync(join(home, "runtime"))) {
    const p = join(home, "runtime", d);
    if (statSync(p).isDirectory() && !nodes.has(d)) rmSync(p, { recursive: true, force: true });
  }
}

// ---------- restarting the server ----------

/** How an installed copy's server starts at log in. packaging/install.sh and install.ps1 use the same names. */
export const AUTOSTART = { windowsTask: "RawJobs Server", macLabel: "com.rawjobs.server", linuxUnit: "rawjobs.service" };

/**
 * Start the server again the way the computer does at log in (so it stays looked after: restarted
 * if it stops), or straight from the launcher when that isn't set up.
 */
export function startServer(home: string): void {
  // A scheduler that hangs (launchctl waiting on a job that keeps failing) mustn't stall the update.
  const run = (cmd: string, args: string[]) => {
    const r = spawnSync(cmd, args, { windowsHide: true, timeout: 20_000, encoding: "utf8" });
    console.log(`${cmd} ${args.join(" ")}: ${r.status === 0 ? "ok" : `failed (${r.status ?? r.signal ?? r.error}) ${(r.stderr ?? "").trim()}`}`);
    return r.status === 0;
  };
  let started = false;
  if (process.platform === "win32") started = run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `Start-ScheduledTask -TaskName '${AUTOSTART.windowsTask}'`]);
  // No -k: the old server has already stopped, and kickstart -k takes about 20 s to return.
  else if (process.platform === "darwin") started = run("launchctl", ["kickstart", `gui/${process.getuid?.() ?? 501}/${AUTOSTART.macLabel}`]);
  else started = run("systemctl", ["--user", "restart", AUTOSTART.linuxUnit]);
  if (started) return;
  console.log("Starting the server from the launcher instead.");
  const log = join(home, "logs/server.log");
  const child =
    process.platform === "win32"
      ? spawn("conhost.exe", ["--headless", join(home, "bin/rawjobs.cmd"), "serve", "--log", log], { cwd: home, detached: true, stdio: "ignore", windowsHide: true })
      : spawn(join(home, "bin/rawjobs"), ["serve", "--log", log], { cwd: home, detached: true, stdio: "ignore" });
  child.on("error", () => {});
  child.unref();
}

/** The version answering at this folder's server, or null. */
export async function runningVersion(home: string): Promise<string | null> {
  const state = read<{ port?: number }>(join(home, "state.json"));
  try {
    const res = await fetch(`http://127.0.0.1:${state?.port ?? 4317}/api/health`, { signal: AbortSignal.timeout(1500) });
    const h = (await res.json()) as { ok?: boolean; version?: string };
    return h.ok ? (h.version ?? null) : null;
  } catch {
    return null;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** Wait until this folder's server answers as `version`; false when it hasn't within `ms`. */
async function waitFor(home: string, version: string, ms: number, pollMs = 1000): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    await sleep(pollMs);
    if ((await runningVersion(home)) === version) return true;
  }
  return false;
}

export type FinishOptions = {
  home: string;
  from: string;
  to: string;
  /** The server that's being replaced: wait for it to stop first. */
  pid?: number;
  backup?: string;
  notes?: string;
  timeoutMs?: number;
  /** How often to ask whether the new server answers (tests ask more often, to finish sooner). */
  pollMs?: number;
  /** Tests replace how the server is started. */
  start?: (home: string) => void;
};

/**
 * Run by the *old* version, in its own process, after the switch: wait for the old server to stop,
 * start the new one, and give it a minute to answer. If it doesn't, go back to the old version (and
 * to its data, if the new one had converted it), start that, and don't offer the failed version again.
 */
export async function finishUpdate(o: FinishOptions): Promise<UpdateRecord> {
  const start = o.start ?? startServer;
  console.log(`Finishing the update from ${o.from} to ${o.to}.`);
  if (o.pid) {
    for (let i = 0; i < 40 && alive(o.pid); i++) await sleep(250);
    if (alive(o.pid)) {
      try {
        process.kill(o.pid);
      } catch {
        // gone
      }
      await sleep(500);
    }
  }
  console.log("The old server has stopped; starting the new version.");
  start(o.home);
  const running = (await waitFor(o.home, o.to, o.timeoutMs ?? START_TIMEOUT_MS, o.pollMs)) ? o.to : await runningVersion(o.home);
  console.log(running === o.to ? `${o.to} answers.` : `${o.to} didn't answer (last seen: ${running ?? "nothing"}); going back to ${o.from}.`);
  let record: UpdateRecord;
  if (running === o.to) {
    record = { from: o.from, to: o.to, ok: true, at: new Date().toISOString(), notes: o.notes };
    cleanUpVersions(o.home);
  } else {
    // Stop whatever the new version left running, then go back.
    const state = read<{ pid?: number; version?: string }>(join(o.home, "state.json"));
    if (state?.pid && state.version === o.to && alive(state.pid)) {
      try {
        process.kill(state.pid);
      } catch {
        // gone
      }
    }
    switchBack(o.home, o.from, o.to);
    if (o.backup && existsSync(o.backup) && needsRestore(o.home, o.backup)) restoreBackup(o.home, o.backup);
    const f = readUpdateFile(o.home);
    writeUpdateFile(o.home, { skip: [...new Set([...(f.skip ?? []), o.to])] });
    start(o.home);
    // Only say it's back once it answers (macOS spaces out restarts by a few seconds).
    const back = await waitFor(o.home, o.from, o.timeoutMs ?? START_TIMEOUT_MS, o.pollMs);
    console.log(back ? `${o.from} answers again.` : `${o.from} didn't answer yet either.`);
    const secs = Math.round((o.timeoutMs ?? START_TIMEOUT_MS) / 1000);
    record = {
      from: o.from,
      to: o.to,
      ok: false,
      at: new Date().toISOString(),
      error: back
        ? `RawJobs ${o.to} didn't start within ${secs} seconds, so ${o.from} is back. See logs/server.log.`
        : `RawJobs ${o.to} didn't start within ${secs} seconds, so RawJobs went back to ${o.from}, which hasn't answered yet either. Open the RawJobs shortcut to start it, or see logs/server.log.`,
    };
  }
  writeJson(join(o.home, "app/last-update.json"), record);
  return record;
}

/** What the old version needs to finish an update it started (app/pending-update.json). */
type Pending = { from: string; to: string; backup: string; notes: string; pid?: number };

/**
 * Update this installed copy to the release `m` (found at `base`): put it next to the running
 * version, back up your data, switch, and hand over to finishUpdate in a separate process of the
 * *running* version, which restarts the server and goes back if the new version doesn't start.
 * The caller then stops the server `serverPid` (the server itself exits; the CLI stops it).
 */
export async function startUpdate(o: { home: string; base: string; manifest: ReleaseManifest; serverPid?: number; fetchImpl?: typeof fetch }): Promise<void> {
  const now = installedVersions(o.home);
  if (!now) throw new Error("This isn't an installed copy of RawJobs.");
  const { version, node } = takeReady(o.home, o.manifest) ?? (await prepareVersion(o.home, o.base, o.manifest, o.fetchImpl));
  const backup = backupData(o.home, `before-${version}`);
  const pending: Pending = { from: now.current, to: version, backup, notes: o.manifest.notes, pid: o.serverPid };
  writeJson(join(o.home, "app/pending-update.json"), pending);
  switchTo(o.home, version, node);
  // This very version's CLI, on the Node it runs on: both stay in place until the update is done.
  const how = cliCommand();
  spawn(how.command, [...how.args, "update", "--finish"], { cwd: o.home, detached: true, stdio: "ignore", windowsHide: true }).unref();
}

/** The version downloaded ahead of time (downloadAhead), moved into app/versions; null when there isn't one. */
export function takeReady(home: string, m: ReleaseManifest): { version: string; node: string } | null {
  const r = readUpdateFile(home).ready;
  const dir = join(home, "app/ready", m.version);
  if (r?.version !== m.version || !existsSync(join(dir, "cli.mjs")) || !existsSync(join(home, "runtime", r.node))) return null;
  const target = join(home, "app/versions", m.version);
  rmSync(target, { recursive: true, force: true });
  renameSync(dir, target);
  writeUpdateFile(home, { ready: undefined });
  return { version: m.version, node: r.node };
}

/** Download and check `m` ahead of time (unless it already is), so installing it later takes seconds. */
export async function downloadAhead(home: string, base: string, m: ReleaseManifest, fetchImpl?: typeof fetch): Promise<void> {
  const r = readUpdateFile(home).ready;
  if (r?.version === m.version && existsSync(join(home, "app/ready", m.version, "cli.mjs"))) return;
  const v = await prepareVersion(home, base, m, fetchImpl, "ready");
  writeUpdateFile(home, { ready: v });
}

/** `rawjobs update --finish`: the second half of startUpdate. */
export async function finishPendingUpdate(home: string, start?: (home: string) => void): Promise<UpdateRecord | null> {
  const p = read<Pending>(join(home, "app/pending-update.json"));
  if (!p) return null;
  rmSync(join(home, "app/pending-update.json"), { force: true });
  try {
    return await finishUpdate({ home, from: p.from, to: p.to, pid: p.pid, backup: p.backup, notes: p.notes, start });
  } catch (err) {
    // Whatever went wrong, don't leave the computer on a version nobody checked.
    console.error(`The update failed: ${(err as Error).stack ?? err}`);
    if (installedVersions(home)?.current === p.to) switchBack(home, p.from, p.to);
    (start ?? startServer)(home);
    const record: UpdateRecord = {
      from: p.from,
      to: p.to,
      ok: false,
      at: new Date().toISOString(),
      error: `The update to ${p.to} failed (${(err as Error).message}), so ${p.from} is back. See logs/update.log.`,
    };
    writeJson(join(home, "app/last-update.json"), record);
    return record;
  }
}

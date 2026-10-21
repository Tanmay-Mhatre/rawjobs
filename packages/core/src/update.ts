import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { compareVersions, nodeArchive, RELEASE_URL, type ReleaseChange, verifyRelease, type ReleaseManifest } from "./release";
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

/** "ask": watch for new versions, download them and tell you; you choose when to install. "off": never check. */
export type UpdateMode = "ask" | "off";
export type UpdateChannel = "stable" | "beta";
/** `telegram`: a Telegram message when an update is downloaded (if Telegram alerts are set up). */
export type UpdateSettings = { mode: UpdateMode; channel: UpdateChannel; telegram: boolean };
/** updates.json: your choices, and what the last check found. */
export type UpdateFile = UpdateSettings & {
  lastCheck?: string;
  /** The newest release seen at the last check (for "Update available" after a restart). */
  latest?: { version: string; notes: string; critical: boolean; date: string; minVersion: string; changes?: ReleaseChange[] };
  /** Versions that failed to start here: not offered again. */
  skip?: string[];
  /** A newer version downloaded and checked ahead of time (app/ready/<version>), waiting for you. */
  ready?: { version: string; node: string };
  /** When this copy first ran the version it's on: "Updated on" / "Installed on" in Settings → About. */
  installed?: { version: string; at: string };
  /** The beacon as last read (fetchBeacon): its ETag, so an unchanged one costs almost nothing, and when. */
  beacon?: { etag?: string; checkedAt: string; stable?: string; beta?: string };
  /** The version a Telegram message already announced as ready (one message per version). */
  notified?: string;
};
/** app/last-update.json: how the last update went, for the dashboard's note. */
export type UpdateRecord = { from: string; to: string; ok: boolean; at: string; error?: string; notes?: string; seen?: boolean };

export const DEFAULT_UPDATE_SETTINGS: UpdateSettings = { mode: "ask", channel: "stable", telegram: true };
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
    telegram: f.telegram !== false,
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

// ---------- the beacon: is there a new version? ----------

/**
 * A tiny file on the RawJobs site (apps/site/build.mjs writes it when a release is published) with
 * the newest version on each channel. Copies read it every few minutes, which costs almost nothing
 * (static files on Cloudflare are free, and an unchanged one answers 304), and fetch the signed
 * latest.json from GitHub only when it names a newer version. It's a hint, not trusted: a wrong
 * one can only make a copy look at GitHub, where every release is checked against the signing key.
 */
export const BEACON_URL = "https://www.rawjobs.workers.dev/v1/latest.json";
export type Beacon = { stable?: { version: string; critical?: boolean; date?: string }; beta?: { version: string; critical?: boolean; date?: string } };

/** Read the beacon. "same" when it hasn't changed since `etag`. Throws when it can't be read. */
export async function fetchBeacon(etag?: string, fetchImpl: typeof fetch = fetch): Promise<{ same: true } | { same: false; etag?: string; beacon: Beacon }> {
  const url = process.env.RAWJOBS_BEACON_URL || BEACON_URL;
  const res = await fetchImpl(url, { headers: etag ? { "if-none-match": etag } : {}, signal: AbortSignal.timeout(15_000) });
  if (res.status === 304) return { same: true };
  if (!res.ok) throw new Error(`The update beacon answered HTTP ${res.status}.`);
  const beacon = (await res.json()) as Beacon;
  return { same: false, etag: res.headers.get("etag") ?? undefined, beacon };
}

/** The newest version the beacon names for a channel (beta also takes a newer stable). */
export function beaconVersion(b: Pick<NonNullable<UpdateFile["beacon"]>, "stable" | "beta"> | undefined, channel: UpdateChannel): string | null {
  const stable = b?.stable ?? null;
  const beta = b?.beta ?? null;
  if (channel === "stable" || !beta) return stable;
  if (!stable) return beta;
  return compareVersions(beta, stable) > 0 ? beta : stable;
}

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

/** The ports a server of an installed copy listens on: 4317, or the next free one of these. */
export const SERVER_PORTS = Array.from({ length: 10 }, (_, i) => 4317 + i);
/** Task Scheduler's LastTaskResult: an instance is running now / a start was refused (one already runs). */
export const TASK_RUNNING = 0x41301;
export const TASK_REFUSED = 0x800710e0;

/** What restarting the server does to the computer; tests replace it. */
export type UpdateSystem = {
  platform: NodeJS.Platform;
  fetch: typeof fetch;
  /** Run a program and wait for it (quietly, with a time limit). */
  run: (cmd: string, args: string[]) => { status: number | null; stdout: string; stderr: string };
  /** Start a program that keeps running after this one exits. */
  launch: (cmd: string, args: string[], cwd: string) => void;
  alive: (pid: number) => boolean;
  kill: (pid: number) => void;
  sleep: (ms: number) => Promise<void>;
};

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

export const realSystem: UpdateSystem = {
  platform: process.platform,
  fetch: (...a) => fetch(...a),
  // A scheduler that hangs (launchctl waiting on a job that keeps failing) mustn't stall the update.
  run: (cmd, args) => {
    const r = spawnSync(cmd, args, { windowsHide: true, timeout: 20_000, encoding: "utf8" });
    return { status: r.status, stdout: r.stdout ?? "", stderr: (r.stderr ?? "") || String(r.error ?? r.signal ?? "") };
  },
  launch: (cmd, args, cwd) => {
    const child = spawn(cmd, args, { cwd, detached: true, stdio: "ignore", windowsHide: true });
    child.on("error", () => {});
    child.unref();
  },
  alive,
  kill: (pid) => {
    try {
      process.kill(pid);
    } catch {
      // gone
    }
  },
  sleep,
};

const powershell = (sys: UpdateSystem, script: string) => sys.run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script]);

/** A short id of this RawJobs folder, which /api/health reports: two servers of one folder report the same id. */
export function folderId(home: string): string {
  const p = resolve(home);
  return createHash("sha256")
    .update(process.platform === "win32" ? p.toLowerCase() : p)
    .digest("hex")
    .slice(0, 16);
}

/** Whether a process's command line runs one of this folder's installed versions (…/app/versions/…). */
export function runsFromFolder(commandLine: string, home: string): boolean {
  const norm = (s: string) => s.replace(/\\/g, "/").toLowerCase();
  return norm(commandLine).includes(norm(join(resolve(home), "app/versions/")));
}

/** A process's command line, or null (gone, or it couldn't be read). */
export function commandLineOf(pid: number, sys: UpdateSystem = realSystem): string | null {
  const r =
    sys.platform === "win32" ? powershell(sys, `(Get-CimInstance Win32_Process -Filter "ProcessId=${Math.trunc(pid)}").CommandLine`) : sys.run("ps", ["-o", "command=", "-p", String(Math.trunc(pid))]);
  return r.status === 0 && r.stdout.trim() ? r.stdout.trim() : null;
}

/** Windows: the processes listening on these ports, with their command lines. */
function windowsListeners(ports: number[], sys: UpdateSystem): { port: number; pid: number; command: string }[] {
  const r = powershell(
    sys,
    `Get-NetTCPConnection -State Listen -LocalPort ${ports.join(",")} -ErrorAction SilentlyContinue | ForEach-Object { "$($_.LocalPort)\`t$($_.OwningProcess)\`t$((Get-CimInstance Win32_Process -Filter "ProcessId=$($_.OwningProcess)").CommandLine)" }`,
  );
  return r.stdout
    .split(/\r?\n/)
    .map((line) => line.split("\t"))
    .filter((p) => p.length >= 3 && Number(p[1]) > 0)
    .map(([port, pid, ...command]) => ({ port: Number(port), pid: Number(pid), command: command.join("\t") }));
}

/**
 * Stop every server of this RawJobs folder that's still running, not only state.json's: each one
 * whose /api/health says it's this folder's, state.json's, and (Windows) any process listening on
 * these ports from this folder's app/versions/ that doesn't answer (a hung one). Waits until they've
 * stopped; returns how many there were.
 */
export async function stopAllServers(home: string, o: { sys?: UpdateSystem; ports?: number[] } = {}): Promise<number> {
  const sys = o.sys ?? realSystem;
  const ports = o.ports ?? SERVER_PORTS;
  const id = folderId(home);
  const state = read<{ pid?: number; port?: number }>(join(home, "state.json"));
  const found = new Map<number, number>(); // pid → port
  const answered = new Map<number, { home?: string; pid?: number }>();
  await Promise.all(
    [...new Set([...ports, ...(state?.port ? [state.port] : [])])].map(async (port) => {
      try {
        const res = await sys.fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1500) });
        const h = (await res.json()) as { ok?: boolean; home?: string; pid?: number };
        if (!h.ok) return;
        answered.set(port, h);
        if (h.home === id && h.pid) found.set(h.pid, port);
      } catch {
        // nothing there, or it doesn't answer
      }
    }),
  );
  // state.json's server: an older version doesn't say which folder it's from, but answers on its port.
  if (state?.pid && state.port && !found.has(state.pid) && sys.alive(state.pid)) {
    const h = answered.get(state.port);
    if ((h && !h.home) || runsFromFolder(commandLineOf(state.pid, sys) ?? "", home)) found.set(state.pid, state.port);
  }
  if (sys.platform === "win32" && ports.length) {
    for (const l of windowsListeners(ports, sys)) if (!found.has(l.pid) && runsFromFolder(l.command, home)) found.set(l.pid, l.port);
  }
  found.delete(process.pid);
  for (const [pid, port] of found) {
    console.log(`Stopping the RawJobs server on port ${port} (process ${pid}).`);
    await stopServer(pid, 0, sys);
  }
  return found.size;
}

/**
 * Windows: whether this process runs inside the RawJobs Server task (an ancestor is the task's
 * conhost, started by Task Scheduler's svchost). An update started there must not end the task:
 * that would end the update's helper too.
 */
export function insideServerTask(sys: UpdateSystem = realSystem): boolean {
  if (sys.platform !== "win32") return false;
  // Walk up from this process; a parent that started after its child is a reused id, not the parent.
  const r = powershell(
    sys,
    `$w = Get-CimInstance Win32_Process -Filter "ProcessId=${process.pid}"; for ($i = 0; $i -lt 8 -and $w; $i++) { $p = Get-CimInstance Win32_Process -Filter "ProcessId=$($w.ParentProcessId)"; if (-not $p -or $p.CreationDate -gt $w.CreationDate) { break }; "$($p.Name)\`t$($p.CommandLine)"; $w = $p }`,
  );
  return inTaskTree(r.stdout.split(/\r?\n/).filter(Boolean));
}

/** The ancestors ("name<TAB>command line", nearest first) include the task's conhost running serve, started by svchost. */
export function inTaskTree(ancestors: string[]): boolean {
  const names = ancestors.map((a) => a.split("\t"));
  return names.some(([name, cmd], i) => /^conhost\.exe$/i.test(name ?? "") && /\bserve\b/.test(cmd ?? "") && /^svchost\.exe$/i.test(names[i + 1]?.[0] ?? ""));
}

/**
 * Start the server again the way the computer does at log in (so it stays looked after: restarted
 * if it stops), or straight from the launcher when that isn't set up or doesn't start it.
 */
export async function startServer(home: string, o: { insideTask?: boolean; sys?: UpdateSystem } = {}): Promise<void> {
  const sys = o.sys ?? realSystem;
  const run = (cmd: string, args: string[]) => {
    const r = sys.run(cmd, args);
    console.log(`${cmd} ${args.join(" ")}: ${r.status === 0 ? "ok" : `failed (${r.status}) ${r.stderr.trim()}`}`);
    return r.status === 0;
  };
  let started = false;
  if (sys.platform === "win32") started = await startWindowsTask(sys, !!o.insideTask);
  // No -k: the old server has already stopped, and kickstart -k takes about 20 s to return.
  else if (sys.platform === "darwin") started = run("launchctl", ["kickstart", `gui/${process.getuid?.() ?? 501}/${AUTOSTART.macLabel}`]);
  else started = run("systemctl", ["--user", "restart", AUTOSTART.linuxUnit]);
  if (started) return;
  console.log("Starting the server directly instead, with the same command the computer uses at log in.");
  const log = join(home, "logs/server.log");
  if (sys.platform === "win32") sys.launch("conhost.exe", ["--headless", join(home, "bin/rawjobs.cmd"), "serve", "--log", log], home);
  else sys.launch(join(home, "bin/rawjobs"), ["serve", "--log", log], home);
}

/**
 * Windows: start the RawJobs Server task, ending a run Windows still counts as running first (the
 * task starts no second one: MultipleInstances IgnoreNew). False when it didn't start.
 */
async function startWindowsTask(sys: UpdateSystem, insideTask: boolean): Promise<boolean> {
  const task = `-TaskName '${AUTOSTART.windowsTask}'`;
  const state = powershell(sys, `(Get-ScheduledTask ${task} -ErrorAction Stop).State`);
  if (state.status !== 0) {
    console.log("The RawJobs Server task isn't set up on this computer.");
    return false;
  }
  if (state.stdout.trim() === "Running") {
    if (insideTask) console.log("Windows still counts the RawJobs Server task as running. It isn't ended: this update runs inside it, and ending it would end the update too.");
    else {
      const stop = powershell(sys, `Stop-ScheduledTask ${task}`);
      console.log(stop.status === 0 ? "Ended the RawJobs Server task's old run, which Windows still counted as running." : `Couldn't end the RawJobs Server task's old run: ${stop.stderr.trim()}`);
    }
  }
  const start = powershell(sys, `Start-ScheduledTask ${task}`);
  if (start.status !== 0) {
    console.log(`Windows couldn't start the RawJobs Server task: ${start.stderr.trim()}`);
    return false;
  }
  await sys.sleep(3000);
  const info = powershell(sys, `(Get-ScheduledTaskInfo ${task}).LastTaskResult`);
  const result = Number(info.stdout.trim());
  if (result === TASK_RUNNING) {
    console.log("Started the RawJobs Server task.");
    return true;
  }
  console.log(
    result === TASK_REFUSED
      ? "Windows refused to start the RawJobs Server task: it says the task is already running."
      : `The RawJobs Server task isn't running a few seconds after starting it (result ${info.stdout.trim() || info.stderr.trim() || "unknown"}).`,
  );
  return false;
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

/** Give a server up to `graceMs` to stop by itself, then stop it, and wait (up to 5 s) until it has. */
async function stopServer(pid: number, graceMs = 10_000, sys: UpdateSystem = realSystem): Promise<void> {
  for (let waited = 0; waited < graceMs && sys.alive(pid); waited += 250) await sys.sleep(250);
  if (!sys.alive(pid)) return;
  sys.kill(pid);
  for (let i = 0; i < 20 && sys.alive(pid); i++) await sys.sleep(250);
}

/** The size of a file now (0 when there's none), to read what's written to it after this. */
const sizeOf = (file: string) => {
  try {
    return statSync(file).size;
  } catch {
    return 0;
  }
};

/** Whether `version`'s server got as far as starting (serve's "RawJobs X is starting." line) in logs/server.log after `offset`. */
export function startedSince(home: string, offset: number, version: string): boolean {
  try {
    const log = readFileSync(join(home, "logs/server.log"));
    // A log over 5 MB moves to server.log.1 when the server starts: then it's all new.
    const text = (log.length >= offset ? log.subarray(offset) : log).toString("utf8");
    return text.includes(`RawJobs ${version} is starting.`);
  } catch {
    return false;
  }
}

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
  start?: (home: string) => void | Promise<void>;
  /** Windows: the update was started inside the RawJobs Server task (insideServerTask), so it isn't ended. */
  insideTask?: boolean;
  /** The ports to look for more servers of this folder on. Default: SERVER_PORTS. */
  ports?: number[];
  /** Tests replace how processes are found, stopped and started. */
  sys?: Partial<UpdateSystem>;
};

/**
 * Run by the *old* version, in its own process, after the switch: wait for the old server to stop
 * (and stop any other one of this folder), start the new one, and give it a minute to answer. If it
 * doesn't, go back to the old version (and to its data, if the new one had converted it) and start
 * that. A version that started and failed isn't offered again; one that never started at all (the
 * computer didn't run it) stays on offer, so Update tries it again.
 */
export async function finishUpdate(o: FinishOptions): Promise<UpdateRecord> {
  const sys: UpdateSystem = { ...realSystem, ...o.sys };
  const start = o.start ?? ((home: string) => startServer(home, { insideTask: o.insideTask, sys }));
  console.log(`Finishing the update from ${o.from} to ${o.to}.`);
  if (o.pid) await stopServer(o.pid, 10_000, sys);
  // Any other server of this folder (one that started next to it on the next port, or a hung one
  // the computer's scheduler still runs) would keep the scheduler from starting the new version.
  const others = await stopAllServers(o.home, { sys, ports: o.ports });
  console.log(
    others
      ? `Stopped ${others} more RawJobs server${others === 1 ? "" : "s"} of this folder that ${others === 1 ? "was" : "were"} still running.`
      : "No other RawJobs server of this folder is running.",
  );
  // Windows' scheduler counts its task as running until the window around the server closes too.
  if (others && sys.platform === "win32") await sys.sleep(1000);
  console.log("The old server has stopped; starting the new version.");
  const logFrom = sizeOf(join(o.home, "logs/server.log"));
  await start(o.home);
  const running = (await waitFor(o.home, o.to, o.timeoutMs ?? START_TIMEOUT_MS, o.pollMs)) ? o.to : await runningVersion(o.home);
  console.log(running === o.to ? `${o.to} answers.` : `${o.to} didn't answer (last seen: ${running ?? "nothing"}); going back to ${o.from}.`);
  let record: UpdateRecord;
  if (running === o.to) {
    record = { from: o.from, to: o.to, ok: true, at: new Date().toISOString(), notes: o.notes };
    cleanUpVersions(o.home);
  } else {
    // Stop whatever the new version left running, then go back.
    const state = read<{ pid?: number; version?: string }>(join(o.home, "state.json"));
    if (state?.pid && state.version === o.to && sys.alive(state.pid)) sys.kill(state.pid);
    // No line from the new version in its log: the computer never ran it, which says nothing about it.
    const ran = startedSince(o.home, logFrom, o.to);
    switchBack(o.home, o.from, o.to);
    if (o.backup && existsSync(o.backup) && needsRestore(o.home, o.backup)) restoreBackup(o.home, o.backup);
    if (ran) {
      const f = readUpdateFile(o.home);
      writeUpdateFile(o.home, { skip: [...new Set([...(f.skip ?? []), o.to])] });
    } else console.log(`${o.to} never started (there's no line from it in logs/server.log), so it stays on offer: Update tries it again.`);
    await start(o.home);
    // Only say it's back once it answers (macOS spaces out restarts by a few seconds).
    const back = await waitFor(o.home, o.from, o.timeoutMs ?? START_TIMEOUT_MS, o.pollMs);
    console.log(back ? `${o.from} answers again.` : `${o.from} didn't answer yet either.`);
    const secs = Math.round((o.timeoutMs ?? START_TIMEOUT_MS) / 1000);
    const what = ran ? `RawJobs ${o.to} didn't start within ${secs} seconds` : `The computer didn't start RawJobs ${o.to}`;
    const log = ran ? "logs/server.log" : "logs/update.log";
    record = {
      from: o.from,
      to: o.to,
      ok: false,
      at: new Date().toISOString(),
      error: back
        ? `${what}, so ${o.from} is back.${ran ? "" : " Update tries it again."} See ${log}.`
        : `${what}, so RawJobs went back to ${o.from}, which hasn't answered yet either. Open the RawJobs shortcut to start it, or see ${log}.`,
    };
  }
  writeJson(join(o.home, "app/last-update.json"), record);
  return record;
}

/** What the old version needs to finish an update it started (app/pending-update.json). */
type Pending = { from: string; to: string; backup: string; notes: string; pid?: number; insideTask?: boolean };

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
  // Node can't start the helper below outside a Windows task's job, so when this runs inside the
  // RawJobs Server task, ending that task could end the helper too: it mustn't.
  const pending: Pending = { from: now.current, to: version, backup, notes: o.manifest.notes, pid: o.serverPid, insideTask: insideServerTask() };
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
export async function finishPendingUpdate(home: string, start?: (home: string) => void | Promise<void>): Promise<UpdateRecord | null> {
  const p = read<Pending>(join(home, "app/pending-update.json"));
  if (!p) return null;
  rmSync(join(home, "app/pending-update.json"), { force: true });
  try {
    return await finishUpdate({ home, from: p.from, to: p.to, pid: p.pid, backup: p.backup, notes: p.notes, start, insideTask: p.insideTask });
  } catch (err) {
    // Whatever went wrong, don't leave the computer on a version nobody checked.
    console.error(`The update failed: ${(err as Error).stack ?? err}`);
    if (installedVersions(home)?.current === p.to) switchBack(home, p.from, p.to);
    await (start ?? ((h: string) => startServer(h, { insideTask: p.insideTask })))(home);
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

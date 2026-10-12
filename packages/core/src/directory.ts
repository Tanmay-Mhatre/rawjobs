import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { envSetting } from "./env";
import { isSafeName, safeJoin } from "./safe-name";

/**
 * The shared company directory lives online (built weekly from public lists plus what users add)
 * and every install keeps a copy in data/catalog. These defaults point at the project's own
 * directory and inbox; set RAWJOBS_DIRECTORY_URL / RAWJOBS_CONTRIBUTE_URL to use your own
 * (the older JOBHUNTER_ names still work).
 */
export const DEFAULT_DIRECTORY_URL = "https://github.com/Tanmay-Mhatre/rawjobs-directory/releases/latest/download";
/** The contribution inbox (services/contribute); empty turns sharing off. */
export const DEFAULT_CONTRIBUTE_URL = "https://rawjobs-contribute.rawjobs.workers.dev";

export const directoryUrl = () => (envSetting("DIRECTORY_URL") ?? DEFAULT_DIRECTORY_URL).replace(/\/$/, "");
export const contributeUrl = () => (envSetting("CONTRIBUTE_URL") ?? DEFAULT_CONTRIBUTE_URL).replace(/\/$/, "");

export type DirectoryManifest = {
  version: string;
  generated_at: string;
  companies: number;
  indexed: number;
  files: Record<string, { sha256: string; bytes: number }>;
};

export type DirectoryStatus = {
  /** The local copy's manifest, if it came from the shared directory. */
  local?: DirectoryManifest & { updated_at: string };
  /** A directory exists locally (downloaded or built here). */
  present: boolean;
  /** Boards added here and waiting to be shared. */
  outbox: number;
  sharing: boolean;
};

const catalogDir = (dataDir: string) => join(dataDir, "catalog");
const readJson = <T>(path: string): T | undefined => (existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as T) : undefined);

export function directoryStatus(dataDir: string): DirectoryStatus {
  const dir = catalogDir(dataDir);
  return {
    local: readJson(join(dir, "manifest.json")),
    present: existsSync(join(dir, "directory.json")),
    outbox: readJson<{ boards: unknown[] }>(join(dir, "outbox.json"))?.boards.length ?? 0,
    sharing: !!contributeUrl(),
  };
}

/**
 * Live companies to scan per industry, as the directory build counted them; null for a directory
 * built before it counted (so an industry it didn't know isn't mistaken for an empty one).
 */
export function directoryIndustryCounts(dataDir: string): Record<string, number> | null {
  return readJson<{ industries?: Record<string, number> }>(join(catalogDir(dataDir), "directory.json"))?.industries ?? null;
}

/** Days since the local copy was downloaded (Infinity when there is none). */
export function directoryAgeDays(dataDir: string, now = Date.now()): number {
  const updated = directoryStatus(dataDir).local?.updated_at;
  return updated ? (now - Date.parse(updated)) / 86_400_000 : Infinity;
}

export type UpdateResult = { updated: boolean; version?: string; companies?: number; message: string };

/**
 * Download the latest shared directory if it's newer than the local copy. Files are checked
 * against the manifest's SHA-256 and swapped in only when both arrive intact.
 */
export async function updateDirectory(dataDir: string, opts: { force?: boolean; fetchImpl?: typeof fetch } = {}): Promise<UpdateResult> {
  const get = opts.fetchImpl ?? fetch;
  const base = directoryUrl();
  const res = await get(`${base}/manifest.json`, { headers: { accept: "application/json" }, redirect: "follow" });
  if (!res.ok) return { updated: false, message: `Couldn't reach the shared directory (HTTP ${res.status}).` };
  const manifest = (await res.json()) as DirectoryManifest;
  const current = directoryStatus(dataDir).local;
  if (!opts.force && current?.version === manifest.version) return { updated: false, version: manifest.version, companies: manifest.companies, message: "Already up to date." };

  const unsafe = Object.keys(manifest.files ?? {}).find((f) => !isSafeName(f));
  if (unsafe !== undefined) return { updated: false, message: `The shared directory's manifest names an unsafe file (${JSON.stringify(unsafe)}); kept your current directory.` };

  const dir = catalogDir(dataDir);
  mkdirSync(dir, { recursive: true });
  const staged: [string, Buffer][] = [];
  for (const [file, meta] of Object.entries(manifest.files)) {
    const r = await get(`${base}/${file}`, { redirect: "follow" });
    if (!r.ok) return { updated: false, message: `Download of ${file} failed (HTTP ${r.status}).` };
    const gz = Buffer.from(await r.arrayBuffer());
    if (createHash("sha256").update(gz).digest("hex") !== meta.sha256) return { updated: false, message: `${file} didn't match its checksum; kept your current directory.` };
    staged.push([file.replace(/\.gz$/, ""), gunzipSync(gz)]);
  }
  for (const [name, body] of staged) {
    writeFileSync(safeJoin(dir, `${name}.tmp`), body);
    renameSync(safeJoin(dir, `${name}.tmp`), safeJoin(dir, name));
  }
  writeFileSync(join(dir, "manifest.json"), JSON.stringify({ ...manifest, updated_at: new Date().toISOString() }, null, 2));
  return { updated: true, version: manifest.version, companies: manifest.companies, message: `Updated to ${manifest.companies.toLocaleString()} companies.` };
}

export type SyncResult = UpdateResult & { /** The shared directory couldn't be reached; the local copy is used. */ offline?: boolean };

/**
 * The first step of every scan: make the local directory match the shared one. Checks the small
 * manifest every time and downloads only a new version. Never throws: offline, the scan carries on
 * with the local copy.
 */
export async function syncDirectory(dataDir: string, opts: { fetchImpl?: typeof fetch } = {}): Promise<SyncResult> {
  try {
    const r = await updateDirectory(dataDir, opts);
    return r.updated || r.version ? r : { ...r, offline: true };
  } catch (err) {
    return { updated: false, offline: true, message: `Couldn't reach the shared directory (${(err as Error).message}); using your local copy.` };
  }
}

/** A board to share: what the directory needs to find it again, nothing about the user. */
export type SharedBoard = { ats: string; slug: string; region?: string; shard?: string; site?: string; name?: string };

/** Remember boards to share (kept until the inbox accepts them). */
export function queueContributions(dataDir: string, boards: SharedBoard[]): number {
  if (!boards.length) return 0;
  const file = join(catalogDir(dataDir), "outbox.json");
  const current = readJson<{ boards: SharedBoard[] }>(file)?.boards ?? [];
  const key = (b: SharedBoard) => `${b.ats}:${b.slug}|${b.shard ?? ""}|${b.site ?? ""}`.toLowerCase();
  const seen = new Set(current.map(key));
  const next = [...current];
  for (const b of boards) {
    if (seen.has(key(b))) continue;
    seen.add(key(b));
    next.push(b);
  }
  mkdirSync(catalogDir(dataDir), { recursive: true });
  writeFileSync(file, JSON.stringify({ boards: next }, null, 1));
  return next.length;
}

/**
 * Send waiting boards to the inbox; on success the outbox is emptied. Never throws.
 * With sharing turned off (`enabled: false`), waiting boards are discarded, never sent.
 */
export async function sendContributions(dataDir: string, opts: { fetchImpl?: typeof fetch; client?: string; enabled?: boolean } = {}): Promise<{ sent: number; message: string }> {
  const file = join(catalogDir(dataDir), "outbox.json");
  if (opts.enabled === false) {
    if (existsSync(file)) writeFileSync(file, JSON.stringify({ boards: [] }, null, 1));
    return { sent: 0, message: "Sharing is off in your settings." };
  }
  const url = contributeUrl();
  if (!url) return { sent: 0, message: "Sharing isn't set up for this install." };
  const boards = readJson<{ boards: SharedBoard[] }>(file)?.boards ?? [];
  if (!boards.length) return { sent: 0, message: "Nothing to share." };
  let sent = 0;
  try {
    for (let i = 0; i < boards.length; i += 25) {
      const batch = boards.slice(i, i + 25);
      const res = await (opts.fetchImpl ?? fetch)(`${url}/v1/contributions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ client: opts.client ?? "rawjobs", boards: batch }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok && res.status !== 400) throw new Error(`HTTP ${res.status}`);
      sent += batch.length;
    }
  } catch (err) {
    writeFileSync(file, JSON.stringify({ boards: boards.slice(sent) }, null, 1));
    return { sent, message: `Shared ${sent}; the rest will be retried (${(err as Error).message}).` };
  }
  writeFileSync(file, JSON.stringify({ boards: [] }, null, 1));
  return { sent, message: `Shared ${sent} compan${sent === 1 ? "y" : "ies"} with the directory.` };
}

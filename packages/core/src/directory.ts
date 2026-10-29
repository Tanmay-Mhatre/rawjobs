import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { fetchSignedJson, FILE_TIMEOUT_MS } from "./data-signing";
import { envSetting } from "./env";
import { isSafeName, safeJoin } from "./safe-name";
import { writeFileAtomic } from "./atomic";
import { ATS_TYPES } from "./schema";

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
  /**
   * The local copy's manifest, if it came from the shared directory. `updated_at`: when this version
   * was downloaded; `checked_at`: the last successful check for a newer one.
   */
  local?: DirectoryManifest & { updated_at: string; checked_at?: string };
  /** A directory exists locally (downloaded or built here). */
  present: boolean;
  /** Boards added here and waiting to be shared (boards only: careers-link moves are counted in `moves`). */
  outbox: number;
  /** Confirmed careers-link moves waiting to be shared with the next directory update. */
  moves: number;
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
    moves: readJson<{ moves: unknown[] }>(join(dir, MOVES_OUTBOX))?.moves.length ?? 0,
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
  const signed = await fetchSignedJson<DirectoryManifest>(get, `${base}/manifest.json`);
  if (!signed.ok)
    return {
      updated: false,
      message: signed.status ? `Couldn't reach the shared directory (HTTP ${signed.status}).` : "The shared directory's signature isn't valid; kept your current directory.",
    };
  const manifest = signed.value;
  const current = directoryStatus(dataDir).local;
  if (!opts.force && current?.version === manifest.version) {
    try {
      writeFileAtomic(join(catalogDir(dataDir), "manifest.json"), JSON.stringify({ ...current, checked_at: new Date().toISOString() }, null, 2));
    } catch {
      // Only the "checked" time is lost; the copy is still up to date.
    }
    return { updated: false, version: manifest.version, companies: manifest.companies, message: "Already up to date." };
  }

  const unsafe = Object.keys(manifest.files ?? {}).find((f) => !isSafeName(f));
  if (unsafe !== undefined) return { updated: false, message: `The shared directory's manifest names an unsafe file (${JSON.stringify(unsafe)}); kept your current directory.` };

  const dir = catalogDir(dataDir);
  mkdirSync(dir, { recursive: true });
  const staged: [string, Buffer][] = [];
  for (const [file, meta] of Object.entries(manifest.files)) {
    const r = await get(`${base}/${file}`, { redirect: "follow", signal: AbortSignal.timeout(FILE_TIMEOUT_MS) });
    if (!r.ok) return { updated: false, message: `Download of ${file} failed (HTTP ${r.status}).` };
    const gz = Buffer.from(await r.arrayBuffer());
    if (createHash("sha256").update(gz).digest("hex") !== meta.sha256) return { updated: false, message: `${file} didn't match its checksum; kept your current directory.` };
    staged.push([file.replace(/\.gz$/, ""), gunzipSync(gz)]);
  }
  const now = new Date().toISOString();
  for (const [name, body] of staged) {
    writeFileSync(safeJoin(dir, `${name}.tmp`), body);
    renameSync(safeJoin(dir, `${name}.tmp`), safeJoin(dir, name));
  }
  writeFileAtomic(join(dir, "manifest.json"), JSON.stringify({ ...manifest, updated_at: now, checked_at: now }, null, 2));
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

const SCANNABLE = new Set<string>(ATS_TYPES);
/** What `shard` may look like per system (the rest have none). */
const SHARD: Record<string, RegExp> = { workday: /^wd\d{1,3}$/, oracle: /^[a-z0-9-]{2,30}$/, successfactors: /^[a-z0-9.-]{1,60}\.(successfactors|sapsf)\.(com|eu)$/ };
/** Systems that need `site` (the rest may carry one). */
const NEEDS_SITE = new Set(["workday", "taleo", "comeet"]);
const SLUG = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
/** A company name as shared: no control characters or angle brackets, trimmed, at most `max` characters. */
const cleanName = (name: unknown, max: number) =>
  typeof name === "string"
    ? name
        // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping control characters is the point
        .replace(/[\u0000-\u001f<>]/g, "")
        .trim()
        .slice(0, max)
    : "";

/**
 * A board as an app shares it, cleaned up, or the reason it can't be used. The contribution inbox
 * (services/contribute) applies the same rules, and the contributions workflow (scripts/catalog) uses this.
 */
export function cleanSharedBoard(raw: unknown): SharedBoard | string {
  if (!raw || typeof raw !== "object") return "not an object";
  const b = raw as Record<string, unknown>;
  if (typeof b.ats !== "string" || !SCANNABLE.has(b.ats)) return `unsupported hiring system "${String(b.ats)}"`;
  if (typeof b.slug !== "string" || !SLUG.test(b.slug)) return "bad slug";
  if (b.region !== undefined && b.region !== "eu" && b.region !== "global") return "bad region";
  if (b.ats === "workday" && !(typeof b.shard === "string" && SHARD.workday!.test(b.shard) && typeof b.site === "string" && SLUG.test(b.site))) return "workday needs shard and site";
  if (b.shard !== undefined && !(SHARD[b.ats] && typeof b.shard === "string" && SHARD[b.ats]!.test(b.shard))) return "bad shard";
  if (b.ats === "oracle" && b.shard === undefined) return "oracle needs shard";
  if (b.site !== undefined && !(typeof b.site === "string" && SLUG.test(b.site))) return "bad site";
  if (NEEDS_SITE.has(b.ats) && b.site === undefined) return `${b.ats} needs site`;
  const name = cleanName(b.name, 100);
  return {
    ats: b.ats,
    slug: b.slug,
    ...(b.region === "eu" ? { region: "eu" } : {}),
    ...(typeof b.shard === "string" && b.shard ? { shard: b.shard } : {}),
    ...(typeof b.site === "string" && b.site ? { site: b.site } : {}),
    ...(name ? { name } : {}),
  };
}

/** A board's key, as the inbox writes it: `ats:slug|shard|site`, lowercased. */
export const sharedBoardKey = (b: Pick<SharedBoard, "ats" | "slug" | "shard" | "site">) => `${b.ats}:${b.slug}|${b.shard ?? ""}|${b.site ?? ""}`.toLowerCase();

/** Remember boards to share (kept until the inbox accepts them). */
export function queueContributions(dataDir: string, boards: SharedBoard[]): number {
  if (!boards.length) return 0;
  const file = join(catalogDir(dataDir), "outbox.json");
  const current = readJson<{ boards: SharedBoard[] }>(file)?.boards ?? [];
  const key = sharedBoardKey;
  const seen = new Set(current.map(key));
  const next = [...current];
  for (const b of boards) {
    if (seen.has(key(b))) continue;
    seen.add(key(b));
    next.push(b);
  }
  mkdirSync(catalogDir(dataDir), { recursive: true });
  writeFileAtomic(file, JSON.stringify({ boards: next }, null, 1));
  return next.length;
}

/**
 * Send waiting boards to the inbox; on success the outbox is emptied. Never throws.
 * With sharing turned off (`enabled: false`), waiting boards are discarded, never sent.
 */
export async function sendContributions(dataDir: string, opts: { fetchImpl?: typeof fetch; client?: string; enabled?: boolean } = {}): Promise<{ sent: number; message: string }> {
  const file = join(catalogDir(dataDir), "outbox.json");
  if (opts.enabled === false) {
    if (existsSync(file)) writeFileAtomic(file, JSON.stringify({ boards: [] }, null, 1));
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
    writeFileAtomic(file, JSON.stringify({ boards: boards.slice(sent) }, null, 1));
    return { sent, message: `Shared ${sent}; the rest will be retried (${(err as Error).message}).` };
  }
  writeFileAtomic(file, JSON.stringify({ boards: [] }, null, 1));
  return { sent, message: `Shared ${sent} compan${sent === 1 ? "y" : "ies"} with the directory.` };
}

/** A board in a move report: where to find it, no name. */
export type MoveBoard = Omit<SharedBoard, "name">;
/**
 * A company's careers board moved from one board to another, as the user confirmed it. Shared with
 * the next directory update (sendMoves), never at the moment it's confirmed.
 */
export type MoveReport = { name: string; from: MoveBoard; to: MoveBoard };
type QueuedMove = MoveReport & { /** When it was queued (ISO time). */ at: string };

/** The moves outbox, next to the boards' outbox.json: `{ moves: [{ name, from, to, at }] }`. */
const MOVES_OUTBOX = "moves-outbox.json";
/** Moves per request (the inbox takes at most 10). */
const MOVES_BATCH = 10;
const moveKey = (m: MoveReport) => `${sharedBoardKey(m.from)}>${sharedBoardKey(m.to)}`;
const readMoves = (file: string) => readJson<{ moves: QueuedMove[] }>(file)?.moves ?? [];

/** A move report cleaned up (two well-shaped, different boards and a name), or the reason it can't be shared. */
export function cleanMove(raw: unknown): MoveReport | string {
  if (!raw || typeof raw !== "object") return "not an object";
  const o = raw as Record<string, unknown>;
  const name = cleanName(o.name, 120);
  if (!name) return "name is missing";
  const from = cleanSharedBoard(o.from);
  if (typeof from === "string") return `from: ${from}`;
  const to = cleanSharedBoard(o.to);
  if (typeof to === "string") return `to: ${to}`;
  const { name: _fromName, ...fromBoard } = from;
  const { name: _toName, ...toBoard } = to;
  if (sharedBoardKey(fromBoard) === sharedBoardKey(toBoard)) return "from and to are the same board";
  return { name, from: fromBoard, to: toBoard };
}

/**
 * Remember a confirmed move to share with the next directory update (kept until the inbox takes it),
 * once per from+to. Sends nothing. Answers with the move as queued, or why it can't be shared.
 */
export function queueMove(dataDir: string, move: unknown, now = new Date()): { ok: true; move: MoveReport; waiting: number } | { ok: false; error: string } {
  const clean = cleanMove(move);
  if (typeof clean === "string") return { ok: false, error: clean };
  const file = join(catalogDir(dataDir), MOVES_OUTBOX);
  const current = readMoves(file);
  if (!current.some((m) => moveKey(m) === moveKey(clean))) {
    current.push({ ...clean, at: now.toISOString() });
    mkdirSync(catalogDir(dataDir), { recursive: true });
    writeFileAtomic(file, JSON.stringify({ moves: current }, null, 1));
  }
  return { ok: true, move: clean, waiting: current.length };
}

/**
 * Send waiting move reports to the inbox (`/v1/moves`), 10 a request, alongside sendContributions
 * on the directory update. Never throws.
 * - 2xx, or 400 (the inbox won't ever take it): dropped.
 * - 404 (an inbox from before moves), 429 (full for the day, or rate-limited), 503 (not open yet),
 *   any other error, or no connection: kept for the next update.
 * - Sharing turned off (`enabled: false`): dropped, never sent.
 */
export async function sendMoves(dataDir: string, opts: { fetchImpl?: typeof fetch; client?: string; enabled?: boolean } = {}): Promise<{ sent: number; message: string }> {
  const file = join(catalogDir(dataDir), MOVES_OUTBOX);
  if (opts.enabled === false) {
    if (existsSync(file)) writeFileAtomic(file, JSON.stringify({ moves: [] }, null, 1));
    return { sent: 0, message: "Sharing is off in your settings." };
  }
  const url = contributeUrl();
  if (!url) return { sent: 0, message: "Sharing isn't set up for this install." };
  const moves = readMoves(file);
  if (!moves.length) return { sent: 0, message: "No moves to share." };
  const done = new Set<string>();
  let sent = 0;
  let failure: string | undefined;
  try {
    for (let i = 0; i < moves.length; i += MOVES_BATCH) {
      const batch = moves.slice(i, i + MOVES_BATCH);
      const res = await (opts.fetchImpl ?? fetch)(`${url}/v1/moves`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ client: opts.client ?? "rawjobs", moves: batch.map(({ name, from, to }) => ({ name, from, to })) }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok && res.status !== 400) throw new Error(`HTTP ${res.status}`);
      for (const m of batch) done.add(moveKey(m));
      if (res.ok) sent += batch.length;
    }
  } catch (err) {
    failure = (err as Error).message;
  }
  // Read the outbox again: a move confirmed while these were on their way stays for next time.
  if (done.size) writeFileAtomic(file, JSON.stringify({ moves: readMoves(file).filter((m) => !done.has(moveKey(m))) }, null, 1));
  if (failure) return { sent, message: `Shared ${sent} careers-link move${sent === 1 ? "" : "s"}; the rest will be retried (${failure}).` };
  return { sent, message: `Shared ${sent} careers-link move${sent === 1 ? "" : "s"} with the directory.` };
}

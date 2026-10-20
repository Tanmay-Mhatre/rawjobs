/**
 * Your LinkedIn connections on disk (`profile/network.json`) and the in-memory index the API answers
 * from. Node only. Every write goes through one queue, so an import and a close-contact mark can't
 * overwrite each other; the index is rebuilt right after each save.
 */
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { readJsonOrSetAside, writeFileAtomic } from "../atomic";
import { buildNetworkIndex, matchingKeys, type NetworkIndex } from "./company";
import { buildNetwork, type ExportErrorCode, type ExportFiles } from "./linkedin-export";
import type { NetworkConnection, NetworkFile, NetworkMe, NetworkPeople, NetworkPersonRow, NetworkPosition, NetworkSchool, NetworkStatus, NetworkSummary } from "./types";

export const NETWORK_PATH = "profile/network.json";
export const NETWORK_WATCH_PATH = "profile/network-watch.json";
/** At most this many people per company in one answer; the browser ranks them. */
export const MAX_PEOPLE = 200;
/** What a close-contact id looks like: "u:" + a profile slug, or "n:" + a hash. */
export const CONNECTION_ID = /^[un]:[\w-]{1,100}$/;

const DAY = 86_400_000;

export type ImportResult = { ok: true; status: NetworkStatus } | { ok: false; code: ExportErrorCode | "NEWER_FILE" };

type Loaded = {
  file: NetworkFile;
  index: NetworkIndex;
  byId: Map<string, NetworkConnection>;
  friends: Set<string>;
  /** networkKey → how many connections work there; counted once per build. */
  counts: Record<string, number>;
};

/** What's on disk: nothing, a file made by a newer RawJobs (never overwritten), or one we can read. */
type OnDisk = { kind: "none" } | { kind: "newer" } | { kind: "ready"; loaded: Loaded };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function build(file: NetworkFile): Loaded {
  const index = buildNetworkIndex(file.connections);
  const counts: Record<string, number> = {};
  for (const [key, ids] of index.byKey) counts[key] = ids.length;
  return { file, index, byId: new Map(file.connections.map((c) => [c.id, c])), friends: new Set(file.friends), counts };
}

function read(path: string): OnDisk {
  const raw = readJsonOrSetAside<unknown>(path);
  if (!isRecord(raw) || raw.app !== "rawjobs" || raw.kind !== "network") return { kind: "none" };
  if (typeof raw.version === "number" && raw.version > 1) return { kind: "newer" };
  if (raw.version !== 1 || !Array.isArray(raw.connections) || typeof raw.importedAt !== "string") return { kind: "none" };
  const file: NetworkFile = {
    app: "rawjobs",
    kind: "network",
    version: 1,
    importedAt: raw.importedAt,
    source: raw.source === "downloads" ? "downloads" : "file",
    connections: (raw.connections as unknown[]).filter((c): c is NetworkConnection => isRecord(c) && typeof c.id === "string" && typeof c.first === "string" && typeof c.last === "string"),
    positions: Array.isArray(raw.positions) ? (raw.positions as unknown[]).filter((p): p is NetworkPosition => isRecord(p) && typeof p.company === "string") : [],
    education: Array.isArray(raw.education) ? (raw.education as unknown[]).filter((s): s is NetworkSchool => isRecord(s) && typeof s.name === "string") : [],
    friends: Array.isArray(raw.friends) ? (raw.friends as unknown[]).filter((id): id is string => typeof id === "string") : [],
  };
  if (typeof raw.fileName === "string") file.fileName = raw.fileName;
  return { kind: "ready", loaded: build(file) };
}

/** The store for one RawJobs folder. The server keeps one for its lifetime. */
export function createNetworkStore(home: string, now: () => Date = () => new Date()) {
  const path = resolve(home, NETWORK_PATH);
  let disk: OnDisk = { kind: "none" };
  /** The file's mtime when it was read, so a change made by another RawJobs is picked up. */
  let seen: number | null = null;
  let queue: Promise<unknown> = Promise.resolve();

  const mtime = () => {
    try {
      return statSync(path).mtimeMs;
    } catch {
      return null;
    }
  };
  function current(): OnDisk {
    const m = mtime();
    if (m !== seen) {
      disk = m === null ? { kind: "none" } : read(path);
      seen = mtime();
    }
    return disk;
  }
  function save(file: NetworkFile) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileAtomic(path, `${JSON.stringify(file)}\n`);
    disk = { kind: "ready", loaded: build(file) };
    seen = mtime();
  }
  /** One write at a time, in order; a failed write doesn't block the next. */
  function enqueue<T>(job: () => T): Promise<T> {
    const next = queue.then(job, job);
    queue = next.catch(() => {});
    return next;
  }

  function status(): NetworkStatus {
    const d = current();
    if (d.kind === "newer") return { connected: false, watch: null, newer: true };
    if (d.kind === "none") return { connected: false, watch: null };
    const { file, counts } = d.loaded;
    const s: NetworkStatus = {
      connected: true,
      importedAt: file.importedAt,
      source: file.source,
      counts: { connections: file.connections.length, positions: file.positions.length, education: file.education.length, companies: Object.keys(counts).length },
      ageDays: Math.max(0, Math.floor((now().getTime() - Date.parse(file.importedAt)) / DAY)),
      watch: null,
    };
    if (file.fileName) s.fileName = file.fileName;
    return s;
  }

  // Built at start, not on the first request.
  current();

  return {
    status,
    /** Your own positions and schools, for scoring and the alumni and past-colleague searches. */
    me(): NetworkMe | null {
      const d = current();
      return d.kind === "ready" ? { positions: d.loaded.file.positions, schools: d.loaded.file.education } : null;
    },
    summary(): NetworkSummary {
      const d = current();
      return d.kind === "ready" ? { importedAt: d.loaded.file.importedAt, counts: d.loaded.counts } : { importedAt: null, counts: {} };
    },
    /** Who you know at a company, oldest connection first. */
    people(company: string): NetworkPeople {
      const d = current();
      if (d.kind !== "ready") return { how: "none", people: [] };
      const { index, byId, friends } = d.loaded;
      const { keys, how } = matchingKeys(company, index);
      const today = now().getTime();
      const people = keys
        .flatMap((k) => index.byKey.get(k) ?? [])
        .map((id) => byId.get(id))
        .filter((c): c is NetworkConnection => !!c)
        .sort((a, b) => (a.connectedOn ?? "9999").localeCompare(b.connectedOn ?? "9999"))
        .slice(0, MAX_PEOPLE)
        .map(({ connectedOn, ...c }): NetworkPersonRow => {
          const row: NetworkPersonRow = { ...c, friend: friends.has(c.id) };
          const at = connectedOn ? Date.parse(`${connectedOn}T00:00:00Z`) : Number.NaN;
          if (Number.isFinite(at)) row.connectedDays = Math.max(0, Math.floor((today - at) / DAY));
          return row;
        });
      return { how, people };
    },
    /** Read the three CSV texts and replace the saved connections. Close-contact marks carry over by id. */
    import(files: ExportFiles, opts: { source: "file" | "downloads"; fileName?: string }): Promise<ImportResult> {
      return enqueue((): ImportResult => {
        const d = current();
        if (d.kind === "newer") return { ok: false, code: "NEWER_FILE" };
        const keepFriends = d.kind === "ready" ? d.loaded.file.friends : [];
        const next = buildNetwork(files, { ...opts, now: now(), keepFriends });
        if ("error" in next) return { ok: false, code: next.error };
        save(next);
        return { ok: true, status: status() };
      });
    },
    /** Mark or unmark a close contact. False when there's no such connection (or the file is newer). */
    setFriend(id: string, on: boolean): Promise<boolean> {
      return enqueue(() => {
        const d = current();
        if (d.kind !== "ready" || !CONNECTION_ID.test(id) || !d.loaded.byId.has(id)) return false;
        const { file } = d.loaded;
        const friends = file.friends.filter((f) => f !== id);
        if (on) friends.push(id);
        if (friends.length > 2_000) return false;
        save({ ...file, friends });
        return true;
      });
    },
    /** Delete the connections, the watch state, and any half-written or set-aside copies. */
    remove(): Promise<void> {
      return enqueue(() => {
        deleteNetworkFiles(home);
        disk = { kind: "none" };
        seen = null;
      });
    },
  };
}

export type NetworkStore = ReturnType<typeof createNetworkStore>;

/** Removes network.json, network-watch.json and the .tmp / .bad files next to them. */
export function deleteNetworkFiles(home: string): void {
  const dir = resolve(home, "profile");
  if (!existsSync(dir)) return;
  const names = ["network.json", "network-watch.json"];
  for (const f of readdirSync(dir)) {
    if (names.some((n) => f === n || (f.startsWith(`${n}.`) && (f.endsWith(".tmp") || f.endsWith(".bad"))))) rmSync(resolve(dir, f), { force: true });
  }
}

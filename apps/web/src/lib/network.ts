/**
 * Your LinkedIn connections, as the page sees them: the import status, who you know at a company,
 * and the import, close-contact and delete calls. Local only: on the hosted copy every hook stays
 * empty and every call is a no-op. The ZIP is read here in the browser, and only the three CSV texts
 * are posted, so your messages and the rest of the export never leave the file.
 */
import { networkKey } from "@rawjobs/core/network/company";
import { type ExportFiles, exportFilesFromEntries, isAllowedEntry } from "@rawjobs/core/network/linkedin-export";
import type { NetworkMe, NetworkPeople, NetworkPersonRow, NetworkStatus, WatchState } from "@rawjobs/core/network/types";
import { readZipEntries, ZipError } from "@rawjobs/core/network/zip";
import { blobZipSource, canInflateRaw, inflateRawStream } from "@rawjobs/core/network/zip-browser";
import { useEffect, useSyncExternalStore } from "react";
import { toast } from "../components/Toast";
import { canRunLocally } from "./data";

export type { NetworkMe, NetworkPeople, NetworkPersonRow, NetworkStatus, WatchState };
/** watchable: this computer offers the Downloads watch (not macOS in this release). */
export type NetworkInfo = { status: NetworkStatus; me: NetworkMe | null; watchable?: boolean };
export type Loadable<T> = { state: "loading" } | { state: "ready"; value: T } | { state: "error" };

/** From this many days after an import, Settings and the job panel suggest a fresh copy. */
export const REFRESH_AFTER_DAYS = 30;

/** The server's own limit on an import (12 MB): checked here first, so a big file never gets posted. */
export const IMPORT_MAX_CHARS = 12_000_000;

export type ImportErrorCode = "NOT_ZIP" | "ZIP_MALFORMED" | "ZIP_TOO_BIG" | "ZIP_ENCRYPTED" | "NO_CONNECTIONS" | "TOO_BIG" | "NEWER_FILE" | "NO_UNZIP" | "FAILED";

/** Shown instead of the ZIP steps where this browser can't open ZIP files. */
export const UNZIP_FIRST = "Unzip the file and choose Connections.csv";

/** What each import error says, in the dialog. */
export const IMPORT_ERROR: Record<ImportErrorCode, string> = {
  NO_UNZIP: `This browser can't open ZIP files. ${UNZIP_FIRST}.`,
  NOT_ZIP: "That file isn't a ZIP from LinkedIn. Choose the file named like Basic_LinkedInDataExport_….zip.",
  ZIP_MALFORMED: "That ZIP looks damaged. Download it from LinkedIn again.",
  ZIP_TOO_BIG: "That export is too big to read here. Request only Connections, Positions and Education.",
  TOO_BIG: "That export is too big to read here. Request only Connections, Positions and Education.",
  ZIP_ENCRYPTED: "That ZIP has a password, so RawJobs can't read it. Request a new archive from LinkedIn.",
  NO_CONNECTIONS: "That ZIP has no Connections.csv. Request the larger data archive instead.",
  NEWER_FILE: "Your connections were saved by a newer RawJobs. Update RawJobs to read them.",
  FAILED: "Couldn't import the file. Check that RawJobs is running, then try again.",
};

// One small store for the whole page: status, and people per company key. `gen` goes up on every
// import or delete, so an answer that was on its way before it is dropped.
let gen = 0;
let info: Loadable<NetworkInfo> | undefined;
const people = new Map<string, Loadable<NetworkPeople>>();
const listeners = new Set<() => void>();
const emit = () => {
  for (const l of listeners) l();
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(String(r.status));
  return (await r.json()) as T;
}

function loadInfo() {
  if (!canRunLocally || info) return;
  const g = gen;
  info = { state: "loading" };
  emit();
  getJson<NetworkInfo>("/api/network").then(
    (value) => {
      if (g !== gen) return;
      info = { state: "ready", value };
      emit();
      syncWatchPoll();
    },
    () => {
      if (g !== gen) return;
      info = { state: "error" };
      emit();
    },
  );
}

/** How often an open page asks whether the Downloads watch found the file. */
export const WATCH_POLL_MS = 10_000;
let pollTimer: ReturnType<typeof setTimeout> | undefined;
const importedAtOf = (s: NetworkStatus) => (s.connected ? s.importedAt : null);

/** While a Downloads watch runs, ask every 10 s; stop asking once it's over. */
function syncWatchPoll() {
  // A malformed answer (no status) counts as not watching.
  const watching = info?.state === "ready" && !!info.value.status?.watch;
  if (!watching) {
    clearTimeout(pollTimer);
    pollTimer = undefined;
  } else if (!pollTimer) pollTimer = setTimeout(() => void pollWatch(), WATCH_POLL_MS);
}

async function pollWatch() {
  pollTimer = undefined;
  if (info?.state !== "ready") return;
  const before = importedAtOf(info.value.status);
  const g = gen;
  try {
    const value = await getJson<NetworkInfo>("/api/network");
    if (g !== gen) return;
    if (value.status.connected && value.status.importedAt !== before) {
      // The watch found and imported LinkedIn's file: refresh everything that shows your connections.
      networkChanged();
      if (value.status.source === "downloads") toast({ message: `Imported ${value.status.counts.connections.toLocaleString()} connections from Downloads` });
      return;
    }
    info = { state: "ready", value };
    emit();
  } catch {
    // RawJobs may be restarting: ask again next time.
  }
  syncWatchPoll();
}

/** Why a watch couldn't start, in the dialog. */
export const WATCH_ERROR = {
  NO_ACCESS: "RawJobs can't look in Downloads. Choose the file instead.",
  NO_FOLDER: "RawJobs couldn't find your Downloads folder. Choose the file instead.",
  FAILED: "Couldn't watch Downloads. Choose the file instead.",
} as const;

/** Ask RawJobs to pick up LinkedIn's file from Downloads by itself. Returns an error to show, or null. */
export async function startWatch(): Promise<string | null> {
  if (!canRunLocally) return null;
  try {
    const r = await fetch("/api/network/watch", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    const res = (await r.json()) as { watch: WatchState | null; error?: string };
    if (!res.watch) return res.error === "NO_ACCESS" || res.error === "NO_FOLDER" ? WATCH_ERROR[res.error] : WATCH_ERROR.FAILED;
    setWatch(res.watch);
    return null;
  } catch {
    return WATCH_ERROR.FAILED;
  }
}

/** Stop watching Downloads. */
export async function stopWatch(): Promise<void> {
  if (!canRunLocally) return;
  try {
    await fetch("/api/network/watch", { method: "DELETE" });
  } catch {
    // The next status read shows whether it stopped.
  }
  setWatch(null);
}

function setWatch(watch: WatchState | null) {
  if (info?.state !== "ready") return;
  info = { state: "ready", value: { ...info.value, status: { ...info.value.status, watch } } };
  emit();
  syncWatchPoll();
}

function loadPeople(company: string, key: string) {
  if (people.has(key)) return;
  const g = gen;
  people.set(key, { state: "loading" });
  emit();
  getJson<NetworkPeople>(`/api/network/people?company=${encodeURIComponent(company)}`).then(
    (value) => {
      if (g !== gen) return;
      people.set(key, { state: "ready", value });
      emit();
    },
    () => {
      if (g !== gen) return;
      people.set(key, { state: "error" });
      emit();
    },
  );
}

/** How many people you know per company key, for the Radar. Counts exact and alias matches only. */
export type NetworkSummary = { importedAt: string | null; counts: Record<string, number> };
let summary: NetworkSummary | undefined;
let summaryAsked = false;

function loadSummary() {
  if (!canRunLocally || summaryAsked) return;
  summaryAsked = true;
  const g = gen;
  getJson<NetworkSummary>("/api/network/summary").then(
    (value) => {
      if (g !== gen) return;
      summary = value;
      emit();
    },
    () => {},
  );
}

/** Your connections per company key, once imported; undefined before that and on the hosted copy. */
export function useNetworkSummary(): NetworkSummary | undefined {
  useEffect(loadSummary, []);
  return useSyncExternalStore(subscribe, () => (summary?.importedAt ? summary : undefined));
}

/**
 * How many people you know at a job's company, from the summary's counts. Each company name is keyed
 * (networkKey) once and remembered, so a long list doesn't key the same name for every job.
 */
export function knownCounter(counts: Readonly<Record<string, number>>): (j: { company: string }) => number {
  const byName = new Map<string, number>();
  return (j) => {
    let n = byName.get(j.company);
    if (n === undefined) {
      const key = networkKey(j.company);
      n = key && Object.hasOwn(counts, key) ? (counts[key] ?? 0) : 0;
      byName.set(j.company, n);
    }
    return n;
  };
}

/** After an import or delete: forget everything and read the status again. */
export function networkChanged(): void {
  gen++;
  info = undefined;
  summary = undefined;
  const reloadSummary = summaryAsked;
  summaryAsked = false;
  people.clear();
  emit();
  loadInfo();
  if (reloadSummary) loadSummary();
}

/** Your import status and your own positions and schools. Undefined on the hosted copy. */
export function useNetwork(): Loadable<NetworkInfo> | undefined {
  useEffect(loadInfo, []);
  return useSyncExternalStore(subscribe, () => info);
}

/** Who you know at `company` (one request per company key per page load). Undefined when not asked. */
export function usePeopleAt(company: string, enabled: boolean): Loadable<NetworkPeople> | undefined {
  const key = canRunLocally && enabled ? networkKey(company) : null;
  useEffect(() => {
    if (key) loadPeople(company, key);
  }, [key, company]);
  return useSyncExternalStore(subscribe, () => (key ? people.get(key) : undefined));
}

/** The three CSV texts from a picked or dropped file: LinkedIn's ZIP, or Connections.csv itself. */
export async function readExportFile(file: File): Promise<ExportFiles | { error: ImportErrorCode }> {
  if (/\.csv$/i.test(file.name)) return { connections: await file.text() };
  if (!canInflateRaw()) return { error: "NO_UNZIP" };
  try {
    return exportFilesFromEntries(await readZipEntries(blobZipSource(file), inflateRawStream, isAllowedEntry));
  } catch (err) {
    if (err instanceof ZipError) return { error: err.code };
    return { error: "NOT_ZIP" };
  }
}

/** Read the file and send its three CSVs to RawJobs on this computer. */
export async function importNetworkFile(file: File): Promise<{ ok: true; status: NetworkStatus } | { ok: false; code: ImportErrorCode }> {
  if (!canRunLocally) return { ok: false, code: "FAILED" };
  const files = await readExportFile(file);
  if ("error" in files) return { ok: false, code: files.error };
  if (files.connections === undefined) return { ok: false, code: "NO_CONNECTIONS" };
  const body = JSON.stringify({ fileName: file.name, files });
  if (body.length > IMPORT_MAX_CHARS) return { ok: false, code: "TOO_BIG" };
  try {
    const r = await fetch("/api/network/import", { method: "POST", headers: { "content-type": "application/json" }, body });
    const res = (await r.json()) as { ok: true; status: NetworkStatus } | { ok: false; errors?: { code?: string }[] };
    if (res.ok) {
      networkChanged();
      return res;
    }
    const code = res.errors?.[0]?.code;
    return { ok: false, code: code && code in IMPORT_ERROR ? (code as ImportErrorCode) : "FAILED" };
  } catch {
    return { ok: false, code: "FAILED" };
  }
}

/** Delete your connections from this computer. Returns an error to show, or null. */
export async function deleteNetwork(): Promise<string | null> {
  if (!canRunLocally) return null;
  try {
    const r = await fetch("/api/network", { method: "DELETE" });
    if (!r.ok) throw new Error(String(r.status));
    networkChanged();
    return null;
  } catch {
    return "Couldn't delete your connections. Check that RawJobs is running, then try again.";
  }
}

/** Mark someone as a close contact (or not). Shown at once; put back if it can't be saved. */
export async function setCloseContact(id: string, on: boolean): Promise<boolean> {
  if (!canRunLocally) return false;
  const mark = (friend: boolean) => {
    for (const [key, entry] of people) {
      if (entry.state !== "ready" || !entry.value.people.some((p) => p.id === id)) continue;
      people.set(key, { state: "ready", value: { ...entry.value, people: entry.value.people.map((p) => (p.id === id ? { ...p, friend } : p)) } });
    }
    emit();
  };
  mark(on);
  try {
    const r = await fetch("/api/network/friends", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, friend: on }) });
    if (!r.ok) throw new Error(String(r.status));
    return true;
  } catch {
    mark(!on);
    return false;
  }
}

/** For tests: start from an empty store. */
export function resetNetworkStore(): void {
  gen++;
  clearTimeout(pollTimer);
  pollTimer = undefined;
  info = undefined;
  summary = undefined;
  summaryAsked = false;
  people.clear();
}

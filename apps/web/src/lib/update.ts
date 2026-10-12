import type { ChangelogEntry, ReleaseChange } from "@rawjobs/core/release-notes";
import { useCallback, useEffect, useRef, useState } from "react";
import { canRunLocally } from "./data";

/** What GET /api/update says (packages/server/src/updater.ts). */
export type UpdateStatus = {
  installed: boolean;
  current: string;
  /** `telegram`: a Telegram message when an update is ready (missing on an older server: on). */
  settings: { mode: "ask" | "off"; channel: "stable" | "beta"; telegram?: boolean };
  lastCheck?: string;
  /** A newer version. `critical`: a required update; `ready`: downloaded already, installs in seconds. */
  available: { version: string; notes: string; changes?: ReleaseChange[]; critical: boolean; date: string; major: boolean; ready: boolean } | null;
  tooOld: boolean;
  state: "idle" | "checking" | "downloading" | "waiting" | "updating";
  error?: string;
  lastUpdate: { from: string; to: string; ok: boolean; at: string; error?: string; notes?: string } | null;
  /** Missing from an older server: Settings → About shows what it has. */
  about?: {
    since?: { at: string; by: "update" | "install" };
    home: string;
    node: string;
    platform: string;
    /** The RawJobs shortcuts on this computer (null: not an installed copy). */
    shortcuts: { desktop: boolean; menu: boolean; desktopFolder: boolean; desktopError: string | null; notice: boolean } | null;
  };
};

export const RELEASES_URL = "https://github.com/Tanmay-Mhatre/rawjobs/releases";
export const ISSUES_URL = "https://github.com/Tanmay-Mhatre/rawjobs/issues/new/choose";

export const INSTALL_LINE = {
  windows: "irm https://github.com/Tanmay-Mhatre/rawjobs/releases/latest/download/install.ps1 | iex",
  unix: "curl -fsSL https://github.com/Tanmay-Mhatre/rawjobs/releases/latest/download/install.sh | sh",
};
export const installLine = () => (/Windows/i.test(navigator.userAgent) ? INSTALL_LINE.windows : INSTALL_LINE.unix);

async function call(path: string, init?: RequestInit): Promise<UpdateStatus | null> {
  try {
    const res = await fetch(path, { cache: "no-store", ...init });
    return (await res.json()) as UpdateStatus;
  } catch {
    return null;
  }
}

export const updateStatus = () => call("/api/update");
export const checkForUpdate = () => call("/api/update/check", { method: "POST" });
/**
 * Install the waiting version (or, during a scan, once it's done). When it starts right away, the
 * page remembers which version it's restarting into (updatingTo), so it can say "Updating to 0.6.1"
 * while the server is away, instead of a bare "reconnecting".
 */
export async function updateNow(): Promise<UpdateStatus | null> {
  const s = await call("/api/update/apply", { method: "POST" });
  if (s?.state === "updating" && s.available) {
    try {
      sessionStorage.setItem(UPDATING_KEY, JSON.stringify({ from: s.current, to: s.available.version, at: Date.now() }));
    } catch {
      // no storage: the plain reconnecting note shows instead
    }
  }
  return s;
}

const UPDATING_KEY = "rawjobs.updatingTo";
/** The update this page started and is waiting to come back from, if any (forgotten after 5 minutes). */
export function updatingTo(): { from: string; to: string; at: number } | null {
  try {
    const u = JSON.parse(sessionStorage.getItem(UPDATING_KEY) ?? "null") as { from: string; to: string; at: number } | null;
    return u && Date.now() - u.at < 5 * 60_000 ? u : null;
  } catch {
    return null;
  }
}
export function clearUpdatingTo(): void {
  try {
    sessionStorage.removeItem(UPDATING_KEY);
  } catch {
    // nothing to clear
  }
}
export const markUpdateSeen = () => call("/api/update/seen", { method: "POST" });
/** Add the Desktop shortcut, or repair both. */
export const addDesktopShortcut = () => call("/api/update/shortcut", { method: "POST" });
/** The "RawJobs is on your Desktop" popup was seen: it doesn't show again on this computer. */
export const markShortcutNoticeSeen = () => call("/api/update/shortcut-seen", { method: "POST" });
/** You came back to the dashboard: the server looks for a new version (at most every 15 minutes). */
export const checkOnFocus = () => fetch("/api/update/focus", { method: "POST" }).catch(() => null);

/** What GET /api/update/changelog says: this version's history (newest first), and the version waiting, if any. */
export type Changelog = { current: string; entries: ChangelogEntry[]; upcoming: ChangelogEntry | null };
export async function loadChangelog(): Promise<Changelog | null> {
  try {
    const res = await fetch("/api/update/changelog", { cache: "no-store" });
    return res.ok ? ((await res.json()) as Changelog) : null;
  } catch {
    return null;
  }
}

export const saveUpdateSettings = (s: Partial<UpdateStatus["settings"]>) => call("/api/update/settings", { method: "PUT", body: JSON.stringify(s) });

/** The update status, shared by the notice and Settings, refreshed when the tab comes back. */
export function useUpdateStatus() {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const refresh = useCallback(async () => {
    if (!canRunLocally) return;
    const s = await updateStatus();
    if (s) setStatus(s);
  }, []);
  useEffect(() => {
    void refresh();
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      void refresh();
      if (canRunLocally) void checkOnFocus();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("rawjobs:update-status", refresh as () => void);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("rawjobs:update-status", refresh as () => void);
    };
  }, [refresh]);
  return { status, setStatus, refresh };
}

/** Tell every useUpdateStatus on the page to read the status again. */
export const announceUpdateStatus = () => window.dispatchEvent(new Event("rawjobs:update-status"));

const POLL_MS = 5000;

/**
 * Whether the local server answers. While it doesn't (it's restarting for an update, or stopped),
 * `down` is true; when it comes back as another version, the page reloads to match it. When the
 * server finds a new version (its `update` changes), every useUpdateStatus reads the status again,
 * so the Update pill shows within seconds.
 */
export function useServerHealth(): { down: boolean } {
  const [down, setDown] = useState(false);
  const first = useRef<string | null>(null);
  const hint = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (!canRunLocally) return;
    let live = true;
    const poll = async () => {
      try {
        const res = await fetch("/api/health", { cache: "no-store", signal: AbortSignal.timeout(3000) });
        const h = (await res.json()) as { ok?: boolean; version?: string; update?: { version: string } | null };
        if (!live) return;
        if (h.ok && h.version) {
          first.current ??= h.version;
          if (h.version !== first.current) location.reload();
        }
        const waiting = h.update?.version ?? null;
        if (hint.current !== undefined && waiting !== hint.current) announceUpdateStatus();
        hint.current = waiting;
        setDown(!h.ok);
      } catch {
        if (live) setDown(true);
      }
    };
    void poll();
    const t = setInterval(() => void poll(), POLL_MS);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, []);
  return { down };
}

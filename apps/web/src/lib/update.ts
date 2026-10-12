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
export const updateNow = () => call("/api/update/apply", { method: "POST" });
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
export function useServerHealth(): ServerHealth {
  const [down, setDown] = useState(false);
  const [since, setSince] = useState<number | null>(null);
  const [start, setStart] = useState<StartInfo>({ startLink: false, platform: null });
  const [fast, setFast] = useState(false);
  const first = useRef<string | null>(null);
  const hint = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (!canRunLocally) return;
    let live = true;
    const poll = async () => {
      try {
        const res = await fetch("/api/health", { cache: "no-store", signal: AbortSignal.timeout(3000) });
        const h = (await res.json()) as Health;
        if (!live) return;
        if (h.ok && h.version) {
          first.current ??= h.version;
          if (h.version !== first.current) location.reload();
        }
        // Kept for while it's down: how the "isn't running" window can start it again.
        if (h.ok) setStart((s) => (s.startLink === !!h.startLink && s.platform === (h.platform ?? null) ? s : { startLink: !!h.startLink, platform: h.platform ?? null }));
        const waiting = h.update?.version ?? null;
        if (hint.current !== undefined && waiting !== hint.current) announceUpdateStatus();
        hint.current = waiting;
        setDown(!h.ok);
      } catch {
        if (live) setDown(true);
      }
    };
    void poll();
    const t = setInterval(() => void poll(), fast ? FAST_POLL_MS : POLL_MS);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [fast]);
  useEffect(() => setSince(down ? Date.now() : null), [down]);
  return { down, since, ...start, setFast };
}

const FAST_POLL_MS = 1000;

/**
 * Start RawJobs from the page: rawjobs://open runs what the Desktop shortcut runs, without opening
 * another tab. The browser asks first ("Open RawJobs?"); the page stays where it is.
 */
export function openStartLink(): void {
  location.href = "rawjobs://open";
}

type Health = { ok?: boolean; version?: string; update?: { version: string } | null; startLink?: boolean; platform?: string };

/** How RawJobs can be started again on this computer, as the server said while it was up. */
type StartInfo = {
  /** rawjobs://open starts it (the installer registered the link): the window offers a Start button. */
  startLink: boolean;
  /** "win32", "darwin", "linux": for the words ("Start menu", "Applications") and the Desktop picture. */
  platform: string | null;
};

export type ServerHealth = StartInfo & {
  down: boolean;
  /** When it stopped answering (Date.now()), while it's down. */
  since: number | null;
  /** Check every second instead of every 5 (while RawJobs is starting, so the page comes back at once). */
  setFast: (fast: boolean) => void;
};

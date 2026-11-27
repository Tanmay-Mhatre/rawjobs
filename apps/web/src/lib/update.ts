import type { Changelog, UpdateStatus } from "@rawjobs/core/protocol";
import { useCallback, useEffect, useRef, useState } from "react";
import { PORTS } from "@rawjobs/server/pages";
import { getJson, isHealth } from "./api";
import { canRunLocally } from "./data";
import { healthState, refreshHealth, requestFast, subscribeHealth, useHealth } from "./health";

export type { Changelog, UpdateStatus };

export const REPO_URL = "https://github.com/Tanmay-Mhatre/rawjobs";
export const RELEASES_URL = "https://github.com/Tanmay-Mhatre/rawjobs/releases";
export const ISSUES_URL = "https://github.com/Tanmay-Mhatre/rawjobs/issues/new/choose";

export const INSTALL_LINE = {
  windows: "irm https://github.com/Tanmay-Mhatre/rawjobs/releases/latest/download/install.ps1 | iex",
  unix: "curl -fsSL https://github.com/Tanmay-Mhatre/rawjobs/releases/latest/download/install.sh | sh",
};
export const installLine = () => (/Windows/i.test(navigator.userAgent) ? INSTALL_LINE.windows : INSTALL_LINE.unix);

async function call(path: string, init?: RequestInit): Promise<UpdateStatus | null> {
  const method = init?.method ?? "GET";
  const route = method === "PUT" ? "PUT /api/update/settings" : method === "POST" ? "POST /api/update/:action" : "GET /api/update";
  const r = await getJson(route, { cache: "no-store", ...init, path });
  if (r.ok) return r.data;
  // A copy that updates with git answers its status with an error (400).
  return r.body && "current" in r.body ? r.body : null;
}

export const updateStatus = () => call("/api/update");
export const checkForUpdate = () => call("/api/update/check", { method: "POST" });
/**
 * Install the waiting version (or, during a scan, once it's done). When it starts right away, the
 * page remembers which version it's restarting into (updatingTo), so it can say "Updating to 0.6.1"
 * while the server is away, instead of a bare "reconnecting".
 */
export const updateNow = () => rememberUpdating(call("/api/update/apply", { method: "POST" }));
/** Try again a version that didn't start here before: it's offered again, and installs now (as updateNow). */
export const retryUpdate = () => rememberUpdating(call("/api/update/retry", { method: "POST" }));

async function rememberUpdating(answer: Promise<UpdateStatus | null>): Promise<UpdateStatus | null> {
  const s = await answer;
  if (s?.state === "updating" && s.available) {
    try {
      sessionStorage.setItem(UPDATING_KEY, JSON.stringify({ from: s.current, to: s.available.version, at: Date.now() }));
    } catch {
      // no storage: the plain reconnecting note shows instead
    }
    // Watch every second for it to come back.
    refreshHealth();
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

export async function loadChangelog(): Promise<Changelog | null> {
  const r = await getJson("GET /api/update/changelog", { cache: "no-store" });
  return r.ok ? r.data : null;
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

/**
 * Whether the local server answers (from the shared health poller, lib/health.ts). While it
 * doesn't (it's restarting for an update, or stopped), `down` is true; when it comes back as
 * another version, the page reloads to match it. When the server finds a new version (its `update`
 * changes), every useUpdateStatus reads the status again, so the Update pill shows within seconds.
 */
export function useServerHealth(): ServerHealth {
  const { health, down, since } = useHealth();
  const release = useRef<(() => void) | null>(null);
  const setFast = useCallback((fast: boolean) => {
    if (fast) release.current ??= requestFast();
    else {
      release.current?.();
      release.current = null;
    }
  }, []);
  useEffect(() => () => release.current?.(), []);
  useEffect(() => {
    if (!canRunLocally) return;
    let live = true;
    let first: string | null = null;
    let hint: string | null | undefined;
    let looking = false;
    const stop = subscribeHealth(() => {
      const { health: h, down } = healthState();
      if (down) {
        // Running on another of its ports (this one was taken when it started): go there.
        if (looking) return;
        looking = true;
        void findElsewhere().then((other) => {
          looking = false;
          if (live && other) location.replace(other + location.pathname + location.search + location.hash);
        });
        return;
      }
      if (!h) return;
      if (h.version) {
        first ??= h.version;
        if (h.version !== first) location.reload();
      }
      const waiting = h.update?.version ?? null;
      if (hint !== undefined && waiting !== hint) announceUpdateStatus();
      hint = waiting;
    });
    return () => {
      live = false;
      stop();
    };
  }, []);
  // Kept from while it was up: how the "isn't running" window can start it again.
  return { down, since, startLink: !!health?.startLink, platform: health?.platform ?? null, setFast };
}

/** RawJobs on another of its ports on this computer ("http://127.0.0.1:4318"), or null. As the offline page does (pages.ts). */
export async function findElsewhere(): Promise<string | null> {
  const others = PORTS.filter((p) => String(p) !== location.port).map((p) => `${location.protocol}//${location.hostname}:${p}`);
  const answers = await Promise.all(
    others.map(async (o) => {
      const r = await getJson("GET /api/health", { path: `${o}/api/health`, cache: "no-store", signal: AbortSignal.timeout(1500) });
      return r.ok && isHealth(r.data) && r.data.ok ? o : null;
    }),
  );
  return answers.find(Boolean) ?? null;
}

/**
 * Start RawJobs from the page: rawjobs://open runs what the Desktop shortcut runs, without opening
 * another tab. The browser asks first ("Open RawJobs?"); the page stays where it is.
 */
export function openStartLink(): void {
  location.href = "rawjobs://open";
}

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

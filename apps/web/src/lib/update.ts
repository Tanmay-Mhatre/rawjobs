import { useCallback, useEffect, useRef, useState } from "react";
import { canRunLocally } from "./data";

/** What GET /api/update says (packages/server/src/updater.ts). */
export type UpdateStatus = {
  installed: boolean;
  current: string;
  settings: { mode: "auto" | "ask" | "off"; channel: "stable" | "beta" };
  lastCheck?: string;
  available: { version: string; notes: string; critical: boolean; date: string; major: boolean } | null;
  tooOld: boolean;
  state: "idle" | "checking" | "updating";
  error?: string;
  lastUpdate: { from: string; to: string; ok: boolean; at: string; error?: string; notes?: string } | null;
};

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
    const onVisible = () => document.visibilityState === "visible" && void refresh();
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
 * `down` is true; when it comes back as another version, the page reloads to match it.
 */
export function useServerHealth(): { down: boolean } {
  const [down, setDown] = useState(false);
  const first = useRef<string | null>(null);
  useEffect(() => {
    if (!canRunLocally) return;
    let live = true;
    const poll = async () => {
      try {
        const res = await fetch("/api/health", { cache: "no-store", signal: AbortSignal.timeout(3000) });
        const h = (await res.json()) as { ok?: boolean; version?: string };
        if (!live) return;
        if (h.ok && h.version) {
          first.current ??= h.version;
          if (h.version !== first.current) location.reload();
        }
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

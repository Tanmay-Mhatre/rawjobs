import { useEffect, useRef, useState } from "react";
import { canRunLocally, type DataMeta } from "./data";

const POLL_MS = 5000;

type Health = { scanning?: boolean; background?: boolean; dataVersion?: string | null };

/**
 * Scans the page didn't start (scheduled ones run as their own process): while one runs, `running`
 * is true; when any scan has written newer results than the ones on screen, the data is reloaded in
 * place (filters, scroll and the open job stay) and `onFinished` hears about a background scan that
 * just ended. `loaded` is the generatedAt of the data on screen (null: no data yet, undefined: still
 * loading). `paused` while the page runs its own scan, which reloads when it ends.
 */
export function useBackgroundScan({
  loaded,
  paused,
  reload,
  onFinished,
}: {
  loaded: string | null | undefined;
  paused: boolean;
  reload: () => Promise<DataMeta | null>;
  onFinished?: (meta: DataMeta) => void;
}): { running: boolean } {
  const [running, setRunning] = useState(false);
  const latest = useRef({ loaded, paused, reload, onFinished });
  latest.current = { loaded, paused, reload, onFinished };

  useEffect(() => {
    if (!canRunLocally) return;
    let live = true;
    /** A background scan was seen running since the last reload: say so when its results arrive. */
    let sawScan = false;
    let reloading = false;
    const poll = async () => {
      let h: Health;
      try {
        h = (await (await fetch("/api/health", { cache: "no-store", signal: AbortSignal.timeout(3000) })).json()) as Health;
      } catch {
        return;
      }
      if (!live) return;
      const background = !!h.background;
      setRunning(background);
      if (background) sawScan = true;
      const { loaded, paused, reload, onFinished } = latest.current;
      // Mid-scan results are partial, and a scan or "Check now" the page runs reloads by itself.
      if (background || h.scanning || paused || reloading || loaded === undefined) return;
      if (!h.dataVersion || h.dataVersion === loaded) return;
      reloading = true;
      try {
        const meta = await reload();
        if (live && meta && sawScan) onFinished?.(meta);
        sawScan = false;
      } finally {
        reloading = false;
      }
    };
    void poll();
    const t = setInterval(() => void poll(), POLL_MS);
    // A tab in the background is asked less often: ask as soon as it's back.
    const onVisible = () => document.visibilityState === "visible" && void poll();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      live = false;
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return { running };
}

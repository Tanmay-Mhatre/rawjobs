import { useEffect, useRef, useState } from "react";
import { canRunLocally, type DataMeta } from "./data";
import { healthState, subscribeHealth } from "./health";

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
    /** After each health poll (lib/health.ts). */
    const check = async () => {
      const { health: h, down } = healthState();
      if (!live || down || !h) return;
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
    const stop = subscribeHealth(() => void check());
    return () => {
      live = false;
      stop();
    };
  }, []);

  return { running };
}

import { useEffect, useState } from "react";

/** How long a read of the local API may take before the page stops waiting and says so. */
export const READ_TIMEOUT_MS = 10_000;
/** Actions (connect Telegram, save a schedule) run the CLI and may reach the internet: more room. */
export const ACTION_TIMEOUT_MS = 30_000;

/**
 * fetch with a time limit, so a slow or stuck local server never leaves a spinner turning forever.
 * Rejects with "Timed out after N s" when it runs out; a caller's own signal still works too.
 */
export function fetchWithin(url: string, init: RequestInit = {}, ms = READ_TIMEOUT_MS): Promise<Response> {
  const timeout = AbortSignal.timeout(ms);
  const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  return fetch(url, { ...init, signal }).catch((err) => {
    throw timeout.aborted ? new Error(`Timed out after ${Math.round(ms / 1000)} s`) : err;
  });
}

/** Whether the browser thinks it's online. Scans and updates need the internet; your saved jobs don't. */
export function useOnline(): boolean {
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);
  return online;
}

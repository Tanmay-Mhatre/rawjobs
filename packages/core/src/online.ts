import { BEACON_URL } from "./update";

/**
 * Hosts a scan talks to anyway (the update beacon, GitHub, a big hiring system): any one answering,
 * with any status, means the internet is there. Nothing about the user is sent.
 */
export const PROBE_URLS = [BEACON_URL, "https://github.com/", "https://boards-api.greenhouse.io/"];

/** Whether the internet answers: true as soon as one probe gets any HTTP answer. */
export async function networkReachable(opts: { fetchImpl?: typeof fetch; timeoutMs?: number; urls?: string[] } = {}): Promise<boolean> {
  const get = opts.fetchImpl ?? fetch;
  const signal = AbortSignal.timeout(opts.timeoutMs ?? 8_000);
  try {
    await Promise.any((opts.urls ?? PROBE_URLS).map((url) => get(url, { method: "HEAD", redirect: "manual", signal })));
    return true;
  } catch {
    return false;
  }
}

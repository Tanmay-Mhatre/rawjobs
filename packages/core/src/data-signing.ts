import { envSetting } from "./env";
import { verifyRelease } from "./release";

/**
 * The public half of the data signing key (ed25519, SPKI DER, base64): the shared directory's
 * manifest.json and the job feed's manifests each come with a `.sig` made with it. The private half
 * is the RAWJOBS_DATA_SIGNING_KEY secret of the directory and job-feed workflows
 * (scripts/catalog/sign.mjs). It's a different key from the release one: those workflows run on
 * crawled data every day, and a leak there must not be able to sign an app update.
 *
 * Running your own directory or feed (RAWJOBS_DIRECTORY_URL / RAWJOBS_JOBS_URL)? Sign it with your
 * own key and set RAWJOBS_DATA_PUBLIC_KEY to its public half.
 */
export const DATA_PUBLIC_KEY = "MCowBQYDK2VwAyEAKxV+DJuMoOIVywf5oOXgJrO8zCsaR8XfDbpUPxb/iEM=";
export const dataPublicKey = () => envSetting("DATA_PUBLIC_KEY") ?? DATA_PUBLIC_KEY;

/** A manifest that arrived with a valid signature, or why not (`status` null: a bad signature). */
export type SignedJson<T> = { ok: true; value: T } | { ok: false; status: number | null };

/** Download a JSON manifest and its `.sig`; accept it only when the data key signed its exact bytes. */
export async function fetchSignedJson<T>(get: typeof fetch, url: string): Promise<SignedJson<T>> {
  const [res, sig] = await Promise.all([get(url, { headers: { accept: "application/json" }, redirect: "follow" }), get(`${url}.sig`, { redirect: "follow" })]);
  if (!res.ok) return { ok: false, status: res.status };
  const body = await res.text();
  if (!sig.ok || !verifyRelease(body, await sig.text(), dataPublicKey())) return { ok: false, status: null };
  return { ok: true, value: JSON.parse(body) as T };
}

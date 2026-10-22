/**
 * "See people at {Company}" (docs/plans/archive/referral-finder.md, sections 6.G and 12.6): a small RawJobs
 * card to keep beside LinkedIn while you look for people. It opens in Document Picture-in-Picture
 * where the browser has it, else in a small popup routed as "#card/<jobId>?t=…&c=…". LinkedIn opens
 * only from the card's own button, on the left half of the screen.
 */
import { safeUrl } from "@rawjobs/core/text";
import { nameFromProfile, profileLink } from "./referralLinks";
import { addContactPatch, CAPS, type Entry, type EntryPatch, newId, toContact } from "./userState";

declare global {
  /** Document Picture-in-Picture (Chrome and Edge 116+), not yet in TypeScript's DOM types. */
  interface DocumentPictureInPicture extends EventTarget {
    requestWindow(options?: { width?: number; height?: number }): Promise<Window>;
    readonly window: Window | null;
  }
  interface Window {
    documentPictureInPicture?: DocumentPictureInPicture;
  }
}

/** What the card shows and needs: no job list is loaded for it. */
export type CardJob = { id: string; title: string; company: string; place?: string; url?: string };
export type LogInput = { profile: string; first?: string };
export type LogResult = { ok: boolean; message: string };

export const CARD_SIZE = { width: 380, height: 560 } as const;
export const CARD_WINDOW = "rawjobs-card";
export const LINKEDIN_WINDOW = "rawjobs-linkedin";
/** The popup card asks the RawJobs tab that opened it to log a person; it never writes tracking itself. */
export const CARD_CHANNEL = "rawjobs-card";
export type CardMessage = ({ type: "log"; jobId: string } & LogInput & { ref: string }) | ({ type: "logged"; ref: string } & LogResult);

const clip = (s: string | null) => (s ?? "").trim().slice(0, 200);

/** "#card/<jobId>?t=<title>&c=<company>&p=<place>&u=<link>": everything the popup card shows. */
export function cardHash(job: CardJob): string {
  const q = new URLSearchParams({ t: job.title, c: job.company });
  if (job.place) q.set("p", job.place);
  const url = safeUrl(job.url);
  if (url) q.set("u", url);
  return `#card/${encodeURIComponent(job.id)}?${q}`;
}

/** The card from a hash's path ("card/<jobId>") and query, or null. */
export function parseCard(path: string, query: string): CardJob | null {
  const m = path.match(/^card\/(.+)$/);
  if (!m) return null;
  let id: string;
  try {
    id = decodeURIComponent(m[1]!);
  } catch {
    return null;
  }
  const q = new URLSearchParams(query);
  return { id, title: clip(q.get("t")), company: clip(q.get("c")), place: clip(q.get("p")) || undefined, url: safeUrl(q.get("u")) };
}

type ScreenLike = Pick<Screen, "availWidth" | "availHeight"> & { availLeft?: number; availTop?: number };

/** LinkedIn's window: the left half of the screen. */
export function besideFeatures(s: ScreenLike): string {
  return `popup,left=${s.availLeft ?? 0},top=${s.availTop ?? 0},width=${Math.floor(s.availWidth / 2)},height=${s.availHeight}`;
}

/** The popup card (no Picture-in-Picture): card-sized, at the right edge of the screen. */
export function cardFeatures(s: ScreenLike): string {
  const left = (s.availLeft ?? 0) + Math.max(0, s.availWidth - CARD_SIZE.width);
  return `popup,left=${left},top=${s.availTop ?? 0},width=${CARD_SIZE.width},height=${CARD_SIZE.height}`;
}

/**
 * Opens LinkedIn on the left half of the screen; false when the browser blocked it. A "noopener"
 * feature makes window.open return null even when the window opens, so a blocked pop-up couldn't be
 * told apart. Open it plainly, then cut the link back to RawJobs at once (the page sends no referrer:
 * index.html has referrer no-referrer).
 */
export function openBeside(url: string, from: Window = window): boolean {
  const w = from.open(url, LINKEDIN_WINDOW, besideFeatures(from.screen));
  if (!w) return false;
  try {
    w.opener = null;
  } catch {
    // the window was already on LinkedIn from an earlier click; its link was cut then
  }
  return true;
}

/** Copies the page's stylesheets into the card's window and waits (up to `ms`) for linked ones to load. */
export function copyStyles(from: Document, to: Document, ms = 3000): Promise<void> {
  const loads: Promise<void>[] = [];
  for (const sheet of Array.from(from.styleSheets)) {
    if (sheet.href) {
      const link = to.createElement("link");
      link.rel = "stylesheet";
      link.href = new URL(sheet.href, from.baseURI).href;
      loads.push(
        new Promise((done) => {
          link.addEventListener("load", () => done(), { once: true });
          link.addEventListener("error", () => done(), { once: true });
        }),
      );
      to.head.append(link);
      continue;
    }
    try {
      const style = to.createElement("style");
      style.textContent = Array.from(sheet.cssRules, (r) => r.cssText).join("\n");
      to.head.append(style);
    } catch {
      // a sheet whose rules can't be read: skip it
    }
  }
  if (!loads.length) return Promise.resolve();
  return Promise.race([Promise.all(loads).then(() => undefined), new Promise<void>((done) => setTimeout(done, ms))]);
}

/** The patch that logs a person from the card on a job: To contact on LinkedIn, saving an unsaved job. */
export function logPersonPatch(entry: Entry | undefined, job: Pick<CardJob, "company">, input: LogInput): { patch?: EntryPatch; result: LogResult } {
  const profile = profileLink(input.profile);
  if (!profile) return { result: { ok: false, message: "That isn't a LinkedIn profile link. Copy it from their profile page, like linkedin.com/in/their-name." } };
  const contacts = entry?.contacts ?? [];
  const name = input.first?.trim() || nameFromProfile(profile) || "LinkedIn contact";
  const already = contacts.find((c) => c.linkedin === profile);
  if (already) return { result: { ok: true, message: `${already.name} is already on this job.` } };
  if (contacts.length >= CAPS.contacts) return { result: { ok: false, message: `This job has ${CAPS.contacts} contacts, the most it can hold. Remove one in Pipeline, then log this person.` } };
  const contact = toContact({ name, role: "referrer", company: job.company, linkedin: profile }, newId());
  if (!contact) return { result: { ok: false, message: "Couldn't log this person. Try again." } };
  const saving = !entry?.status;
  return {
    patch: addContactPatch(entry, contact),
    result: { ok: true, message: `${saving ? `Saved this job and added ${contact.name}` : `Added ${contact.name} to this job`}, in To contact.` },
  };
}

/** From the popup card: asks the RawJobs tab to log the person, and waits for its answer. */
export function sendLog(jobId: string, input: LogInput, ms = 3000): Promise<LogResult> {
  const lost: LogResult = { ok: false, message: "Couldn't reach RawJobs. Keep its tab open, then try again." };
  if (typeof BroadcastChannel === "undefined") return Promise.resolve(lost);
  const ch = new BroadcastChannel(CARD_CHANNEL);
  const ref = newId();
  return new Promise<LogResult>((done) => {
    const timer = setTimeout(() => done(lost), ms);
    ch.onmessage = (e: MessageEvent<CardMessage>) => {
      const m = e.data;
      if (m?.type !== "logged" || m.ref !== ref) return;
      clearTimeout(timer);
      done({ ok: m.ok, message: m.message });
    };
    ch.postMessage({ type: "log", jobId, ref, profile: input.profile, ...(input.first ? { first: input.first } : {}) } satisfies CardMessage);
  }).finally(() => ch.close());
}

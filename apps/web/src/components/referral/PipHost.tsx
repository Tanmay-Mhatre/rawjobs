import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CARD_CHANNEL, CARD_SIZE, CARD_WINDOW, type CardJob, type CardMessage, cardFeatures, cardHash, copyStyles, type LogInput, type LogResult } from "../../lib/seePeople";
import { OutreachCard } from "./OutreachCard";

type OpenCard = { kind: "pip" | "popup"; win: Window; job: CardJob };
export type PipApi = {
  /** Opens the card for a job (or moves the open one to it). "failed": no window could open. */
  open: (job: CardJob, from: HTMLElement | null) => Promise<"open" | "failed">;
  /** The job the card shows, while it's open. */
  jobId: string | null;
};

const PipContext = createContext<PipApi | null>(null);
/** The See people card's host, or null outside the app (the button then hides). */
export const usePip = () => useContext(PipContext);

const syncTheme = (to: Document) => {
  const theme = document.documentElement.dataset.theme;
  if (theme) to.documentElement.dataset.theme = theme;
};

/**
 * Holds the one See people card for the whole app, so moving between jobs doesn't empty it. In
 * Picture-in-Picture the card is a portal into that window; in the popup fallback the card is its own
 * page, and this logs the people it sends over BroadcastChannel("rawjobs-card"). Closing the card
 * puts focus back on the button that opened it.
 */
export function PipHost({ onLog, children }: { onLog: (job: CardJob, p: LogInput) => LogResult; children: ReactNode }) {
  const [card, setCard] = useState<OpenCard | null>(null);
  const cardRef = useRef(card);
  const logRef = useRef(onLog);
  const back = useRef<HTMLElement | null>(null);
  useEffect(() => {
    cardRef.current = card;
    logRef.current = onLog;
  });

  const closed = useCallback((win: Window) => {
    if (cardRef.current?.win !== win) return;
    cardRef.current = null;
    setCard(null);
    const el = back.current;
    back.current = null;
    if (el?.isConnected) el.focus();
  }, []);

  const open = useCallback(async (job: CardJob, from: HTMLElement | null): Promise<"open" | "failed"> => {
    back.current = from;
    const now = cardRef.current;
    if (now?.kind === "pip" && !now.win.closed) {
      setCard({ ...now, job });
      now.win.focus();
      return "open";
    }
    const pip = window.documentPictureInPicture;
    if (pip) {
      try {
        const win = await pip.requestWindow(CARD_SIZE);
        const doc = win.document;
        doc.title = `People at ${job.company} · RawJobs`;
        doc.documentElement.lang = document.documentElement.lang || "en";
        syncTheme(doc);
        await copyStyles(document, doc);
        const next = { kind: "pip" as const, win, job };
        cardRef.current = next;
        setCard(next);
        return "open";
      } catch {
        return "failed";
      }
    }
    // Same name: a second click reuses the popup and only changes its hash.
    const win = window.open(`${location.pathname}${location.search}${cardHash(job)}`, CARD_WINDOW, cardFeatures(screen));
    if (!win) return "failed";
    const next = { kind: "popup" as const, win, job };
    cardRef.current = next;
    setCard(next);
    return "open";
  }, []);

  const win = card?.win;
  const kind = card?.kind;
  useEffect(() => {
    if (!win) return;
    const onHide = () => closed(win);
    // The card goes with the page: a popup would otherwise outlive the tab it reports to.
    const onPageHide = () => win.close();
    window.addEventListener("pagehide", onPageHide);
    if (kind === "popup") {
      // A popup's close can't be listened for from here, and its own pagehide also fires on load.
      const poll = setInterval(() => win.closed && closed(win), 500);
      return () => {
        clearInterval(poll);
        window.removeEventListener("pagehide", onPageHide);
      };
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      win.close();
    };
    const onTheme = () => syncTheme(win.document);
    win.addEventListener("pagehide", onHide);
    win.document.addEventListener("keydown", onKey);
    window.addEventListener("rawjobs:theme", onTheme);
    return () => {
      win.removeEventListener("pagehide", onHide);
      win.document.removeEventListener("keydown", onKey);
      window.removeEventListener("rawjobs:theme", onTheme);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [win, kind, closed]);

  // The popup card asks this tab to log people, only for the job it was opened for.
  useEffect(() => {
    if (kind !== "popup" || typeof BroadcastChannel === "undefined") return;
    const ch = new BroadcastChannel(CARD_CHANNEL);
    ch.onmessage = (e: MessageEvent<CardMessage>) => {
      const m = e.data;
      if (m?.type !== "log" || typeof m.ref !== "string" || typeof m.profile !== "string") return;
      const c = cardRef.current;
      const result: LogResult =
        c && m.jobId === c.job.id
          ? logRef.current(c.job, { profile: m.profile, ...(typeof m.first === "string" ? { first: m.first } : {}) })
          : { ok: false, message: "This card is for another job now. Open it again from the job." };
      ch.postMessage({ type: "logged", ref: m.ref, ...result } satisfies CardMessage);
    };
    return () => ch.close();
  }, [kind]);

  const jobId = card?.job.id ?? null;
  const api = useMemo(() => ({ open, jobId }), [open, jobId]);
  const pipCard = card?.kind === "pip" ? card : null;
  return (
    <PipContext.Provider value={api}>
      {children}
      {pipCard && createPortal(<OutreachCard key={pipCard.job.id} job={pipCard.job} win={pipCard.win} onLog={(p) => logRef.current(pipCard.job, p)} />, pipCard.win.document.body)}
    </PipContext.Provider>
  );
}

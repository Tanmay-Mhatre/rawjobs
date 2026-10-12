import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Job } from "../lib/data";
import { hiddenByRules, offerCopy, offerFor, offerWhat, REASONS, ruleHides, ruleKey, type HideRule, type Offer, type Reason } from "../lib/notForMe";
import type { Prefs } from "../lib/prefs";
import type { Entry, JobLike, Status, UserState } from "../lib/userState";
import { Button, Chip, ChipGroup } from "./primitives";
import { dismissToast, toast } from "./Toast";

/**
 * "Not interested", with a reason (optional, one tap). A reason that maps to a clear rule offers it
 * ("Hide all senior roles?"), you confirm with one tap, and the line says what changed, with Undo.
 * Field, skills and other are only recorded. Nothing is hidden without your tap.
 */
export type NotForMeApi = {
  entryOf: (id: string) => Entry | undefined;
  setReason: (job: Job, reason: Reason | undefined) => void;
  /** Undo Not interested: put the job back the way it was. */
  restore: (job: Job, prev: Status | undefined) => void;
  /** Is this offer already in effect (the rule exists, the company is hidden)? */
  isOn: (o: Offer) => boolean;
  /** Turn the offer on; returns how many more jobs it hides from the Radar. */
  apply: (o: Offer) => number;
  undo: (o: Offer) => void;
  /** After X in the list: ask why in a popover toast. */
  askWhy: (job: Job, prev?: Status) => void;
};

const NotForMeContext = createContext<NotForMeApi | null>(null);
export const NotForMeProvider = NotForMeContext.Provider;
export const useNotForMe = () => useContext(NotForMeContext);

/** How long the "Why?" toast stays, when you don't touch it (it waits while hovered or focused). */
export const ASK_MS = 8000;

/** Builds the API from the app's tracking and prefs. `hideCompany` is the app's (it also mutes the company in your config). */
export function useNotForMeApi(o: {
  user: UserState;
  update: (job: JobLike, patch: Partial<Pick<Entry, "status" | "note" | "reason">>) => void;
  prefs: Prefs;
  setRule: (rule: HideRule, on: boolean) => void;
  hideCompany: (company: string, hidden: boolean) => void;
  jobs: Job[];
}): NotForMeApi {
  const { user, update, prefs, setRule, hideCompany, jobs } = o;
  // The latest state, for apply's count (it runs from a click, after renders have moved on).
  const live = useRef({ user, prefs, jobs });
  live.current = { user, prefs, jobs };

  const entryOf = useCallback((id: string) => user[id], [user]);
  const setReason = useCallback((job: Job, reason: Reason | undefined) => update(job, { reason }), [update]);
  const restore = useCallback((job: Job, prev: Status | undefined) => update(job, { status: prev, reason: undefined }), [update]);
  const isOn = useCallback((offer: Offer) => (offer.kind === "company" ? prefs.hiddenCompanies.includes(offer.company) : prefs.hideRules.some((r) => ruleKey(r) === ruleKey(offer.rule))), [prefs]);
  const apply = useCallback(
    (offer: Offer) => {
      const { user: u, prefs: p, jobs: all } = live.current;
      // Jobs the Radar shows now (as far as hiding goes) that this would take away.
      const hides = (j: Job) => (offer.kind === "company" ? j.company === offer.company : !u[j.id]?.status && ruleHides(offer.rule, j));
      const count = all.filter(
        (j) => j.status === "open" && !j.why.gate && u[j.id]?.status !== "dismissed" && !p.hiddenCompanies.includes(j.company) && !(!u[j.id]?.status && hiddenByRules(j, p.hideRules)) && hides(j),
      ).length;
      if (offer.kind === "company") hideCompany(offer.company, true);
      else setRule(offer.rule, true);
      return count;
    },
    [hideCompany, setRule],
  );
  const undo = useCallback((offer: Offer) => (offer.kind === "company" ? hideCompany(offer.company, false) : setRule(offer.rule, false)), [hideCompany, setRule]);
  const askWhy = useCallback((job: Job, prev?: Status) => {
    let id = 0;
    id = toast({ surface: "popover", duration: ASK_MS, message: <WhyToast job={job} prev={prev} onDone={() => dismissToast(id)} /> });
  }, []);

  return useMemo(() => ({ entryOf, setReason, restore, isOn, apply, undo, askWhy }), [entryOf, setReason, restore, isOn, apply, undo, askWhy]);
}

/** The toast after X: what happened, Undo, and a one-line "Why?" that opens the reasons (so it stays short on phones). */
function WhyToast({ job, prev, onDone }: { job: Job; prev?: Status; onDone: () => void }) {
  const api = useNotForMe();
  const [open, setOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Opening moves focus to the first reason, so keyboard and screen reader users land in the list.
    if (open) pickerRef.current?.querySelector<HTMLElement>("button")?.focus();
  }, [open]);
  if (!api) return null;
  return (
    <div className="grid gap-2">
      <p className="flex items-start gap-2">
        {/* Two lines at most, so a long title never makes the toast tall; the full title is in the label. */}
        <span className="line-clamp-2 min-w-0 flex-1 pt-1" title={`${job.title}, ${job.company}`}>
          Not interested: <b className="font-medium">{job.title}</b>, {job.company}.
        </span>
        {!open && (
          <Button size="sm" variant="quiet" className="shrink-0" aria-expanded={false} onClick={() => setOpen(true)}>
            Why?
          </Button>
        )}
        <Button
          size="sm"
          variant="quiet"
          className="shrink-0"
          onClick={() => {
            api.restore(job, prev);
            onDone();
          }}
        >
          Undo
        </Button>
      </p>
      {open && (
        <div ref={pickerRef}>
          <ReasonPicker job={job} label="Why? Optional." />
        </div>
      )}
    </div>
  );
}

/**
 * The reason chips, then the offer, the note, or what changed. In the drawer it carries its own live
 * region (`live`); in the toast, the toast's region announces it.
 */
export function ReasonPicker({ job, label, live }: { job: Job; label: string; live?: boolean }) {
  const api = useNotForMe();
  const [step, setStep] = useState<{ done: number } | "undone" | null>(null);
  const lineRef = useRef<HTMLDivElement>(null);
  const chipsRef = useRef<HTMLDivElement>(null);
  const focusNext = useRef<"undo" | "chip" | null>(null);
  useEffect(() => {
    // The button you pressed is replaced: focus moves to the one that takes its place, never to the page.
    if (focusNext.current === "undo") lineRef.current?.querySelector("button")?.focus();
    if (focusNext.current === "chip") chipsRef.current?.querySelector<HTMLElement>('[aria-pressed="true"]')?.focus();
    focusNext.current = null;
  }, [step]);
  if (!api) return null;
  const reason = api.entryOf(job.id)?.reason;
  const result = reason ? offerFor(reason, job) : undefined;

  let line: ReactNode = null;
  if (result && "note" in result) line = result.note;
  else if (result) {
    const offer = result.offer;
    const what = offerWhat(offer);
    if (typeof step === "object" && step) {
      const n = step.done;
      line = (
        <>
          {n ? `Hiding ${what}: ${n} fewer ${n === 1 ? "job" : "jobs"} on your Radar.` : `Hiding ${what}. Nothing else on your Radar matches it now.`}{" "}
          <Button
            size="sm"
            variant="quiet"
            onClick={() => {
              api.undo(offer);
              focusNext.current = "chip";
              setStep("undone");
            }}
          >
            Undo
          </Button>
        </>
      );
    } else if (step === "undone") line = `Showing ${what} again.`;
    else if (api.isOn(offer)) line = `Already hiding ${what}. Change it under More.`;
    else {
      const copy = offerCopy(offer);
      line = (
        <>
          {copy.question}{" "}
          <Button
            size="sm"
            onClick={() => {
              const done = api.apply(offer);
              focusNext.current = "undo";
              setStep({ done });
            }}
          >
            {copy.button}
          </Button>
        </>
      );
    }
  }

  return (
    <div className="grid gap-2">
      <p className="type-small text-muted">{label}</p>
      <div ref={chipsRef}>
        <ChipGroup label="Why not interested">
          {REASONS.map((r) => (
            <Chip
              key={r.id}
              pressed={reason === r.id}
              onClick={() => {
                api.setReason(job, reason === r.id ? undefined : r.id);
                setStep(null);
              }}
            >
              {r.label}
            </Chip>
          ))}
        </ChipGroup>
      </div>
      <div ref={lineRef} className="type-small" {...(live ? { role: "status", "aria-live": "polite" as const } : {})}>
        {line}
      </div>
    </div>
  );
}

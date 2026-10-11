import { useCallback, useEffect, useState } from "react";
import type { Job } from "./data";
import type { Reason } from "./notForMe";
import type { Prefs } from "./prefs";
import { load, save } from "./storage";
import { useSavedOnDisk } from "./tracking";

export const PIPELINE = ["saved", "applied", "interviewing", "offer", "rejected"] as const;
export type PipelineStatus = (typeof PIPELINE)[number];
export type Status = PipelineStatus | "dismissed";

export const STATUS_LABEL: Record<Status, string> = {
  saved: "Saved",
  applied: "Applied",
  interviewing: "Interviewing",
  offer: "Offer",
  rejected: "Rejected",
  dismissed: "Not interested",
};

/** Your own tracking for one job. Saved on this computer (profile/tracking.json) and in this browser; export/import to move it. */
export type Entry = {
  status?: Status;
  note?: string;
  /** Why it's Not interested, when you said (one tap, optional). Only kept while the status is "dismissed". */
  reason?: Reason;
  updatedAt: string;
  /** Copy of the job's basics, so the pipeline survives the job leaving jobs.json. */
  snapshot: { title: string; company: string; url: string; location: string; score: number };
};

export type UserState = Record<string, Entry>;

/** The job fields tracking needs; a full Job or a stored snapshot both fit. */
export type JobLike = Pick<Job, "id" | "title" | "company" | "url" | "location" | "score">;

const KEY = "rawjobs.state.v1";

export function useUserState() {
  const [state, setState] = useState<UserState>(() => load<UserState>(KEY, {}));

  useEffect(() => save(KEY, state), [state]);
  useSavedOnDisk("state", state, setState);

  // Keep tabs in sync.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY) setState(load<UserState>(KEY, {}));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const update = useCallback((job: JobLike, patch: Partial<Pick<Entry, "status" | "note" | "reason">>) => {
    setState((s) => {
      const prev = s[job.id];
      const next: Entry = {
        ...prev,
        ...patch,
        updatedAt: new Date().toISOString(),
        snapshot: { title: job.title, company: job.company, url: job.url, location: job.location, score: job.score },
      };
      // A reason belongs to Not interested: moving the job anywhere else drops it.
      if (next.status !== "dismissed") delete next.reason;
      if (!next.status && !next.note) {
        const { [job.id]: _, ...rest } = s;
        return rest;
      }
      return { ...s, [job.id]: next };
    });
  }, []);

  /** Set a status, or clear it if it's already set (toggle). */
  const toggleStatus = useCallback(
    (job: JobLike, status: Status) => update(job, { status: state[job.id]?.status === status ? undefined : status }),
    [state, update],
  );

  const replaceAll = useCallback((next: UserState) => setState(next), []);

  return { state, update, toggleStatus, replaceAll };
}

export function exportState(state: UserState, prefs?: Prefs): void {
  const blob = new Blob([JSON.stringify({ app: "rawjobs", version: 1, exportedAt: new Date().toISOString(), state, prefs }, null, 2)], {
    type: "application/json",
  });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `rawjobs-tracking-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

export async function readStateFile(file: File): Promise<{ state: UserState; prefs?: Partial<Prefs> }> {
  const parsed = JSON.parse(await file.text()) as { app?: string; state?: UserState; prefs?: Partial<Prefs> };
  // Exports made before the rename to RawJobs say "job-hunter".
  if ((parsed.app !== "rawjobs" && parsed.app !== "job-hunter") || !parsed.state || typeof parsed.state !== "object") {
    throw new Error("That file isn't a RawJobs export.");
  }
  return { state: parsed.state, prefs: parsed.prefs };
}

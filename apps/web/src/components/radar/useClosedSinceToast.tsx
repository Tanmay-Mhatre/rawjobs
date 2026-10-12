import { useEffect } from "react";
import type { Job } from "../../lib/data";
import type { UserState } from "../../lib/userState";
import { toast } from "../Toast";

/** Visits (by their "new since" line) whose closed jobs were already announced, so switching tabs doesn't repeat it. */
const closedToldFor = new Set<number>();

/** Jobs you saved or applied to that closed since your last visit: said once per visit, with "See" to show them. */
export function useClosedSinceToast(newSince: number | undefined, jobs: readonly Job[], user: UserState, show: (view: "saved" | "applied") => void) {
  // biome-ignore lint/correctness/useExhaustiveDependencies: said once per visit, keyed by `newSince`
  useEffect(() => {
    if (newSince === undefined || closedToldFor.has(newSince)) return;
    closedToldFor.add(newSince);
    const closed = jobs.filter((j) => j.status === "closed" && j.closedAt && Date.parse(j.closedAt) > newSince && ["saved", "applied", "interviewing", "offer"].includes(user[j.id]?.status ?? ""));
    if (!closed.length) return;
    const view = closed.some((j) => user[j.id]?.status === "saved") ? "saved" : "applied";
    toast({
      message:
        closed.length === 1 ? (
          <>
            <b>{closed[0]!.title}</b> at {closed[0]!.company} closed since your last visit.
          </>
        ) : (
          <>{closed.length} jobs you saved or applied to closed since your last visit.</>
        ),
      actionLabel: "See",
      onAction: () => show(view),
    });
  }, [newSince]);
}

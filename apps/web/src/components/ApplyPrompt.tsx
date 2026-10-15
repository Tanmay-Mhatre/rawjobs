import { CircleCheck } from "lucide-react";
import { useEffect, useState } from "react";
import type { Job } from "../lib/data";
import { companyName } from "../lib/format";
import { Button } from "./ui";

/**
 * After you open a job's apply page, ask on your return whether you applied, so the Pipeline
 * stays true without typing anything.
 */
export function ApplyPrompt({ job, onAnswer }: { job: Job | null; onAnswer: (applied: boolean) => void }) {
  const [back, setBack] = useState(false);

  useEffect(() => {
    setBack(false);
    if (!job) return;
    const opened = Date.now();
    // Coming back to this tab (not the click itself) is the moment to ask.
    const onReturn = () => document.visibilityState === "visible" && Date.now() - opened > 1500 && setBack(true);
    document.addEventListener("visibilitychange", onReturn);
    window.addEventListener("focus", onReturn);
    return () => {
      document.removeEventListener("visibilitychange", onReturn);
      window.removeEventListener("focus", onReturn);
    };
  }, [job]);

  if (!job || !back) return null;
  return (
    // A non-modal prompt: announced politely, never steals focus; its buttons are reachable with Tab.
    <div className="pointer-events-none fixed inset-x-0 bottom-20 z-50 flex justify-center px-4 md:bottom-6" role="status" aria-label="Did you apply?">
      <div className="pointer-events-auto flex max-w-xl flex-wrap items-center gap-3 rounded-md border border-line bg-raised p-3 pl-4 shadow-l3">
        <CircleCheck className="size-5 shrink-0 text-muted" aria-hidden="true" />
        <p className="min-w-0 flex-1 type-small">
          Did you apply to <b>{job.title}</b> at <b>{companyName(job.company)}</b>?
        </p>
        <div className="flex gap-2">
          <Button size="sm" variant="primary" onClick={() => onAnswer(true)}>
            Yes, mark applied
          </Button>
          <Button size="sm" variant="ghost" onClick={() => onAnswer(false)}>
            Not yet
          </Button>
        </div>
      </div>
    </div>
  );
}

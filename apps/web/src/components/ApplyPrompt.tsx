import { CircleCheck } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Job } from "../lib/data";
import { companyName } from "../lib/format";
import { pin } from "./Toast";

/**
 * After you open a job's apply page, ask on your return whether you applied, so the Pipeline
 * stays true without typing anything. A pinned item in the toast column (above any toast, in the open
 * dialog when there is one): announced politely, never steals focus, its buttons reachable with Tab.
 */
export function ApplyPrompt({ job, onAnswer }: { job: Job | null; onAnswer: (applied: boolean) => void }) {
  const [back, setBack] = useState(false);
  const answer = useRef(onAnswer);
  // Kept after each render (not during it), for the buttons in the pinned item.
  useLayoutEffect(() => {
    answer.current = onAnswer;
  });

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

  useEffect(() => {
    if (!job || !back) return;
    pin("apply", {
      icon: <CircleCheck className="size-5 shrink-0 text-muted" aria-hidden="true" />,
      message: (
        <>
          Did you apply to <b>{job.title}</b> at <b>{companyName(job.company)}</b>?
        </>
      ),
      actions: [
        { label: "Yes, mark applied", primary: true, onClick: () => answer.current(true) },
        { label: "Not yet", onClick: () => answer.current(false) },
      ],
    });
    return () => pin("apply", null);
  }, [job, back]);

  return null;
}

import { type ReactNode, useEffect, useId, useState } from "react";
import type { Entry, EntryPatch } from "../../lib/userState";
import { Tabs, type TabItem } from "../primitives";
import { ActivityTab } from "./ActivityTab";
import { InterviewsTab } from "./InterviewsTab";
import { PeopleTab } from "./PeopleTab";

type Tab = "activity" | "people" | "interviews" | "job";

/**
 * A tracked job's progress (docs/plans/pipeline-v2.md, section 6.2), in the job detail and in the
 * dialog for jobs not on the Radar: Activity, People, Interviews and, for a job you added by hand,
 * Job (`jobTab`). Saying what was logged goes through one polite live region.
 */
export function JobTracking({
  jobId,
  entry,
  title,
  foundAt,
  onUpdate,
  jobTab,
  now,
}: {
  jobId: string;
  entry: Entry;
  title: string;
  foundAt?: string;
  onUpdate: (patch: EntryPatch) => void;
  /** The Job tab's content (title, company, link, CV used, offer): only for jobs tracked by hand. */
  jobTab?: ReactNode;
  now?: Date;
}) {
  const id = useId();
  const [tab, setTab] = useState<Tab>("activity");
  const [adding, setAdding] = useState(false);
  const [announce, setAnnounce] = useState("");
  // biome-ignore lint/correctness/useExhaustiveDependencies: another job opened: back to its activity
  useEffect(() => {
    setTab("activity");
    setAdding(false);
  }, [jobId]);

  const people = entry.contacts?.length ?? 0;
  const items: TabItem<Tab>[] = [
    { id: "activity", label: "Activity" },
    { id: "people", label: "People", count: people },
    { id: "interviews", label: "Interviews", ...(entry.interviews?.length ? { count: entry.interviews.length } : {}) },
    ...(jobTab ? [{ id: "job" as const, label: "Job" }] : []),
  ];
  const current = items.some((t) => t.id === tab) ? tab : "activity";

  return (
    <div className="grid gap-3">
      <Tabs label="Job progress" items={items} value={current} onChange={setTab} idPrefix={`${id}-tab`} panelId={`${id}-panel`} />
      <div id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-tab-${current}`}>
        {current === "activity" && (
          <ActivityTab
            jobId={jobId}
            entry={entry}
            title={title}
            foundAt={foundAt}
            onUpdate={onUpdate}
            onAnnounce={setAnnounce}
            onAddPerson={() => {
              setTab("people");
              setAdding(true);
            }}
            now={now}
          />
        )}
        {current === "people" && <PeopleTab jobId={jobId} entry={entry} onUpdate={onUpdate} adding={adding} onAdding={setAdding} />}
        {current === "interviews" && <InterviewsTab entry={entry} onUpdate={onUpdate} />}
        {current === "job" && jobTab}
      </div>
      <p className="sr-only" role="status" aria-live="polite">
        {announce}
      </p>
    </div>
  );
}

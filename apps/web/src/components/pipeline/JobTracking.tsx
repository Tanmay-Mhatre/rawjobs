import { type ReactNode, useEffect, useId, useState } from "react";
import { type Task, tasksFor } from "../../lib/nextSteps";
import { useMedia } from "../../lib/useMedia";
import { dayAfter, type Entry, type EntryPatch, isActive, stageSince, STATUS_LABEL, today } from "../../lib/userState";
import { DateField } from "../DateField";
import { Tabs, type TabItem } from "../primitives";
import { ActivityTab, NextStep } from "./ActivityTab";
import { InterviewsTab } from "./InterviewsTab";
import { PeopleTab } from "./PeopleTab";

type Tab = "activity" | "people" | "interviews" | "job";

/**
 * A tracked job's progress (docs/plans/pipeline-v2.md, section 6.2), in the job detail and in the
 * dialog for jobs not on the Radar: Activity, People, Interviews and, for a job you added by hand,
 * Job (`jobTab`). Saying what was logged goes through one polite live region.
 *
 * `wide` (the Pipeline's job dialog, laptops and up): Activity on the left and a side panel with
 * the next step, interviews, people and details on the right, each scrolling on its own.
 */
export function JobTracking({
  jobId,
  entry,
  title,
  foundAt,
  onUpdate,
  jobTab,
  initialTab,
  wide: wideAsked,
  now,
}: {
  jobId: string;
  entry: Entry;
  title: string;
  foundAt?: string;
  onUpdate: (patch: EntryPatch) => void;
  /** The Job tab's content (title, company, link, CV used, offer): only for jobs tracked by hand. */
  jobTab?: ReactNode;
  /** The tab to open on, focused ("On this job: Messaged" in the referral section opens People). */
  initialTab?: Tab;
  wide?: boolean;
  now?: Date;
}) {
  const id = useId();
  const [tab, setTab] = useState<Tab>(initialTab ?? "activity");
  const [adding, setAdding] = useState(false);
  const [announce, setAnnounce] = useState("");
  const [logRequest, setLogRequest] = useState<{ n: number; task: Task }>();
  const roomy = useMedia("(min-width: 1024px)");
  const wide = !!wideAsked && roomy;
  // biome-ignore lint/correctness/useExhaustiveDependencies: another job opened: back to its activity
  useEffect(() => {
    setTab(initialTab ?? "activity");
    setAdding(false);
  }, [jobId]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: only when opened on a tab
  useEffect(() => {
    if (initialTab) document.getElementById(`${id}-tab-${initialTab}`)?.focus();
  }, []);

  // Cleared first, so the same words twice in a row are still read out.
  const say = (message: string) => {
    setAnnounce("");
    setTimeout(() => setAnnounce(message), 50);
  };
  const people = entry.contacts?.length ?? 0;
  const interviews = entry.interviews?.length ?? 0;
  const status = (
    <p className="sr-only" role="status" aria-live="polite">
      {announce}
    </p>
  );
  const activity = (
    <ActivityTab
      jobId={jobId}
      entry={entry}
      title={title}
      foundAt={foundAt}
      onUpdate={onUpdate}
      onAnnounce={say}
      onAddPerson={() => {
        if (!wide) setTab("people");
        setAdding(true);
        if (wide) requestAnimationFrame(() => document.getElementById(`${id}-people`)?.scrollIntoView({ block: "nearest" }));
      }}
      wide={wide}
      logRequest={logRequest}
      now={now}
    />
  );

  if (wide) {
    const task = tasksFor(jobId, entry, now)[0];
    return (
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-h-0 overflow-y-auto px-6 py-4">{activity}</div>
        <aside aria-label="About this job" className="grid min-h-0 content-start gap-5 overflow-y-auto border-l border-hairline bg-raised p-4">
          {task && (
            <NextStep
              task={task}
              skipped={entry.skipped ?? []}
              onLog={(t) => setLogRequest((r) => ({ n: (r?.n ?? 0) + 1, task: t }))}
              onMarkDone={(t) => onUpdate({ skipped: [...(entry.skipped ?? []), t.key] })}
              onUpdate={onUpdate}
              now={now ?? new Date()}
              saved={entry.status === "saved"}
            />
          )}
          <Section title="Interviews" count={interviews}>
            <InterviewsTab entry={entry} onUpdate={onUpdate} now={now} />
          </Section>
          <Section title="People" count={people} id={`${id}-people`}>
            <PeopleTab jobId={jobId} entry={entry} onUpdate={onUpdate} adding={adding} onAdding={setAdding} />
          </Section>
          <Section title="Details">
            <div className="grid gap-4">
              <StageDates entry={entry} onUpdate={onUpdate} now={now} />
              {jobTab}
            </div>
          </Section>
        </aside>
        {status}
      </div>
    );
  }

  const items: TabItem<Tab>[] = [
    { id: "activity", label: "Activity" },
    { id: "people", label: "People", count: people },
    { id: "interviews", label: "Interviews", ...(interviews ? { count: interviews } : {}) },
    // The dialog's side panel becomes a Details tab when there's no room for it.
    ...(jobTab || wideAsked ? [{ id: "job" as const, label: wideAsked ? "Details" : "Job" }] : []),
  ];
  const current = items.some((t) => t.id === tab) ? tab : "activity";

  return (
    <div className="grid gap-3">
      <Tabs label="Job progress" items={items} value={current} onChange={setTab} idPrefix={`${id}-tab`} panelId={`${id}-panel`} />
      <div id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-tab-${current}`}>
        {/* Activity stays mounted while another tab shows, so a half-written touch survives "Add a person". */}
        <div hidden={current !== "activity"}>{activity}</div>
        {current === "people" && <PeopleTab jobId={jobId} entry={entry} onUpdate={onUpdate} adding={adding} onAdding={setAdding} />}
        {current === "interviews" && <InterviewsTab entry={entry} onUpdate={onUpdate} now={now} />}
        {current === "job" &&
          (wideAsked ? (
            <div className="grid gap-4">
              <StageDates entry={entry} onUpdate={onUpdate} now={now} />
              {jobTab}
            </div>
          ) : (
            jobTab
          ))}
      </div>
      {status}
    </div>
  );
}

/** A side-panel section: a small heading with its count, then its content. */
function Section({ title, count, id, children }: { title: string; count?: number; id?: string; children: ReactNode }) {
  return (
    <section id={id} aria-label={title} className="grid gap-2">
      <h3 className="flex items-center gap-2 type-label font-semibold">
        {title}
        {!!count && <span className="font-medium text-muted tabular">{count}</span>}
      </h3>
      {children}
    </section>
  );
}

/**
 * The stage's dates: when you reached it (tracked late? set the real day, so follow-ups count from
 * it) and, in an active stage, when to follow up (Apply by while Saved).
 */
export function StageDates({ entry, onUpdate, now = new Date() }: { entry: Entry; onUpdate: (patch: EntryPatch) => void; now?: Date }) {
  const id = useId();
  const day = today(now);
  const since = entry.status && entry.status !== "dismissed" ? stageSince(entry) : undefined;
  const plus = (n: number) => dayAfter(`${day}T12:00:00`, n);
  if (!since && !isActive(entry.status)) return null;
  return (
    <div className="grid grid-cols-[7rem_minmax(0,1fr)] items-center gap-x-3 gap-y-2 type-small">
      {since && entry.status && (
        <>
          <label htmlFor={`${id}-since`} className="text-muted">
            {STATUS_LABEL[entry.status]} on
          </label>
          <DateField id={`${id}-since`} label={`${STATUS_LABEL[entry.status]} on`} value={dayAfter(since, 0)} max={day} onChange={(d) => d && onUpdate({ since: d })} />
        </>
      )}
      {isActive(entry.status) && (
        <>
          <label htmlFor={`${id}-follow`} className="text-muted">
            {entry.status === "saved" ? "Apply by" : "Follow up on"}
          </label>
          <DateField
            id={`${id}-follow`}
            label={entry.status === "saved" ? "Apply by" : "Follow up on"}
            value={entry.followUp ?? ""}
            min={day}
            clearable
            placeholder="No date"
            quick={[
              { label: "Tomorrow", value: plus(1) },
              { label: "In 3 days", value: plus(3) },
              { label: "Next week", value: plus(7) },
            ]}
            onChange={(d) => onUpdate({ followUp: d || undefined })}
          />
        </>
      )}
    </div>
  );
}

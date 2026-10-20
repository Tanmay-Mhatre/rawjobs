import { AlarmClock, CalendarClock, Check, Radar, StickyNote } from "lucide-react";
import { useId, useState } from "react";
import { type Task, tasksFor } from "../../lib/nextSteps";
import { addActivity, CHANNEL_LABEL, dayAfter, type Entry, type EntryPatch, isDay, today } from "../../lib/userState";
import { buttonClass, Chip, ChipGroup, Menu } from "../primitives";
import { Button, cx } from "../ui";
import { CHANNEL_ICON, Composer, type ComposerProps } from "./Composer";
import { filterTimeline, isLong, TIMELINE_FILTERS, type TimelineFilter, type TimelineItem, taskPrefill, timeline } from "./detail";

const shortDay = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const whenDay = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });

/**
 * The Activity tab: the next step pinned on top, the composer, then everything that happened on
 * the job, newest first, with All / Messages / Stages / Notes filters.
 */
export function ActivityTab({
  jobId,
  entry,
  title,
  foundAt,
  onUpdate,
  onAnnounce,
  onAddPerson,
  now = new Date(),
}: {
  jobId: string;
  entry: Entry;
  /** The job's title, for the built-in follow-up and thank-you texts. */
  title: string;
  /** When the Radar first saw the job: the timeline starts with "Found on your Radar". */
  foundAt?: string;
  onUpdate: (patch: EntryPatch) => void;
  onAnnounce: (message: string) => void;
  onAddPerson: () => void;
  now?: Date;
}) {
  const [filter, setFilter] = useState<TimelineFilter>("all");
  /** Log follow-up and Log thank-you fill the composer; the key remounts it with the new text. */
  const [prefill, setPrefill] = useState<{ n: number; initial?: ComposerProps["initial"] }>({ n: 0 });
  const composerId = useId();
  const task = tasksFor(jobId, entry, now)[0];
  const items = timeline(entry, foundAt);
  const shown = filterTimeline(items, filter);

  const logTask = (t: Task) => {
    setPrefill((p) => ({ n: p.n + 1, initial: taskPrefill(entry, t, title) }));
    // The composer is just below: put the cursor in its text so the template can be edited and logged.
    requestAnimationFrame(() => document.getElementById(`${composerId}-composer`)?.querySelector("textarea")?.focus());
  };
  const markDone = (t: Task) => onUpdate({ skipped: [...(entry.skipped ?? []), t.key] });

  return (
    <div className="grid gap-4">
      {task && <NextStep task={task} skipped={entry.skipped ?? []} onLog={logTask} onMarkDone={markDone} onUpdate={onUpdate} now={now} />}
      <div id={`${composerId}-composer`}>
        <Composer
          key={prefill.n}
          contacts={entry.contacts ?? []}
          initial={prefill.initial}
          hasFollowUp={!!entry.followUp}
          followUps={entry.status !== "saved"}
          onLog={(a, opts) => onUpdate(addActivity(entry, a, opts, now))}
          onAnnounce={onAnnounce}
          onAddPerson={onAddPerson}
          now={now}
          className="rounded-md border border-line bg-raised p-3"
        />
      </div>
      <div className="grid gap-2">
        <ChipGroup label="Show">
          {TIMELINE_FILTERS.map((f) => (
            <Chip key={f.id} pressed={filter === f.id} onClick={() => setFilter(f.id)}>
              {f.label}
            </Chip>
          ))}
        </ChipGroup>
        {shown.length === 0 ? (
          <p className="type-small text-muted">{items.length === 0 ? "Nothing logged yet. Log a message, a call or a note above." : "Nothing of this kind yet."}</p>
        ) : (
          <ol className="grid gap-0.5" aria-label="History">
            {shown.map((it) => (
              <Row key={it.key} item={it} onNote={(note) => onUpdate({ note: note || undefined })} />
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

/** The next step on this job, with its actions: Log and Snooze, Log and Mark done, or close it. */
function NextStep({ task, skipped, onLog, onMarkDone, onUpdate, now }: TaskActionsProps) {
  const day = today(now);
  const overdue = task.due < day;
  const due = overdue ? `Overdue since ${shortDay(task.due)}` : task.due === day ? "Today" : shortDay(task.due);
  return (
    <section aria-label="Next step" className="grid gap-2 rounded-md border border-line bg-inset p-3">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <h4 className="flex items-center gap-1.5 type-label">
          <CalendarClock className="size-3.5" aria-hidden /> Next step: {task.label}
        </h4>
        <span className={cx("type-small", overdue ? "font-medium text-danger-text" : "text-muted")}>{due}</span>
      </div>
      <p className="type-small text-muted">{task.why}</p>
      <TaskActions task={task} skipped={skipped} onLog={onLog} onMarkDone={onMarkDone} onUpdate={onUpdate} now={now} />
    </section>
  );
}

type TaskActionsProps = {
  task: Task;
  skipped: string[];
  onLog: (t: Task) => void;
  onMarkDone: (t: Task) => void;
  onUpdate: (p: EntryPatch) => void;
  now: Date;
  /** Interview and deadline tasks: open the job (the detail, or Compare offers). */
  onOpen?: (t: Task) => void;
  /** The deadline's button ("Compare offers" with two or more offers); Open otherwise. */
  deadlineLabel?: string;
};

/**
 * A task's buttons, shared by the job's pinned next step and the Pipeline's Next steps list: Log
 * follow-up and Snooze, Log thank-you and Mark done, Close as no response and Follow up once more, or Open.
 */
export function TaskActions({ task, skipped, onLog, onMarkDone, onUpdate, now, onOpen, deadlineLabel = "Open" }: TaskActionsProps) {
  const day = today(now);
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState("");
  const snooze = (to: string) => onUpdate({ followUp: to });
  const plus = (n: number) => dayAfter(`${day}T12:00:00`, n);
  /** A picked date counts from tomorrow on (and within 2 years); anything else is left unsaved. */
  const commitPick = () => {
    if (isDay(picked) && picked >= plus(1) && picked <= plus(730)) {
      snooze(picked);
      setPicking(false);
      setPicked("");
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      {task.kind === "follow-up" && (
        <>
          <Button size="sm" variant="primary" onClick={() => onLog(task)}>
            Log follow-up
          </Button>
          <Menu
            label="Snooze until"
            align="start"
            trigger={(t) => (
              <button type="button" className={buttonClass("secondary", "sm")} {...t}>
                <AlarmClock className="rj-icon" aria-hidden /> Snooze
              </button>
            )}
            items={[
              { id: "1", label: "Tomorrow", onSelect: () => snooze(plus(1)) },
              { id: "3", label: "In 3 days", onSelect: () => snooze(plus(3)) },
              { id: "7", label: "Next week", onSelect: () => snooze(plus(7)) },
              { id: "pick", label: "Pick a date", onSelect: () => setPicking(true) },
            ]}
          />
          {picking && (
            <label className="inline-flex items-center gap-2 type-small">
              Follow up on
              <input
                type="date"
                // biome-ignore lint/a11y/noAutofocus: focus moves into what "Pick a date" just opened
                autoFocus
                min={plus(1)}
                value={picked}
                // Saved on Enter or when you leave the field, so a year still being typed (0002-…) never lands.
                onChange={(e) => setPicked(e.target.value)}
                onBlur={commitPick}
                onKeyDown={(e) => {
                  if (e.key !== "Enter") return;
                  e.preventDefault();
                  commitPick();
                }}
                className="h-8 rounded-md border border-line bg-raised px-2 type-small text-ink"
              />
            </label>
          )}
        </>
      )}
      {task.kind === "thank-you" && (
        <>
          <Button size="sm" variant="primary" onClick={() => onLog(task)}>
            Log thank-you
          </Button>
          <Button size="sm" onClick={() => onMarkDone(task)}>
            <Check className="rj-icon" aria-hidden /> Mark done
          </Button>
        </>
      )}
      {task.kind === "close" && (
        <>
          <Button size="sm" variant="primary" onClick={() => onUpdate({ status: "rejected", closedAs: "no-response" })}>
            Close as no response
          </Button>
          <Button size="sm" onClick={() => onUpdate({ followUp: plus(7), skipped: [...skipped, task.key] })}>
            Follow up once more
          </Button>
        </>
      )}
      {onOpen && (task.kind === "interview" || task.kind === "deadline") && (
        <Button size="sm" onClick={() => onOpen(task)}>
          {task.kind === "deadline" ? deadlineLabel : "Open"}
        </Button>
      )}
    </div>
  );
}

/** One timeline row: stage changes small and grey, touches and notes full with their text. */
function Row({ item, onNote }: { item: TimelineItem; onNote: (note: string) => void }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const noteId = useId();
  if (item.kind === "stage" || item.kind === "found") {
    return (
      <li className="flex items-center gap-2 py-1 pl-6 type-meta text-muted">
        {item.kind === "found" && <Radar className="size-3.5" aria-hidden />}
        <span>{item.kind === "found" ? "Found on your Radar" : item.text}</span>
        <time dateTime={item.at} className="tabular">
          {whenDay(item.at)}
        </time>
      </li>
    );
  }
  const Icon = item.kind === "note" ? StickyNote : CHANNEL_ICON[item.activity.channel];
  const text = item.kind === "note" ? item.text : (item.activity.text ?? "");
  const long = isLong(text);
  const legacy = item.kind === "note" && !!item.legacy;
  return (
    <li className="flex gap-2 rounded-md py-2">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
      <div className="grid min-w-0 flex-1 gap-0.5">
        <div className="flex items-baseline gap-2 type-small">
          <p className="min-w-0 flex-1">
            <span className="font-medium">{item.kind === "note" ? (item.legacy ? "Your note" : "Note") : item.title}</span>
            {item.kind === "touch" && (
              <span className="block type-meta text-muted">
                {item.activity.dir === "received" ? "Received" : "Sent"} · {CHANNEL_LABEL[item.activity.channel]}
                {item.activity.followUp && " · Follow-up"}
              </span>
            )}
          </p>
          {!(item.kind === "note" && item.legacy) && (
            <time dateTime={item.at} className="shrink-0 type-meta tabular text-muted">
              {when(item.at)}
            </time>
          )}
        </div>
        {legacy && editing ? (
          <form
            className="grid gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              onNote(String(new FormData(e.currentTarget).get("note") ?? "").trim());
              setEditing(false);
            }}
          >
            <label htmlFor={noteId} className="sr-only">
              Your note
            </label>
            {/* biome-ignore lint/a11y/noAutofocus: focus moves into the note that Edit just opened */}
            <textarea id={noteId} name="note" autoFocus defaultValue={text} rows={3} className="rounded-md border border-line bg-raised px-2.5 py-2 type-small text-ink" />
            <div className="flex gap-2">
              <Button size="sm" type="submit" variant="primary">
                Save note
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          text && <p className={cx("whitespace-pre-line break-words type-small", long && !open && "line-clamp-6")}>{text}</p>
        )}
        {long && !editing && (
          <button type="button" className="justify-self-start type-small text-muted underline hover:text-ink" aria-expanded={open} onClick={() => setOpen(!open)}>
            {open ? "Show less" : "Show more"}
          </button>
        )}
        {legacy && !editing && (
          <div className="flex gap-1.5">
            <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
              Edit note
            </Button>
            <Button size="sm" variant="ghost" onClick={() => onNote("")}>
              Delete note
            </Button>
          </div>
        )}
      </div>
    </li>
  );
}

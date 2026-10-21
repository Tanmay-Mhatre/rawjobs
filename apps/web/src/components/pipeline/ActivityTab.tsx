import { AlarmClock, CalendarClock, Check, ChevronRight, History, Pencil, Radar, StickyNote } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { type Task, tasksFor } from "../../lib/nextSteps";
import { addActivity, CHANNEL_LABEL, type Channel, dayAfter, type Entry, type EntryPatch, today } from "../../lib/userState";
import { DateField } from "../DateField";
import { buttonClass, Chip, ChipGroup, Menu } from "../primitives";
import { Button, cx } from "../ui";
import { CHANNEL_ICON, Composer, type ComposerProps } from "./Composer";
import { filterTimeline, isLong, TIMELINE_FILTERS, type TimelineFilter, type TimelineItem, taskPrefill, timeline } from "./detail";

const shortDay = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });
const timeOf = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
const localDay = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** "Today", "Yesterday", "Oct 19", or "Oct 19, 2025" in another year. */
function dayHeading(day: string, now: Date) {
  const t = today(now);
  if (day === t) return "Today";
  if (day === dayAfter(`${t}T12:00:00`, -1)) return "Yesterday";
  return new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric", ...(day.slice(0, 4) !== t.slice(0, 4) ? { year: "numeric" } : {}) });
}

/** A day's items, with edits in a row folded into one line ("3 edits: …"). */
type Shown = { kind: "item"; item: TimelineItem } | { kind: "edits"; key: string; items: Extract<TimelineItem, { kind: "change" }>[] };
function fold(items: TimelineItem[]): Shown[] {
  const out: Shown[] = [];
  for (const it of items) {
    const last = out.at(-1);
    if (it.kind === "change" && last?.kind === "edits") last.items.push(it);
    else if (it.kind === "change" && last?.kind === "item" && last.item.kind === "change") out[out.length - 1] = { kind: "edits", key: last.item.key, items: [last.item, it] };
    else out.push({ kind: "item", item: it });
  }
  return out;
}

/** The newest first, in days; the v1 note (no date of its own) on top without a day. */
function byDay(items: TimelineItem[]): { day?: string; items: TimelineItem[] }[] {
  const out: { day?: string; items: TimelineItem[] }[] = [];
  for (const it of items) {
    const day = it.kind === "note" && it.legacy ? undefined : localDay(it.at);
    const last = out.at(-1);
    if (last && last.day === day) last.items.push(it);
    else out.push({ day, items: [it] });
  }
  return out;
}

/** What the one-line composer offers first; the rest are in its Type menu. */
const QUICK: Channel[] = ["email", "call", "note"];

/**
 * The Activity: the next step pinned on top (unless the side panel shows it), a one-line composer
 * that opens when you use it, then everything that happened on the job, newest first and grouped
 * by day, with All / Messages / Notes / Changes filters.
 */
export function ActivityTab({
  jobId,
  entry,
  title,
  foundAt,
  onUpdate,
  onAnnounce,
  onAddPerson,
  wide,
  logRequest,
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
  /** In the wide dialog: a heading of its own, and the next step lives in the side panel. */
  wide?: boolean;
  /** Log follow-up / Log thank-you pressed in the side panel: fill the composer for that task. */
  logRequest?: { n: number; task: Task };
  now?: Date;
}) {
  const [filter, setFilter] = useState<TimelineFilter>("all");
  /** Log follow-up and Log thank-you fill the composer; the key remounts it with the new text. */
  const [prefill, setPrefill] = useState<{ n: number; initial?: ComposerProps["initial"] }>({ n: 0 });
  const [composing, setComposing] = useState(false);
  const composerId = useId();
  const task = tasksFor(jobId, entry, now)[0];
  const items = timeline(entry, foundAt);
  const shown = filterTimeline(items, filter);

  const compose = (initial?: ComposerProps["initial"]) => {
    setPrefill((p) => ({ n: p.n + 1, initial }));
    setComposing(true);
    // Put the cursor in its text, so a template can be edited and logged.
    requestAnimationFrame(() => document.getElementById(`${composerId}-composer`)?.querySelector("textarea")?.focus());
  };
  const logTask = (t: Task) => compose(taskPrefill(entry, t, title));
  // biome-ignore lint/correctness/useExhaustiveDependencies: only when a new request comes in
  useEffect(() => {
    if (logRequest) logTask(logRequest.task);
  }, [logRequest]);
  const markDone = (t: Task) => onUpdate({ skipped: [...(entry.skipped ?? []), t.key] });

  return (
    // One column that never grows past its box: a truncated line ("3 edits: …") mustn't widen it.
    <div className="grid grid-cols-1 gap-4">
      {!wide && task && <NextStep task={task} skipped={entry.skipped ?? []} onLog={logTask} onMarkDone={markDone} onUpdate={onUpdate} now={now} saved={entry.status === "saved"} />}
      <div className="grid grid-cols-1 gap-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {wide && <h3 className="type-label font-semibold">Activity</h3>}
          <ChipGroup label="Show" className="ml-auto gap-1">
            {TIMELINE_FILTERS.map((f) => (
              <Chip key={f.id} pressed={filter === f.id} onClick={() => setFilter(f.id)}>
                {f.label}
              </Chip>
            ))}
          </ChipGroup>
        </div>
        <div id={`${composerId}-composer`}>
          {composing ? (
            <Composer
              key={prefill.n}
              contacts={entry.contacts ?? []}
              initial={prefill.initial}
              hasFollowUp={!!entry.followUp}
              followUps={entry.status !== "saved"}
              onLog={(a, opts) => {
                onUpdate(addActivity(entry, a, opts, now));
                setComposing(false);
              }}
              onAnnounce={onAnnounce}
              onAddPerson={onAddPerson}
              onCancel={() => setComposing(false)}
              now={now}
              className="rounded-md border border-line bg-raised p-3"
            />
          ) : (
            <div className="flex items-center gap-1 rounded-md border border-line bg-raised py-1 pl-1 pr-1">
              <button type="button" onClick={() => compose()} className="h-8 min-w-0 flex-1 truncate rounded-sm px-2 text-left type-small text-muted hover:text-ink">
                Log a message, call or note…
              </button>
              {QUICK.map((c) => {
                const Icon = CHANNEL_ICON[c];
                return (
                  <Button key={c} size="sm" variant="ghost" aria-label={`Log ${CHANNEL_LABEL[c].toLowerCase()}`} onClick={() => compose({ channel: c })}>
                    <Icon className="rj-icon" aria-hidden />
                    <span className="hidden sm:inline">{CHANNEL_LABEL[c]}</span>
                  </Button>
                );
              })}
            </div>
          )}
        </div>
        {shown.length === 0 ? (
          <p className="type-small text-muted">{items.length === 0 ? "Nothing logged yet. Log a message, a call or a note above." : "Nothing of this kind yet."}</p>
        ) : (
          <ol className="grid grid-cols-1 gap-3" aria-label="History">
            {byDay(shown).map((group) => (
              <li key={group.day ?? "undated"} className="grid grid-cols-1 gap-1">
                {group.day && <h4 className="type-meta font-medium text-muted">{dayHeading(group.day, now)}</h4>}
                <ol className="relative ml-1 grid grid-cols-1 border-l border-hairline pl-4 [&>li]:min-w-0">
                  {fold(group.items).map((s) =>
                    s.kind === "edits" ? <Edits key={s.key} items={s.items} /> : <Row key={s.item.key} item={s.item} onNote={(note) => onUpdate({ note: note || undefined })} />,
                  )}
                </ol>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

/** The rail's dot for one row: filled for a message or note, hollow for the rest. */
function Dot({ solid }: { solid?: boolean }) {
  return <span aria-hidden className={cx("absolute -left-[21px] top-2 size-2 rounded-dot border", solid ? "border-ink bg-ink" : "border-control bg-overlay")} />;
}

/** Edits in a row, folded: "3 edits: Follow-up moved to Oct 28, CV set to …", opening to the list. */
function Edits({ items }: { items: Extract<TimelineItem, { kind: "change" }>[] }) {
  return (
    <li className="relative">
      <Dot />
      <details className="group">
        <summary className="flex cursor-pointer list-none items-center gap-2 py-1 type-small text-muted hover:text-ink [&::-webkit-details-marker]:hidden">
          <ChevronRight className="size-3.5 shrink-0 transition-transform group-open:rotate-90" aria-hidden />
          <span className="min-w-0 flex-1 truncate">
            {items.length} edits: {items.map((i) => i.text).join(", ")}
          </span>
          <time dateTime={items[0]!.at} className="shrink-0 type-meta tabular">
            {timeOf(items[0]!.at)}
          </time>
        </summary>
        <ul className="grid pb-1 pl-5">
          {items.map((i) => (
            <li key={i.key} className="flex items-center gap-2 py-0.5 type-small text-muted">
              <Pencil className="size-3.5 shrink-0" aria-hidden />
              <span className="min-w-0 flex-1">{i.text}</span>
              <time dateTime={i.at} className="shrink-0 type-meta tabular">
                {timeOf(i.at)}
              </time>
            </li>
          ))}
        </ul>
      </details>
    </li>
  );
}

/** The next step on this job, with its actions: Log and Snooze, Log and Mark done, or close it. */
export function NextStep({ task, skipped, onLog, onMarkDone, onUpdate, now, saved }: TaskActionsProps) {
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
      <TaskActions task={task} skipped={skipped} onLog={onLog} onMarkDone={onMarkDone} onUpdate={onUpdate} now={now} saved={saved} />
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
  /** In a list of tasks: no accent buttons, so the one accent isn't on every row. */
  quiet?: boolean;
  /** A Saved job: its date is "Apply by", so there's nothing to log; Open, Snooze and Mark done instead. */
  saved?: boolean;
};

/**
 * A task's buttons, shared by the job's pinned next step and the Pipeline's Next steps list: Log
 * follow-up and Snooze, Log thank-you and Mark done, Close as no response and Follow up once more, or Open.
 */
export function TaskActions({ task, skipped, onLog, onMarkDone, onUpdate, now, onOpen, deadlineLabel = "Open", quiet, saved }: TaskActionsProps) {
  const main = quiet ? undefined : ("primary" as const);
  const day = today(now);
  const [picking, setPicking] = useState(false);
  const snooze = (to: string) => onUpdate({ followUp: to });
  const plus = (n: number) => dayAfter(`${day}T12:00:00`, n);
  return (
    <div className="flex flex-wrap items-center gap-2">
      {task.kind === "follow-up" && (
        <>
          {saved ? (
            onOpen && (
              <Button size="sm" variant={main} onClick={() => onOpen(task)}>
                Open
              </Button>
            )
          ) : (
            <Button size="sm" variant={main} onClick={() => onLog(task)}>
              Log follow-up
            </Button>
          )}
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
            <span className="inline-flex w-52 items-center">
              {/* Opens straight away; a day from tomorrow on (within 2 years) saves it. */}
              <DateField
                label="Follow up on"
                value={task.due}
                min={plus(1)}
                max={plus(730)}
                autoOpen
                onChange={(d) => {
                  if (d) snooze(d);
                  setPicking(false);
                }}
              />
            </span>
          )}
          {saved && (
            <Button size="sm" onClick={() => onMarkDone(task)}>
              <Check className="rj-icon" aria-hidden /> Mark done
            </Button>
          )}
        </>
      )}
      {task.kind === "thank-you" && (
        <>
          <Button size="sm" variant={main} onClick={() => onLog(task)}>
            Log thank-you
          </Button>
          <Button size="sm" onClick={() => onMarkDone(task)}>
            <Check className="rj-icon" aria-hidden /> Mark done
          </Button>
        </>
      )}
      {task.kind === "close" && (
        <>
          <Button size="sm" variant={main} onClick={() => onUpdate({ status: "rejected", closedAs: "no-response" })}>
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

/** One timeline row: stage changes and edits one grey line, touches and notes a card with their text. */
function Row({ item, onNote }: { item: TimelineItem; onNote: (note: string) => void }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const noteId = useId();
  if (item.kind === "stage" || item.kind === "change" || item.kind === "found") {
    const Icon = item.kind === "found" ? Radar : item.kind === "stage" ? History : Pencil;
    return (
      <li className="relative flex items-center gap-2 py-1 type-small text-muted">
        <Dot />
        <Icon className="size-3.5 shrink-0" aria-hidden />
        <span className="min-w-0 flex-1">{item.kind === "found" ? "Found on your Radar" : item.text}</span>
        <time dateTime={item.at} className="shrink-0 type-meta tabular">
          {timeOf(item.at)}
        </time>
      </li>
    );
  }
  const Icon = item.kind === "note" ? StickyNote : CHANNEL_ICON[item.activity.channel];
  const text = item.kind === "note" ? item.text : (item.activity.text ?? "");
  const long = isLong(text);
  const legacy = item.kind === "note" && !!item.legacy;
  return (
    <li className="relative my-1 flex gap-2 rounded-md border border-hairline bg-raised px-3 py-2">
      <Dot solid />
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
              {timeOf(item.at)}
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

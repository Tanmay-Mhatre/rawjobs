import { displayName } from "@rawjobs/core/display-name";
import { ArrowRight, CalendarClock, ChevronDown, History, Plus, Radar, X } from "lucide-react";
import { type DragEvent, type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import type { Job } from "../lib/data";
import { cleanLocation, timeAgo } from "../lib/format";
import { type CardState, cardState, closeSuggestion, groupTasks, lastActivity, nextSteps, type Task } from "../lib/nextSteps";
import type { WeeklyPlan } from "../lib/prefs";
import { useMedia } from "../lib/useMedia";
import {
  addActivity,
  CLOSED_AS,
  type ClosedAs,
  type Entry,
  type EntryPatch,
  PIPELINE,
  type PipelineStatus,
  STATUS_LABEL,
  type Status,
  stageSince,
  statusLabel,
  today,
  type UserState,
} from "../lib/userState";
import { Dialog } from "./Dialog";
import { EmptyState } from "./EmptyState";
import { TaskActions } from "./pipeline/ActivityTab";
import { CHANNEL_ICON, Composer } from "./pipeline/Composer";
import { taskPrefill } from "./pipeline/detail";
import { PipelineInsights } from "./PipelineInsights";
import { buttonClass, Chip, ChipGroup, Kbd, Menu } from "./primitives";
import { useHourlyNow } from "./radar/hooks";
import { AddJobDialog, CompareOffers, nextInterview, TrackedJobDialog } from "./TrackedJob";
import { Button, Card, cx, IconButton } from "./ui";

type Props = {
  user: UserState;
  jobsById: Map<string, Job>;
  onOpen: (job: Job) => void;
  /** Change one card: a move (status undefined takes it off the board; its note, if any, stays), a follow-up date… */
  onPatch: (id: string, entry: Entry, patch: EntryPatch) => void;
  /** Track a job RawJobs didn't find. */
  onAdd: (job: { title: string; company: string; url: string }, status: Status) => void;
  weeklyPlan?: WeeklyPlan;
  onWeeklyPlan: (plan: WeeklyPlan) => void;
  /** Radar not set up yet: the empty state points to setup instead of the Radar. */
  onSetup?: () => void;
  goRadar: () => void;
  /** The To review column (lib/toReview); left out while the Radar isn't set up. */
  review?: { jobs: Job[]; total: number };
  /** Save, or Not interested (which asks why and hides it on the Radar). */
  onReview?: (job: Job, status: "saved" | "dismissed") => void;
  /** Tests pin the clock; the app moves it on every hour. */
  now?: Date;
};

type Column = PipelineStatus | "review";
const COLUMN_LABEL: Record<Column, string> = { review: "To review", ...STATUS_LABEL };
/** Closed shows this many cards, then "Show N more". */
const CLOSED_SHOWN = 3;
const REVIEW_DRAG = "review:";

const shortDay = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });

/** The word for a task on a card chip: "Follow up", "Apply by" (a Saved job's date), "Interview"… */
function taskWord(t: Task): string {
  if (t.kind === "follow-up") return t.label;
  if (t.kind === "thank-you") return "Send thank-you";
  if (t.kind === "interview") return "Interview";
  if (t.kind === "deadline") return "Answer offer";
  return "Close as no response";
}

export type ChipTone = "danger" | "warning" | "neutral" | "none";

/**
 * The card's next-step chip: always a word, never colour alone (design/README.md). Overdue is danger,
 * today and "No reply" are warning, later is neutral with the date, none is a dashed "No next step".
 * Closed cards have no chip.
 */
export function cardChip(e: Entry, s: CardState, now = new Date()): { text: string; tone: ChipTone } | undefined {
  if (s.tone === "closed") return undefined;
  const t = s.task;
  // The close suggestion reads as how long it's been quiet.
  if (t?.kind === "close" && s.tone !== "overdue") return { text: `No reply · ${closeSuggestion(e, now)?.days ?? 0}d`, tone: "warning" };
  if (s.tone === "overdue" && t) return { text: `${taskWord(t)} · ${s.days}d overdue`, tone: "danger" };
  if (s.tone === "today" && t) return { text: `${taskWord(t)} today`, tone: "warning" };
  if (s.tone === "quiet") return { text: `No reply · ${s.days}d`, tone: "warning" };
  if (s.tone === "later" && t) return { text: `${taskWord(t)} ${shortDay(t.due)}`, tone: "neutral" };
  return { text: "No next step", tone: "none" };
}

const CHIP_CLASS: Record<ChipTone, string> = {
  danger: "border-danger bg-danger-subtle text-danger-text",
  warning: "border-warning bg-warning-subtle text-warning-text",
  neutral: "border-line bg-inset text-ink",
  none: "border-dashed border-line text-muted",
};
const DOT_CLASS: Record<CardState["tone"], string> = {
  overdue: "bg-danger",
  today: "bg-warning",
  quiet: "bg-warning",
  later: "bg-muted",
  none: "border border-dashed border-muted",
  closed: "bg-line",
};

type Item = [string, Entry];

/**
 * Cards in a column: overdue first, then by next-step date, then by time in the stage (longest
 * waiting first; Closed shows the most recently closed first).
 */
export function sortCards(items: Item[], tasks: Map<string, Task[]>, now = new Date()): Item[] {
  const day = today(now);
  const key = ([id]: Item) => {
    const due = tasks.get(id)?.[0]?.due;
    return { overdue: !!due && due < day, due: due ?? "9999-99-99" };
  };
  return [...items].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    if (ka.overdue !== kb.overdue) return ka.overdue ? -1 : 1;
    if (ka.due !== kb.due) return ka.due.localeCompare(kb.due);
    const sa = stageSince(a[1]);
    const sb = stageSince(b[1]);
    return a[1].status === "rejected" ? sb.localeCompare(sa) : sa.localeCompare(sb);
  });
}

/** "2 rejected, 1 no response": the Closed column's outcomes. */
export function closedHint(items: Item[]): string {
  const counts = new Map<string, number>();
  for (const [, e] of items) {
    const label = statusLabel(e).toLowerCase();
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts].map(([label, n]) => `${n} ${label}`).join(", ");
}

export function Pipeline({ user, jobsById, onOpen, onPatch, onAdd, weeklyPlan, onWeeklyPlan, onSetup, goRadar, review, onReview, now: fixedNow }: Props) {
  const hourly = useHourlyNow();
  const nowMs = fixedNow?.getTime() ?? hourly;
  const now = useMemo(() => new Date(nowMs), [nowMs]);
  /** Every job's tasks, worked out once per change or hour; the cards, the sort and Next steps read it. */
  const tasks = useMemo(() => nextSteps(user, now), [user, now]);
  /** A card for a job not on the Radar (added by hand, or no longer listed) opens here instead of the job drawer. */
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [comparing, setComparing] = useState(false);
  /** A move to Closed waits here for how it ended. */
  const [closing, setClosing] = useState<{ id: string; entry: Entry } | null>(null);
  /** Log follow-up / Log thank-you: the composer pop-over. */
  const [logging, setLogging] = useState<Task | null>(null);
  const [moreClosed, setMoreClosed] = useState(false);
  // Every job with offer terms written down, whatever its stage now (accepted, declined…).
  const offers = Object.entries(user)
    .filter(([, e]) => e.offer && e.status !== "dismissed")
    .map(([id, entry]) => ({ id, entry }));
  const addDialog = <AddJobDialog open={adding} onClose={() => setAdding(false)} onAdd={onAdd} />;
  /** Every move goes through here: Closed asks how it ended first. */
  const onMove = (id: string, entry: Entry, status: Status | undefined) => {
    if (status === "rejected" && entry.status !== "rejected") setClosing({ id, entry });
    else onPatch(id, entry, { status });
  };
  const [dragOver, setDragOver] = useState<Column | null>(null);
  /** A To review card being dragged: only Saved takes it. */
  const [draggingReview, setDraggingReview] = useState(false);
  /** Phones show one column at a time, picked from the status chips. */
  const [mobileCol, setMobileCol] = useState<Column | null>(null);
  /** What the last keyboard move or log did, for screen readers (design/components/Pipeline: a polite live region). */
  const [announce, setAnnounce] = useState("");
  /** The card just moved with [ or ]: it re-renders in its new column, then gets focus back. */
  const refocus = useRef<string | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const id = refocus.current;
    if (!id) return;
    refocus.current = null;
    const card = [...(boardRef.current?.querySelectorAll<HTMLElement>("[data-card-id]") ?? [])].find((el) => el.dataset.cardId === id);
    card?.querySelector<HTMLElement>("[data-card-title]")?.focus();
  });
  const entries = Object.entries(user).filter(([, e]) => e.status && e.status !== "dismissed");
  const reviewJobs = review?.jobs ?? [];

  if (entries.length === 0 && reviewJobs.length === 0) {
    return (
      <>
        {addDialog}
        <EmptyState
          title="Track your applications here"
          actions={
            onSetup ? (
              <Button variant="primary" onClick={onSetup}>
                Set up my radar <ArrowRight className="size-4" />
              </Button>
            ) : (
              <Button variant="primary" onClick={goRadar}>
                Browse my matches <ArrowRight className="size-4" />
              </Button>
            )
          }
        >
          {onSetup ? (
            "Jobs you save or apply to show up here as cards you can move from Saved to Offer. Set up your radar to start finding them."
          ) : (
            <>
              Save a job on the Radar (press <Kbd>S</Kbd>) and it shows up here. Drag cards between columns as you progress. Applied somewhere else?{" "}
              <button type="button" className="font-medium text-ink underline" onClick={() => setAdding(true)}>
                Track a job by hand
              </button>
              .
            </>
          )}
        </EmptyState>
      </>
    );
  }

  const columns: { col: PipelineStatus; items: Item[] }[] = PIPELINE.map((col) => ({
    col,
    items: sortCards(
      entries.filter(([, e]) => e.status === col),
      tasks,
      now,
    ),
  }));
  const showReview = !!review;
  const chips: { col: Column; count: number }[] = [...(showReview ? [{ col: "review" as const, count: review.total }] : []), ...columns.map((c) => ({ col: c.col, count: c.items.length }))];
  // Default to the first column with cards in it.
  const shown = mobileCol ?? chips.find((c) => c.count)?.col ?? PIPELINE[0];

  /** [ and ] move a card one column back or forward; focus stays on it and the move is announced. */
  const moveBy = (id: string, entry: Entry, d: -1 | 1) => {
    const at = PIPELINE.indexOf(entry.status as PipelineStatus);
    const to = PIPELINE[at + d];
    if (at < 0 || !to) return;
    refocus.current = id;
    // Phones show one column: follow the card into its new one.
    setMobileCol(to);
    if (to !== "rejected") setAnnounce(`Moved ${entry.snapshot.title} to ${STATUS_LABEL[to]}`);
    onMove(id, entry, to);
  };
  const open = (id: string) => {
    const job = jobsById.get(id);
    if (job) onOpen(job);
    else setEditing(id);
  };
  const loggingEntry = logging ? user[logging.id] : undefined;

  const dropTarget = (col: PipelineStatus) => ({
    onDragOver: (e: DragEvent) => {
      if (draggingReview && col !== "saved") return;
      e.preventDefault();
      setDragOver(col);
    },
    onDragLeave: () => setDragOver((c) => (c === col ? null : c)),
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      setDragOver(null);
      setDraggingReview(false);
      const data = e.dataTransfer.getData("text/plain");
      if (data.startsWith(REVIEW_DRAG)) {
        const job = reviewJobs.find((j) => j.id === data.slice(REVIEW_DRAG.length));
        if (job && col === "saved") onReview?.(job, "saved");
        return;
      }
      const entry = user[data];
      if (entry && entry.status !== col) onMove(data, entry, col);
    },
  });

  return (
    <div ref={boardRef} className="pb-2">
      {addDialog}
      <TrackedJobDialog
        id={editing}
        entry={editing ? user[editing] : undefined}
        onClose={() => setEditing(null)}
        // A new title, company or link goes in through the entry's snapshot, which the patch is applied to.
        onUpdate={(patch, job) => editing && user[editing] && onPatch(editing, job ? { ...user[editing], snapshot: { ...user[editing].snapshot, ...job } } : user[editing], patch)}
      />
      {comparing && <CompareOffers offers={offers} onClose={() => setComparing(false)} />}
      <CloseDialog
        target={closing}
        onClose={() => setClosing(null)}
        onPick={(how) => {
          if (!closing) return;
          onPatch(closing.id, closing.entry, { status: "rejected", closedAs: how });
          setAnnounce(`Closed ${closing.entry.snapshot.title}: ${CLOSED_AS[how].toLowerCase()}`);
          setClosing(null);
        }}
      />
      <Dialog open={!!logging && !!loggingEntry} onClose={() => setLogging(null)} labelledBy="log-task-title" initialFocus="textarea">
        {logging && loggingEntry && (
          <Card className="grid gap-3 p-5 shadow-l3 sm:p-6">
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <h2 id="log-task-title" className="type-subheading font-semibold">
                  {logging.kind === "thank-you" ? "Log thank-you" : "Log follow-up"}
                </h2>
                <p className="truncate type-small text-muted">
                  {loggingEntry.snapshot.title} · {displayName(loggingEntry.snapshot.company)}
                </p>
              </div>
              <IconButton label="Close" className="-mr-2 -mt-1" onClick={() => setLogging(null)}>
                <X className="size-4" />
              </IconButton>
            </div>
            <Composer
              contacts={loggingEntry.contacts ?? []}
              initial={taskPrefill(loggingEntry, logging, loggingEntry.snapshot.title)}
              hasFollowUp={!!loggingEntry.followUp}
              followUps={loggingEntry.status !== "saved"}
              onLog={(a, opts) => {
                onPatch(logging.id, loggingEntry, addActivity(loggingEntry, a, opts, now));
                setLogging(null);
              }}
              onAnnounce={setAnnounce}
              onAddPerson={() => {
                setLogging(null);
                open(logging.id);
              }}
              now={now}
            />
          </Card>
        )}
      </Dialog>
      <div className="mb-3 flex justify-end gap-2">
        {offers.length >= 2 && (
          <Button size="sm" onClick={() => setComparing(true)}>
            Compare {offers.length} offers
          </Button>
        )}
        <Button size="sm" onClick={() => setAdding(true)}>
          <Plus className="size-4" /> Track a job
        </Button>
      </div>
      <PipelineInsights user={user} plan={weeklyPlan ?? {}} onPlan={onWeeklyPlan} />
      <NextSteps user={user} tasks={tasks} now={now} onOpen={open} onPatch={onPatch} onLog={setLogging} onCompare={offers.length >= 2 ? () => setComparing(true) : undefined} />
      <p id="pipeline-move-help" className="sr-only">
        Press [ or ] to move this job to the previous or next stage.
      </p>
      <p className="sr-only" role="status" aria-live="polite">
        {announce}
      </p>
      <div className="-mx-4 mb-3 overflow-x-auto px-4 md:hidden [mask-image:linear-gradient(to_right,transparent,black_1rem,black_calc(100%-1.5rem),transparent)]">
        <ChipGroup label="Pipeline column" className="w-max pr-4">
          {chips.map(({ col, count }) => (
            <Chip key={col} pressed={shown === col} onClick={() => setMobileCol(col)} count={count} className="whitespace-nowrap">
              {COLUMN_LABEL[col]}
            </Chip>
          ))}
        </ChipGroup>
      </div>
      <div className="md:overflow-x-auto">
        <div className={cx("grid gap-3", showReview ? "md:min-w-[1080px] md:grid-cols-6" : "md:min-w-[900px] md:grid-cols-5")}>
          {showReview && (
            <section aria-labelledby="col-review" className={cx("min-h-64 flex-col rounded-md border border-dashed border-line p-2 md:flex", shown === "review" ? "flex" : "hidden")}>
              <h2 id="col-review" className="flex items-center justify-between px-1.5 py-1 type-small font-semibold">
                To review <span className="tabular type-meta font-medium text-muted">{review.total}</span>
              </h2>
              <p className="px-1.5 type-meta text-muted">New strong matches waiting for you</p>
              {reviewJobs.length === 0 ? (
                <p className="px-1.5 py-3 type-small text-muted">No new strong matches.</p>
              ) : (
                <ul className="mt-2 flex flex-col gap-2">
                  {reviewJobs.map((job) => (
                    <ReviewCard key={job.id} job={job} now={nowMs} onOpen={onOpen} onReview={onReview} onDrag={setDraggingReview} />
                  ))}
                </ul>
              )}
              {review.total > reviewJobs.length && (
                <button type="button" className="mt-2 px-1.5 text-left type-small font-medium text-ink underline" onClick={goRadar}>
                  See all {review.total} on the Radar
                </button>
              )}
            </section>
          )}
          {columns.map(({ col, items }) => {
            const closed = col === "rejected";
            const visible = closed && !moreClosed ? items.slice(0, CLOSED_SHOWN) : items;
            return (
              <section
                key={col}
                {...dropTarget(col)}
                aria-labelledby={`col-${col}`}
                className={cx(
                  "min-h-64 flex-col rounded-md border bg-inset/50 p-2 transition-colors md:flex",
                  shown === col ? "flex" : "hidden",
                  dragOver === col ? "border-ink bg-active" : "border-line",
                )}
              >
                <h2 id={`col-${col}`} className="flex items-center justify-between px-1.5 py-1 type-small font-semibold">
                  {STATUS_LABEL[col]} <span className="tabular type-meta font-medium text-muted">{items.length}</span>
                </h2>
                {closed && items.length > 0 && <p className="px-1.5 type-meta text-muted">{closedHint(items)}</p>}
                <ul className="mt-1 flex flex-col gap-2">
                  {visible.map(([id, e]) => (
                    <BoardCard
                      key={id}
                      id={id}
                      entry={e}
                      job={jobsById.get(id)}
                      tasks={tasks.get(id) ?? []}
                      now={now}
                      onOpen={() => open(id)}
                      onMove={(to) => onMove(id, e, to)}
                      onMoveBy={(d) => moveBy(id, e, d)}
                    />
                  ))}
                </ul>
                {closed && items.length > CLOSED_SHOWN && (
                  <button type="button" className="mt-2 px-1.5 text-left type-small font-medium text-ink underline" onClick={() => setMoreClosed((v) => !v)}>
                    {moreClosed ? "Show fewer" : `Show ${items.length - CLOSED_SHOWN} more`}
                  </button>
                )}
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** A tracked job's card: dot, title, company, last activity, next step, next interview, time in stage. No score. */
function BoardCard({
  id,
  entry: e,
  job,
  tasks,
  now,
  onOpen,
  onMove,
  onMoveBy,
}: {
  id: string;
  entry: Entry;
  job?: Job;
  tasks: Task[];
  now: Date;
  onOpen: () => void;
  onMove: (to: Status | undefined) => void;
  onMoveBy: (d: -1 | 1) => void;
}) {
  const s = e.snapshot;
  const state = cardState(e, tasks, now);
  const chip = cardChip(e, state, now);
  const last = lastActivity(e);
  const LastIcon = last?.channel ? CHANNEL_ICON[last.channel] : History;
  const interview = nextInterview(e, now);
  // The interview chip only when the next-step chip isn't already that interview.
  const showInterview = interview && !(state.task?.kind === "interview" && state.task.due === interview.on);
  const onKeys = (ev: KeyboardEvent) => {
    if ((ev.key !== "[" && ev.key !== "]") || ev.metaKey || ev.ctrlKey || ev.altKey) return;
    ev.preventDefault();
    onMoveBy(ev.key === "[" ? -1 : 1);
  };
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: mouse shortcut: the card's title button is the keyboard and screen-reader way in
    <li
      data-card-id={id}
      draggable
      onDragStart={(ev) => ev.dataTransfer.setData("text/plain", id)}
      // Mouse shortcut: the whole card opens the job; the title button is the keyboard / screen-reader way in.
      onClick={onOpen}
      className="cursor-pointer rounded-md border border-line bg-raised p-3 shadow-l1 transition-shadow hover:shadow-l2"
    >
      <div className="flex items-start gap-2">
        <span aria-hidden className={cx("mt-1.5 size-2 shrink-0 rounded-dot", DOT_CLASS[state.tone])} />
        <div className="min-w-0 flex-1">
          <button
            type="button"
            data-card-title
            aria-describedby="pipeline-move-help"
            aria-keyshortcuts="[ ]"
            className="line-clamp-2 text-left type-small font-semibold leading-5 hover:underline"
            onClick={(ev) => {
              ev.stopPropagation();
              onOpen();
            }}
            onKeyDown={onKeys}
          >
            {s.title}
          </button>
          <p className="truncate type-small text-muted">
            {displayName(s.company)}
            {job?.status === "closed" ? " · Closed" : id.startsWith("manual:") ? " · Added by you" : !job ? " · No longer listed" : ""}
          </p>
        </div>
      </div>
      {last && (
        <p className="mt-2 flex items-center gap-1.5 type-meta text-muted">
          <LastIcon className="size-3.5 shrink-0" aria-hidden />
          <span className="truncate">
            {last.text} · {timeAgo(last.at, now.getTime())}
          </span>
        </p>
      )}
      {e.status === "rejected" && e.closedAs && e.closedAs !== "rejected" && <p className="mt-2 type-meta text-muted">{statusLabel(e)}</p>}
      {(chip || showInterview) && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {chip && <span className={cx("inline-flex items-center rounded-sm border px-1.5 py-0.5 type-meta font-medium", CHIP_CLASS[chip.tone])}>{chip.text}</span>}
          {showInterview && (
            <span className="inline-flex items-center gap-1 rounded-sm border border-line px-1.5 py-0.5 type-meta font-medium text-ink">
              <CalendarClock className="size-3.5" aria-hidden />
              {interview.what} {shortDay(interview.on)}
              {interview.time ? `, ${interview.time}` : ""}
            </span>
          )}
        </div>
      )}
      <div className="mt-2 flex items-center justify-between gap-2">
        {/* Keyboard / touch alternative to dragging. Clicks stay here, not on the card (which opens the job). */}
        {/* biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/useKeyWithClickEvents: only stops the click reaching the card; the menu is the control */}
        <span onClick={(ev) => ev.stopPropagation()}>
          <Menu
            label={`Move ${s.title} to`}
            align="start"
            trigger={(t) => (
              <button type="button" aria-label={`Move ${s.title} to`} className={buttonClass("quiet", "sm", "-ml-1.5 px-1.5")} {...t}>
                Move <ChevronDown className="rj-icon" aria-hidden />
              </button>
            )}
            items={[
              ...PIPELINE.filter((p) => p !== e.status).map((p) => ({ id: p, label: STATUS_LABEL[p], onSelect: () => onMove(p) })),
              { separator: true as const, id: "sep" },
              { id: "remove", label: "Remove from the board", danger: true, onSelect: () => onMove(undefined) },
            ]}
          />
        </span>
        {/* Time in this stage, not since the last note edit. */}
        <span className="shrink-0 type-meta text-muted">{timeAgo(stageSince(e), now.getTime())}</span>
      </div>
    </li>
  );
}

/** A To review card: a strong match you haven't tracked yet. Save, or Not interested. */
function ReviewCard({
  job,
  now,
  onOpen,
  onReview,
  onDrag,
}: {
  job: Job;
  now: number;
  onOpen: (job: Job) => void;
  onReview?: (job: Job, status: "saved" | "dismissed") => void;
  onDrag: (on: boolean) => void;
}) {
  const place = cleanLocation(job.location);
  return (
    <li
      draggable
      onDragStart={(ev) => {
        ev.dataTransfer.setData("text/plain", `${REVIEW_DRAG}${job.id}`);
        onDrag(true);
      }}
      onDragEnd={() => onDrag(false)}
      className="rounded-md border border-line bg-raised p-3 shadow-l1"
    >
      <button type="button" className="line-clamp-2 text-left type-small font-semibold leading-5 hover:underline" onClick={() => onOpen(job)}>
        {job.title}
      </button>
      <p className="truncate type-small text-muted">
        {displayName(job.company)}
        {place ? ` · ${place}` : ""}
      </p>
      <p className="mt-2 flex items-center gap-1.5 type-meta text-muted">
        <Radar className="size-3.5 shrink-0" aria-hidden />
        <span className="truncate">Strong match · found {timeAgo(job.firstSeen, now)}</span>
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button size="sm" onClick={() => onReview?.(job, "saved")}>
          Save
        </Button>
        <Button size="sm" variant="ghost" onClick={() => onReview?.(job, "dismissed")}>
          Not interested
        </Button>
      </div>
    </li>
  );
}

/** A card dropped on (or moved to) Closed: how did it end? */
function CloseDialog({ target, onClose, onPick }: { target: { entry: Entry } | null; onClose: () => void; onPick: (how: ClosedAs) => void }) {
  return (
    <Dialog open={!!target} onClose={onClose} labelledBy="close-job-title">
      {target && (
        <Card className="grid gap-3 p-5 shadow-l3 sm:p-6">
          <div>
            <h2 id="close-job-title" className="type-subheading font-semibold">
              How did it end?
            </h2>
            <p className="truncate type-small text-muted">
              {target.entry.snapshot.title} · {displayName(target.entry.snapshot.company)}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {(Object.keys(CLOSED_AS) as ClosedAs[]).map((how) => (
              <Button key={how} size="sm" onClick={() => onPick(how)}>
                {CLOSED_AS[how]}
              </Button>
            ))}
            <Button size="sm" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
          </div>
        </Card>
      )}
    </Dialog>
  );
}

/**
 * Next steps: Overdue and Today shown, This week folded. Each row has its task's actions (shared
 * with the job's Activity tab). On phones the whole list folds to one line with the counts.
 */
function NextSteps({
  user,
  tasks,
  now,
  onOpen,
  onPatch,
  onLog,
  onCompare,
}: {
  user: UserState;
  tasks: Map<string, Task[]>;
  now: Date;
  onOpen: (id: string) => void;
  onPatch: (id: string, entry: Entry, patch: EntryPatch) => void;
  onLog: (t: Task) => void;
  onCompare?: () => void;
}) {
  const wide = useMedia("(min-width: 768px)");
  const groups = groupTasks(tasks, now);
  const row = (t: Task) => {
    const e = user[t.id];
    if (!e) return null;
    return (
      <li key={t.key} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2">
        <div className="min-w-0 flex-1 basis-56">
          <p className="type-small">
            <span className="font-semibold">{t.label}</span>
            <span className="text-muted"> · </span>
            <button type="button" className="text-left hover:underline" onClick={() => onOpen(t.id)}>
              {e.snapshot.title}
            </button>
          </p>
          <p className="truncate type-meta text-muted">
            {displayName(e.snapshot.company)} · {t.why}
          </p>
        </div>
        <TaskActions
          task={t}
          skipped={e.skipped ?? []}
          onLog={onLog}
          onMarkDone={(task) => onPatch(t.id, e, { skipped: [...(e.skipped ?? []), task.key] })}
          onUpdate={(patch) => onPatch(t.id, e, patch)}
          now={now}
          onOpen={(task) => (task.kind === "deadline" && onCompare ? onCompare() : onOpen(task.id))}
          deadlineLabel={onCompare ? "Compare offers" : "Open"}
          quiet
        />
      </li>
    );
  };
  const group = (title: string, list: Task[], tone?: string) =>
    list.length > 0 && (
      <div>
        <h3 className={cx("pt-2 type-meta font-semibold", tone ?? "text-muted")}>
          {title} <span className="tabular font-medium">{list.length}</span>
        </h3>
        <ul className="flex flex-col divide-y divide-line">{list.map(row)}</ul>
      </div>
    );
  const due = groups.overdue.length + groups.today.length;
  const counts = [groups.overdue.length && `${groups.overdue.length} overdue`, groups.today.length && `${groups.today.length} today`, groups.week.length && `${groups.week.length} this week`]
    .filter(Boolean)
    .join(" · ");
  const body = (
    <>
      {due === 0 && <p className="pt-1 type-small text-muted">Nothing due.</p>}
      {group("Overdue", groups.overdue, "text-danger-text")}
      {group("Today", groups.today, "text-warning-text")}
      {groups.week.length > 0 && (
        <details className="group/week">
          <summary className="flex cursor-pointer list-none items-center gap-1 pt-2 type-meta font-semibold text-muted">
            This week <span className="tabular font-medium">{groups.week.length}</span>
            <span className="font-normal group-open/week:hidden">· Show</span>
          </summary>
          <ul className="flex flex-col divide-y divide-line">{groups.week.map(row)}</ul>
        </details>
      )}
    </>
  );
  if (!wide) {
    return (
      <details aria-label="Next steps" className="group/steps mb-3 rounded-md border border-line bg-raised px-3 py-2 shadow-l1">
        <summary className="flex cursor-pointer list-none items-center gap-2 type-small">
          <span className="font-semibold">Next steps</span>
          <span className="truncate text-muted">{counts || "Nothing due."}</span>
          <ChevronDown className="ml-auto size-4 shrink-0 text-muted transition-transform group-open/steps:rotate-180" aria-hidden />
        </summary>
        {body}
      </details>
    );
  }
  return (
    <section aria-labelledby="next-steps-title" className="mb-3 rounded-md border border-line bg-raised px-3 py-2 shadow-l1">
      <h2 id="next-steps-title" className="type-small font-semibold">
        Next steps
      </h2>
      {body}
    </section>
  );
}

import { displayName } from "@rawjobs/core/display-name";
import { ArrowRight, BellRing, CalendarClock, ExternalLink, Plus, StickyNote } from "lucide-react";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import type { Job } from "../lib/data";
import type { WeeklyPlan } from "../lib/prefs";
import { timeAgo } from "../lib/format";
import {
  dayAfter,
  type Entry,
  type EntryPatch,
  FOLLOW_UP_DAYS,
  followUpDue,
  goneQuiet,
  PIPELINE,
  type PipelineStatus,
  STATUS_LABEL,
  type Status,
  stageSince,
  statusLabel,
  type UserState,
} from "../lib/userState";
import { EmptyState } from "./EmptyState";
import { PipelineInsights } from "./PipelineInsights";
import { AddJobDialog, CompareOffers, nextInterview, TrackedJobDialog } from "./TrackedJob";
import { Chip, ChipGroup, Kbd, ScoreBadge } from "./primitives";
import { Button, cx, Select } from "./ui";

type Props = {
  user: UserState;
  jobsById: Map<string, Job>;
  min: number;
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
};

export function Pipeline({ user, jobsById, min, onOpen, onPatch, onAdd, weeklyPlan, onWeeklyPlan, onSetup, goRadar }: Props) {
  /** A card for a job not on the Radar (added by hand, or no longer listed) opens here instead of the job drawer. */
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [comparing, setComparing] = useState(false);
  // Every job with offer terms written down, whatever its stage now (accepted, declined…).
  const offers = Object.entries(user)
    .filter(([, e]) => e.offer && e.status !== "dismissed")
    .map(([id, entry]) => ({ id, entry }));
  const addDialog = <AddJobDialog open={adding} onClose={() => setAdding(false)} onAdd={onAdd} />;
  const onMove = (id: string, entry: Entry, status: Status | undefined) => onPatch(id, entry, { status });
  const [dragOver, setDragOver] = useState<PipelineStatus | null>(null);
  /** Phones show one column at a time, picked from the status chips. */
  const [mobileCol, setMobileCol] = useState<PipelineStatus | null>(null);
  /** What the last keyboard move did, for screen readers (design/components/Pipeline: a polite live region). */
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
  const total = entries.length;

  if (total === 0) {
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

  const columns = PIPELINE.map((col) => ({
    col,
    items: entries.filter(([, e]) => e.status === col).sort((a, b) => stageSince(b[1]).localeCompare(stageSince(a[1]))),
  }));
  // Default to the first column with cards in it.
  const shown = mobileCol ?? columns.find((c) => c.items.length)?.col ?? PIPELINE[0];

  /** [ and ] move a card one column back or forward; focus stays on it and the move is announced. */
  const moveBy = (id: string, entry: Entry, d: -1 | 1) => {
    const at = PIPELINE.indexOf(entry.status as PipelineStatus);
    const to = PIPELINE[at + d];
    if (at < 0 || !to) return;
    refocus.current = id;
    // Phones show one column: follow the card into its new one.
    setMobileCol(to);
    setAnnounce(`Moved ${entry.snapshot.title} to ${STATUS_LABEL[to]}`);
    onMove(id, entry, to);
  };

  return (
    <div ref={boardRef} className="pb-2 md:overflow-x-auto">
      {addDialog}
      <TrackedJobDialog entry={editing ? user[editing] : undefined} onClose={() => setEditing(null)} onUpdate={(patch) => editing && user[editing] && onPatch(editing, user[editing], patch)} />
      {comparing && <CompareOffers offers={offers} onClose={() => setComparing(false)} />}
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
      <FollowUps user={user} jobsById={jobsById} onOpen={onOpen} onPatch={onPatch} />
      <p id="pipeline-move-help" className="sr-only">
        Press [ or ] to move this job to the previous or next stage.
      </p>
      <p className="sr-only" role="status" aria-live="polite">
        {announce}
      </p>
      <div className="-mx-4 mb-3 overflow-x-auto px-4 md:hidden [mask-image:linear-gradient(to_right,transparent,black_1rem,black_calc(100%-1.5rem),transparent)]">
        <ChipGroup label="Pipeline column" className="w-max pr-4">
          {columns.map(({ col, items }) => (
            <Chip key={col} pressed={shown === col} onClick={() => setMobileCol(col)} count={items.length} className="whitespace-nowrap">
              {STATUS_LABEL[col]}
            </Chip>
          ))}
        </ChipGroup>
      </div>
      <div className="grid gap-3 md:min-w-[900px] md:grid-cols-5">
        {columns.map(({ col, items }) => {
          return (
            // biome-ignore lint/a11y/noStaticElementInteractions: hover, focus or drop handling around real controls; nothing here is only reachable by mouse
            <section
              key={col}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(col);
              }}
              onDragLeave={() => setDragOver((c) => (c === col ? null : c))}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(null);
                const id = e.dataTransfer.getData("text/plain");
                const entry = user[id];
                if (entry && entry.status !== col) onMove(id, entry, col);
              }}
              className={cx(
                "min-h-64 flex-col rounded-md border bg-inset/50 p-2 transition-colors md:flex",
                shown === col ? "flex" : "hidden",
                dragOver === col ? "border-ink bg-active" : "border-line",
              )}
            >
              <h2 className="flex items-center justify-between px-1.5 py-1 type-small font-semibold">
                {STATUS_LABEL[col]} <span className="tabular type-meta font-medium text-muted">{items.length}</span>
              </h2>
              <ul className="mt-1 flex flex-col gap-2">
                {items.map(([id, e]) => {
                  const job = jobsById.get(id);
                  const s = e.snapshot;
                  const onKeys = (ev: KeyboardEvent) => {
                    if ((ev.key !== "[" && ev.key !== "]") || ev.metaKey || ev.ctrlKey || ev.altKey) return;
                    ev.preventDefault();
                    moveBy(id, e, ev.key === "[" ? -1 : 1);
                  };
                  return (
                    // biome-ignore lint/a11y/useKeyWithClickEvents: mouse shortcut: the card's title button is the keyboard and screen-reader way in
                    <li
                      key={id}
                      data-card-id={id}
                      draggable
                      onDragStart={(ev) => ev.dataTransfer.setData("text/plain", id)}
                      // Mouse shortcut: the whole card opens the job; the title button is the keyboard / screen-reader way in.
                      onClick={() => (job ? onOpen(job) : setEditing(id))}
                      className="cursor-pointer rounded-md border border-line bg-raised p-3 shadow-l1 transition-shadow hover:shadow-l2"
                    >
                      <div className="flex items-start justify-between gap-2">
                        {job ? (
                          <button
                            type="button"
                            data-card-title
                            aria-describedby="pipeline-move-help"
                            aria-keyshortcuts="[ ]"
                            className="text-left type-small font-semibold leading-5 hover:underline"
                            onClick={(ev) => {
                              ev.stopPropagation();
                              onOpen(job);
                            }}
                            onKeyDown={onKeys}
                          >
                            {s.title}
                          </button>
                        ) : s.url ? (
                          // No longer listed: the saved link still opens the posting (it may be gone at the company too).
                          <a
                            href={s.url}
                            target="_blank"
                            rel="noreferrer"
                            data-card-title
                            aria-describedby="pipeline-move-help"
                            aria-keyshortcuts="[ ]"
                            className="type-small font-semibold leading-5 hover:underline"
                            onClick={(ev) => ev.stopPropagation()}
                            onKeyDown={onKeys}
                          >
                            {s.title} <ExternalLink className="inline size-3 align-baseline text-muted" aria-label="(opens the posting)" />
                          </a>
                        ) : (
                          <p className="type-small font-semibold leading-5">{s.title}</p>
                        )}
                        {/* Added by hand: never scored. */}
                        {!id.startsWith("manual:") && <ScoreBadge score={job?.score ?? s.score} threshold={min} estimated={job?.estimated} className="shrink-0" />}
                      </div>
                      <p className="mt-0.5 type-small text-muted">{displayName(s.company)}</p>
                      {e.note && (
                        <p className="mt-2 line-clamp-2 flex gap-1 type-small text-muted">
                          <StickyNote className="mt-1 size-3.5 shrink-0" aria-hidden />
                          {e.note}
                        </p>
                      )}
                      {e.status === "rejected" && e.closedAs && e.closedAs !== "rejected" && <p className="mt-2 type-meta text-muted">{statusLabel(e)}</p>}
                      {nextInterview(e) && (
                        <p className="mt-2 flex items-center gap-1 type-meta font-medium text-ink">
                          <CalendarClock className="size-3.5" aria-hidden />
                          {nextInterview(e)?.what} {new Date(`${nextInterview(e)?.on}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                        </p>
                      )}
                      {e.followUp && (
                        <p className={cx("mt-2 type-meta", followUpDue(e) ? "font-medium text-warning-text" : "text-muted")}>
                          {followUpDue(e) ? "Follow up now" : `Follow up ${new Date(`${e.followUp}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`}
                        </p>
                      )}
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <span className="type-meta text-muted">
                          {job?.status === "closed" ? "Closed · " : id.startsWith("manual:") ? "Added by you · " : !job ? "No longer listed · " : ""}
                          {/* Time in this stage, not since the last note edit. */}
                          {timeAgo(stageSince(e))}
                        </span>
                        {/* Keyboard / touch alternative to dragging */}
                        <Select
                          aria-label={`Move ${s.title} to`}
                          value={e.status}
                          onClick={(ev) => ev.stopPropagation()}
                          onChange={(ev) => onMove(id, e, (ev.target.value || undefined) as Status | undefined)}
                          className="h-8 px-1.5 type-small"
                        >
                          {PIPELINE.map((p) => (
                            <option key={p} value={p}>
                              {STATUS_LABEL[p]}
                            </option>
                          ))}
                          <option value="">Remove</option>
                        </Select>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Applications waiting on you: follow-up date reached, or no reply for weeks (likely ghosted). One
 * click each: you followed up (next nudge in a week), or close it as No response.
 */
function FollowUps({ user, jobsById, onOpen, onPatch }: Pick<Props, "user" | "jobsById" | "onOpen" | "onPatch">) {
  const now = new Date();
  const due = Object.entries(user)
    .filter(([, e]) => followUpDue(e, now) || goneQuiet(e, now))
    .sort((a, b) => stageSince(a[1]).localeCompare(stageSince(b[1])));
  if (!due.length) return null;
  return (
    <section aria-labelledby="follow-ups-title" className="mb-3 rounded-md border border-line bg-raised p-3 shadow-l1">
      <h2 id="follow-ups-title" className="flex items-center gap-2 type-small font-semibold">
        <BellRing className="size-4 text-warning-text" aria-hidden /> Follow up <span className="tabular type-meta font-medium text-muted">{due.length}</span>
      </h2>
      <ul className="mt-1 flex flex-col divide-y divide-line">
        {due.map(([id, e]) => {
          const job = jobsById.get(id);
          const quiet = goneQuiet(e, now);
          return (
            <li key={id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2">
              <div className="min-w-0 flex-1">
                {job ? (
                  <button type="button" className="text-left type-small font-semibold hover:underline" onClick={() => onOpen(job)}>
                    {e.snapshot.title}
                  </button>
                ) : (
                  <p className="type-small font-semibold">{e.snapshot.title}</p>
                )}
                <p className="type-meta text-muted">
                  {displayName(e.snapshot.company)} · applied {timeAgo(stageSince(e))}
                  {quiet ? ", no reply yet" : ""}
                </p>
              </div>
              <Button size="sm" onClick={() => onPatch(id, e, { followUp: dayAfter(now.toISOString(), FOLLOW_UP_DAYS) })}>
                I followed up
              </Button>
              <Button size="sm" variant={quiet ? "primary" : "ghost"} onClick={() => onPatch(id, e, { status: "rejected", closedAs: "no-response" })}>
                Close: no response
              </Button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

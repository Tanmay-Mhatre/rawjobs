import { displayName } from "@rawjobs/core/display-name";
import { ArrowRight, StickyNote } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Job } from "../lib/data";
import { timeAgo } from "../lib/format";
import { PIPELINE, STATUS_LABEL, type Entry, type PipelineStatus, type Status, type UserState } from "../lib/userState";
import { EmptyState } from "./EmptyState";
import { Chip, ChipGroup, Kbd, ScoreBadge } from "./primitives";
import { Button, cx, Select } from "./ui";

type Props = {
  user: UserState;
  jobsById: Map<string, Job>;
  min: number;
  onOpen: (job: Job) => void;
  onMove: (id: string, entry: Entry, status: Status) => void;
  /** Radar not set up yet: the empty state points to setup instead of the Radar. */
  onSetup?: () => void;
  goRadar: () => void;
};

export function Pipeline({ user, jobsById, min, onOpen, onMove, onSetup, goRadar }: Props) {
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
            Save a job on the Radar (press <Kbd>S</Kbd>) and it shows up here. Drag cards between columns as you progress.
          </>
        )}
      </EmptyState>
    );
  }

  const columns = PIPELINE.map((col) => ({
    col,
    items: entries.filter(([, e]) => e.status === col).sort((a, b) => b[1].updatedAt.localeCompare(a[1].updatedAt)),
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
                  return (
                    // biome-ignore lint/a11y/useKeyWithClickEvents: mouse shortcut: the card's title button is the keyboard and screen-reader way in
                    <li
                      key={id}
                      data-card-id={id}
                      draggable
                      onDragStart={(ev) => ev.dataTransfer.setData("text/plain", id)}
                      // Mouse shortcut: the whole card opens the job; the title button is the keyboard / screen-reader way in.
                      onClick={() => job && onOpen(job)}
                      className={cx("rounded-md border border-line bg-raised p-3 shadow-l1 transition-shadow hover:shadow-l2", job ? "cursor-pointer" : "cursor-grab")}
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
                            onKeyDown={(ev) => {
                              if ((ev.key !== "[" && ev.key !== "]") || ev.metaKey || ev.ctrlKey || ev.altKey) return;
                              ev.preventDefault();
                              moveBy(id, e, ev.key === "[" ? -1 : 1);
                            }}
                          >
                            {s.title}
                          </button>
                        ) : (
                          <p className="type-small font-semibold leading-5">{s.title}</p>
                        )}
                        <ScoreBadge score={job?.score ?? s.score} threshold={min} estimated={job?.estimated} className="shrink-0" />
                      </div>
                      <p className="mt-0.5 type-small text-muted">{displayName(s.company)}</p>
                      {e.note && (
                        <p className="mt-2 line-clamp-2 flex gap-1 type-small text-muted">
                          <StickyNote className="mt-1 size-3.5 shrink-0" aria-hidden />
                          {e.note}
                        </p>
                      )}
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <span className="type-meta text-muted">
                          {job?.status === "closed" ? "Closed · " : !job ? "No longer listed · " : ""}
                          {timeAgo(e.updatedAt)}
                        </span>
                        {/* Keyboard / touch alternative to dragging */}
                        <Select
                          aria-label={`Move ${s.title} to`}
                          value={e.status}
                          onClick={(ev) => ev.stopPropagation()}
                          onChange={(ev) => onMove(id, e, ev.target.value as Status)}
                          className="h-8 px-1.5 type-small"
                        >
                          {PIPELINE.map((p) => (
                            <option key={p} value={p}>
                              {STATUS_LABEL[p]}
                            </option>
                          ))}
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

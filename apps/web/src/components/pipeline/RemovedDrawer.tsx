import { displayName } from "@rawjobs/core/display-name";
import { X } from "lucide-react";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { type Entry, type PipelineStatus, STATUS_LABEL } from "../../lib/userState";
import { Dialog } from "../Dialog";
import { Button } from "../primitives";
import { IconButton } from "../ui";

export type RemovedItem = { id: string; entry: Entry; stage: PipelineStatus; removedAt: string };

const shortDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });

/**
 * Jobs taken off the Pipeline, newest first: Put back returns one to its last stage, Delete removes
 * it and its history for good after an inline confirm in the same row (no second modal).
 */
export function RemovedDrawer({
  open,
  items,
  onClose,
  onPutBack,
  onDelete,
}: {
  open: boolean;
  items: RemovedItem[];
  onClose: () => void;
  onPutBack: (item: RemovedItem) => void;
  onDelete: (item: RemovedItem) => void;
}) {
  const [confirming, setConfirming] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  /** After a row goes or a confirm is cancelled, the button to focus: `<row id>:<action>`, or "close". */
  const refocus = useRef<string | null>(null);
  useEffect(() => {
    const target = refocus.current;
    if (!target) return;
    refocus.current = null;
    [...(rootRef.current?.querySelectorAll<HTMLElement>("[data-focus]") ?? [])].find((el) => el.dataset.focus === target)?.focus();
  });
  useEffect(() => {
    if (!open) setConfirming(null);
  }, [open]);

  /** Focus the next row's Put back (or the one before, or Close) once this row has gone. */
  const focusAfter = (id: string) => {
    const i = items.findIndex((x) => x.id === id);
    const next = items[i + 1] ?? items[i - 1];
    refocus.current = next ? `${next.id}:put-back` : "close";
  };
  const keep = (id: string) => {
    setConfirming(null);
    refocus.current = `${id}:delete`;
  };

  return (
    <Dialog open={open} onClose={onClose} labelledBy="removed-title" describedBy="removed-intro" placement="right">
      <div ref={rootRef} className="flex h-full w-full flex-col overflow-y-auto bg-overlay p-5 shadow-l3 min-[721px]:border-l min-[721px]:border-line sm:p-6">
        <div className="flex items-start gap-3">
          <h2 id="removed-title" className="min-w-0 flex-1 type-subheading">
            Removed from the Pipeline
          </h2>
          <IconButton data-focus="close" label="Close" className="-mr-2 -mt-1" onClick={onClose}>
            <X className="size-4" />
          </IconButton>
        </div>
        <p id="removed-intro" className="mt-1 type-small text-muted">
          Jobs you took off the board keep their history here. Put one back to pick up where you left off.
        </p>
        {items.length === 0 ? (
          <p className="mt-6 type-small text-muted">Nothing removed. Jobs you take off the board show up here.</p>
        ) : (
          <ul className="mt-4 flex flex-col gap-2">
            {items.map((item) => {
              const s = item.entry.snapshot;
              const asking = confirming === item.id;
              const onKeyDown = (e: KeyboardEvent) => {
                if (e.key !== "Escape") return;
                // Escape keeps the job and leaves the drawer open.
                e.preventDefault();
                e.stopPropagation();
                keep(item.id);
              };
              return (
                <li key={item.id} className="rounded-md border border-line bg-raised p-3">
                  {asking ? (
                    // Escape inside the confirm keeps the job; the buttons are the controls.
                    <fieldset aria-labelledby={`removed-confirm-${item.id}`} onKeyDown={onKeyDown} className="m-0 min-w-0 border-0 p-0">
                      <p id={`removed-confirm-${item.id}`} className="type-small font-medium">
                        Delete {s.title} and its history for good?
                      </p>
                      <div className="mt-2 flex flex-wrap justify-end gap-2">
                        <Button
                          size="sm"
                          variant="danger"
                          onClick={() => {
                            focusAfter(item.id);
                            setConfirming(null);
                            onDelete(item);
                          }}
                        >
                          Delete for good
                        </Button>
                        <Button size="sm" data-focus={`${item.id}:keep`} onClick={() => keep(item.id)}>
                          Keep it
                        </Button>
                      </div>
                    </fieldset>
                  ) : (
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                      {/* Grows beside the buttons; on a phone they wrap below it instead of squeezing the title. */}
                      <div className="min-w-0 grow basis-56">
                        <p className="type-small font-semibold">{s.title}</p>
                        <p className="truncate type-small text-muted">{displayName(s.company)}</p>
                        <p className="type-meta text-muted">
                          Was {STATUS_LABEL[item.stage]} · removed {shortDate(item.removedAt)}
                        </p>
                      </div>
                      <div className="flex shrink-0 gap-2">
                        <Button
                          size="sm"
                          data-focus={`${item.id}:put-back`}
                          aria-label={`Put back ${s.title}`}
                          onClick={() => {
                            focusAfter(item.id);
                            onPutBack(item);
                          }}
                        >
                          Put back
                        </Button>
                        <Button
                          size="sm"
                          variant="quiet"
                          data-focus={`${item.id}:delete`}
                          aria-label={`Delete ${s.title}`}
                          onClick={() => {
                            // The safe choice gets focus.
                            refocus.current = `${item.id}:keep`;
                            setConfirming(item.id);
                          }}
                        >
                          Delete
                        </Button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Dialog>
  );
}

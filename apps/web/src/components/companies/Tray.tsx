import { companyLabel } from "@rawjobs/core/display-name";
import { INDUSTRY_BY_ID } from "@rawjobs/core/catalog/industries";
import { Undo2, X } from "lucide-react";
import { useId, useRef, useState } from "react";
import { keyOf, type CompanyRef } from "../../lib/companies";
import type { CompanyRow } from "../../lib/setup";
import { emptyVisit, recordAdd, recordRemove, undoLast, visitCount, visitGroups, type Visit } from "../../lib/packVisit";
import { buttonClass } from "../primitives";
import { Button } from "../ui";

/** How the Starter packs add and remove, so each change lands in the tray (and Undo can walk it back). */
export type PackActions = {
  /** Add these. `text(n)` names the change once we know how many were new ("Added 8 from Payments"). */
  add: (refs: CompanyRef[], text: (n: number) => string, packOf: (ref: CompanyRef) => string | null) => void;
  remove: (keys: string[], text: (n: number) => string) => void;
};

export const packLabel = (id: string | null) => (id ? (INDUSTRY_BY_ID.get(id)?.label ?? id) : "Added one by one");

/**
 * This visit's adds and the polite status line that reads each change out. Session memory only: a
 * reload starts a new visit (what you added is in My companies either way).
 */
export function useVisit() {
  const [visit, setVisit] = useState<Visit>(emptyVisit);
  // The same words twice in a row still count as a change for screen readers: alternate a trailing space.
  const [said, setSaid] = useState({ text: "", n: 0 });
  const say = (text: string) => setSaid((s) => ({ text, n: s.n + 1 }));
  return { visit, setVisit, said: said.text + (said.n % 2 ? " " : ""), say };
}

/** Pack adds and removes go through the visit, so the tray can name and undo them. */
export function packActions(
  { visit, setVisit, say }: Pick<ReturnType<typeof useVisit>, "visit" | "setVisit" | "say">,
  {
    companies,
    addMany,
    removeMany,
    restore,
  }: {
    companies: readonly CompanyRow[];
    addMany: (list: CompanyRef[]) => string[];
    removeMany: (keys: readonly string[]) => void;
    /** Put removed entries back as they were. */
    restore: (rows: readonly CompanyRow[]) => void;
  },
): PackActions & { undo: () => void } {
  return {
    add(refs, text, packOf) {
      const keys = addMany(refs);
      if (!keys.length) return;
      const t = text(keys.length);
      setVisit(recordAdd(visit, refs, keys, t, packOf));
      say(`${t}.`);
    },
    remove(keys, text) {
      const drop = new Set(keys);
      const removed = companies.filter((r) => drop.has(keyOf(r)));
      if (!removed.length) return;
      removeMany(removed.map(keyOf));
      const t = text(removed.length);
      setVisit(recordRemove(visit, removed, t));
      say(`${t}.`);
    },
    undo() {
      const r = undoLast(visit);
      if (!r) return;
      if (r.change.added.length) removeMany(r.change.added);
      if (r.change.removed.length) restore(r.change.removed);
      setVisit(r.visit);
      say(`Undid: ${r.change.text}.`);
    },
  };
}

/**
 * The one tray at the bottom of the Companies page: "8 added this visit · Added 8 from Payments ·
 * Undo · Review". Undo walks back the last change, one company or a whole batch; Review lists this
 * visit's adds by pack, each with a remove and the pack with Undo pack.
 */
export function Tray({ visit, watched, actions }: { visit: Visit; watched: ReadonlySet<string>; actions: PackActions & { undo: () => void } }) {
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  const body = useRef<HTMLDivElement>(null);
  const review = useRef<HTMLButtonElement>(null);
  if (!visit.touched) return null;
  const n = visitCount(visit, watched);
  const groups = visitGroups(visit, watched);
  const canUndo = visit.hist.length > 0;
  /** A remove takes its button away: keep focus in the list (the next one), else on Review. */
  const keepFocus = (from: HTMLElement) => {
    const before = [...(body.current?.querySelectorAll("button") ?? [])].indexOf(from as HTMLButtonElement);
    requestAnimationFrame(() => {
      const after = [...(body.current?.querySelectorAll("button") ?? [])];
      (after[Math.min(before, after.length - 1)] ?? review.current)?.focus();
    });
  };
  return (
    <section aria-label="Added this visit" className="sticky bottom-18 z-20 rounded-md border border-line bg-overlay shadow-l3 md:bottom-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 py-2 pr-2 pl-4">
        <span className="type-label whitespace-nowrap">
          <b className="tabular font-semibold">{n}</b> added this visit
        </span>
        {visit.last && <span className="hidden min-w-0 flex-1 truncate type-small text-muted sm:block">{visit.last}</span>}
        <span className="ml-auto flex gap-2">
          <Button
            size="sm"
            aria-disabled={!canUndo}
            title={canUndo ? `Undo: ${visit.hist[visit.hist.length - 1]!.text}` : "Nothing to undo"}
            className="aria-disabled:opacity-50"
            onClick={() => canUndo && actions.undo()}
          >
            <Undo2 className="size-3.5" /> Undo
          </Button>
          <button ref={review} type="button" className={buttonClass("secondary", "sm")} aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen((o) => !o)}>
            {open ? "Hide list" : "Review"}
          </button>
        </span>
      </div>
      {open && (
        <div ref={body} id={bodyId} className="max-h-[min(18rem,40dvh)] overflow-y-auto border-t border-hairline px-4 pt-1 pb-3">
          {groups.length === 0 && <p className="py-2 type-small text-muted">Nothing added this visit.</p>}
          {groups.map((g) => (
            <div key={g.pack ?? "one"} className="grid gap-2 border-t border-hairline py-2 first:border-t-0">
              <div className="flex items-center justify-between gap-2 type-label">
                <span>
                  {packLabel(g.pack)} <span className="tabular font-normal text-muted">{g.refs.length}</span>
                </span>
                {g.pack && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={(e) => {
                      keepFocus(e.currentTarget);
                      actions.remove(g.refs.map(keyOf), (k) => `Removed ${k} from ${packLabel(g.pack)}`);
                    }}
                  >
                    <Undo2 className="size-3.5" /> Undo pack
                  </Button>
                )}
              </div>
              <ul className="flex flex-wrap gap-1.5">
                {g.refs.map((r) => (
                  <li key={keyOf(r)} className="inline-flex h-8 items-center gap-1 rounded-md border border-line bg-raised pr-1 pl-2.5 type-label">
                    {companyLabel(r)}
                    <button
                      type="button"
                      aria-label={`Remove ${companyLabel(r)}`}
                      title={`Remove ${companyLabel(r)}`}
                      className="inline-flex size-6 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-ink"
                      onClick={(e) => {
                        keepFocus(e.currentTarget);
                        actions.remove([keyOf(r)], () => `Removed ${companyLabel(r)}`);
                      }}
                    >
                      <X className="size-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

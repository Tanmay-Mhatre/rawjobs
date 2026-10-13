import { INDUSTRY_BY_ID } from "@rawjobs/core/catalog/industries";
import { Undo2 } from "lucide-react";
import { useState } from "react";
import { keyOf, type CompanyRef } from "../../lib/companies";
import type { CompanyRow } from "../../lib/setup";
import { emptyVisit, recordAdd, recordRemove, undoLast, type Visit } from "../../lib/packVisit";
import { Button, cx } from "../ui";

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
 * The bar at the bottom of the Companies page after a pack change: what just happened and Undo
 * ("Added 8 from Payments · Undo"). Undo walks back the last change, one company or a whole batch,
 * then the one before. The companies themselves are on the page, so the bar doesn't list them.
 */
export function Tray({ visit, actions }: { visit: Visit; actions: PackActions & { undo: () => void } }) {
  // Once something changed the bar stays, so it never disappears from under the Undo just pressed.
  if (!visit.touched) return null;
  const last = visit.hist.at(-1);
  return (
    <section aria-label="Last change" className="sticky bottom-18 z-20 rounded-md border border-line bg-overlay shadow-l3 md:bottom-4">
      <div className="flex items-center gap-4 py-2 pr-2 pl-4">
        <span className={cx("min-w-0 flex-1 truncate type-small", !last && "text-muted")}>{last ? last.text : "Nothing left to undo"}</span>
        <Button size="sm" aria-disabled={!last} title={last ? `Undo: ${last.text}` : "Nothing to undo"} className="aria-disabled:opacity-50" onClick={() => last && actions.undo()}>
          <Undo2 className="size-3.5" /> Undo
        </Button>
      </div>
    </section>
  );
}

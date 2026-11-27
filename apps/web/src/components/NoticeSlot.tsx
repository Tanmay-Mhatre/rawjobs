import { ChevronDown } from "lucide-react";
import { Fragment, useEffect, useId, useState } from "react";
import { isAlert, isLow, isUrgent, localDay, pickNotices, SHOWN_ON_KEY, type Notice } from "../app/notices";
import { load, save } from "../lib/storage";
import { cx } from "./ui";

/** An urgent notice was on this page since it loaded: the low ones wait for the next visit. */
let hadUrgent = false;
/** Tests: a new page load. */
export const resetNoticeSession = () => {
  hadUrgent = false;
};

/**
 * The one place for notices above the page: the most important shows, the others wait behind
 * "n more notices" (they open inline below it). One polite live region for all of them; a notice
 * that says the page can't load or save is also an alert. `paused` (a blocking window is up) shows
 * nothing but the notices' own dialogs.
 */
export function NoticeSlot({ notices, paused = false, className }: { notices: (Notice | null)[]; paused?: boolean; className?: string }) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [shownOn, setShownOn] = useState(() => load<string | null>(SHOWN_ON_KEY, null));
  if (!paused && notices.some((n) => n?.render && isUrgent(n))) hadUrgent = true;
  const today = localDay(Date.now());
  const { shown, more } = paused ? { shown: null, more: [] } : pickNotices(notices, { hadUrgent }, today, shownOn);
  // The low notice on show claims today.
  const low = [shown, ...more].find((n) => n && isLow(n));
  const claim = low ? `${today}|${low.id}` : null;
  useEffect(() => {
    if (claim && claim !== load<string | null>(SHOWN_ON_KEY, null)) {
      save(SHOWN_ON_KEY, claim);
      setShownOn(claim);
    }
  }, [claim]);

  const dialogs = notices.map((n) => n?.dialog && <Fragment key={n.id}>{n.dialog}</Fragment>);
  const row = (n: Notice) => (
    <div key={n.id} role={isAlert(n) ? "alert" : undefined}>
      {n.render?.()}
    </div>
  );
  return (
    <>
      <div role="status" className={cx(shown && "mb-4 grid gap-2 lg:mb-3 lg:shrink-0", className)}>
        {shown && row(shown)}
        {more.length > 0 && (
          <>
            <button
              type="button"
              aria-expanded={open}
              aria-controls={listId}
              className="inline-flex min-h-6 items-center gap-1 justify-self-end type-small font-medium text-muted underline underline-offset-2 hover:text-ink"
              onClick={() => setOpen((o) => !o)}
            >
              {open ? `Hide ${more.length} more` : more.length === 1 ? "1 more notice" : `${more.length} more notices`}
              <ChevronDown aria-hidden className={cx("size-3.5 transition-transform", open && "rotate-180")} />
            </button>
            <div id={listId} hidden={!open} className="grid gap-2 lg:max-h-[40dvh] lg:overflow-y-auto">
              {open && more.map(row)}
            </div>
          </>
        )}
      </div>
      {dialogs}
    </>
  );
}

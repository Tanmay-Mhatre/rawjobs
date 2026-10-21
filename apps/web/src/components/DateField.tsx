import { CalendarDays, ChevronLeft, ChevronRight, Clock } from "lucide-react";
import { type KeyboardEvent, type ReactNode, type RefObject, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { dayAfter, isDay } from "../lib/userState";
import { Chip } from "./primitives";
import { cx, IconButton } from "./ui";

const field = "inline-flex h-9 w-full min-w-0 items-center gap-2 rounded-md border border-line bg-raised px-2.5 text-left type-small text-ink hover:border-control aria-expanded:border-ink";
const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

const noon = (day: string) => new Date(`${day}T12:00:00`);
/** "Tue, Oct 28". */
export const fieldDay = (day: string) => noon(day).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
const monthOf = (day: string) => day.slice(0, 7);
const addMonths = (month: string, n: number) => {
  const d = new Date(`${month}-01T12:00:00`);
  d.setMonth(d.getMonth() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};
const localDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
/** The same day `n` months on, or that month's last day (Jan 31 + 1 is Feb 28). */
const shiftMonth = (day: string, n: number) => {
  const m = addMonths(monthOf(day), n);
  const last = new Date(Number(m.slice(0, 4)), Number(m.slice(5)), 0).getDate();
  return `${m}-${String(Math.min(Number(day.slice(8)), last)).padStart(2, "0")}`;
};

/** The 6 weeks shown for a month (YYYY-MM), Monday first. */
function weeksOf(month: string): string[] {
  const first = new Date(`${month}-01T12:00:00`);
  const start = localDay(new Date(first.getTime() - ((first.getDay() + 6) % 7) * 864e5));
  return Array.from({ length: 42 }, (_, i) => dayAfter(`${start}T12:00:00`, i));
}

/**
 * Where a popover opens: under its trigger, or above it when there's no room below. Fixed to the
 * window, so a scrolling panel or the dialog's edge never cuts it off.
 */
function usePopoverPlace(open: boolean, trigger: RefObject<HTMLElement | null>, pop: RefObject<HTMLElement | null>) {
  const [place, setPlace] = useState<{ top: number; left: number } | null>(null);
  useLayoutEffect(() => {
    if (!open) return setPlace(null);
    const update = () => {
      const t = trigger.current?.getBoundingClientRect();
      const p = pop.current?.getBoundingClientRect();
      if (!t || !p) return;
      const below = t.bottom + 4;
      const top = below + p.height <= innerHeight - 8 ? below : Math.max(8, t.top - 4 - p.height);
      const left = Math.min(Math.max(8, t.left), innerWidth - p.width - 8);
      setPlace({ top, left });
    };
    update();
    addEventListener("resize", update);
    // Capture: any scrolling panel moves the trigger.
    addEventListener("scroll", update, true);
    return () => {
      removeEventListener("resize", update);
      removeEventListener("scroll", update, true);
    };
  }, [open, trigger, pop]);
  return place;
}

/** Open, close on a press outside or Escape (focus back on the trigger), and place it. */
function usePopover() {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLElement | null>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const place = usePopoverPlace(open, triggerRef, popRef);
  const close = (refocus = true) => {
    setOpen(false);
    // The trigger is the date's button, or the time field's box with its input inside.
    const t = triggerRef.current;
    if (refocus) (t?.matches("button, input") ? t : t?.querySelector("input"))?.focus();
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-registered on each open; close only uses refs and setters
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!popRef.current?.contains(t) && !triggerRef.current?.contains(t)) close(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);
  const onPopKey = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    // Only the popover closes, not the dialog it's in.
    e.preventDefault();
    e.stopPropagation();
    close();
  };
  return { open, setOpen, close, triggerRef, popRef, place, onPopKey };
}

function Popover({ id, label, pop, children, className }: { id: string; label: string; pop: ReturnType<typeof usePopover>; children: ReactNode; className?: string }) {
  return (
    // A non-modal popover: a native <dialog> would trap focus inside the job's own dialog.
    <div
      id={id}
      ref={pop.popRef}
      role="dialog"
      aria-label={label}
      onKeyDown={pop.onPopKey}
      style={pop.place ? { top: pop.place.top, left: pop.place.left } : { top: 0, left: 0, visibility: "hidden" }}
      className={cx("rj-menu fixed z-menu", className)}
    >
      {children}
    </div>
  );
}

/**
 * A date (YYYY-MM-DD) picked from a calendar that opens from a press anywhere on the field, with
 * quick picks on top ("Tomorrow", "Next week"). Arrow keys move a day or a week, Page Up and Page
 * Down a month, Enter picks. `name` adds a hidden input, so it works inside a plain form.
 */
export function DateField({
  label,
  value,
  onChange,
  min,
  max,
  quick,
  clearable,
  placeholder = "Pick a date",
  name,
  id: givenId,
  className,
  autoOpen,
}: {
  /** The field's name, for the calendar's label ("Interview date"). */
  label: string;
  value: string;
  onChange: (day: string) => void;
  min?: string;
  max?: string;
  quick?: { label: string; value: string }[];
  /** Shows Clear, which sets "". */
  clearable?: boolean;
  placeholder?: string;
  name?: string;
  id?: string;
  className?: string;
  /** Opens as soon as it shows (a date asked for from a menu). */
  autoOpen?: boolean;
}) {
  const autoId = useId();
  const id = givenId ?? autoId;
  const pop = usePopover();
  const anchor = isDay(value) ? value : max && localDay(new Date()) > max ? max : min && localDay(new Date()) < min ? min : localDay(new Date());
  const [focus, setFocus] = useState(anchor);
  const [month, setMonth] = useState(monthOf(anchor));
  const dayRefs = useRef(new Map<string, HTMLButtonElement>());
  const allowed = (d: string) => (!min || d >= min) && (!max || d <= max);

  const openPicker = () => {
    setFocus(anchor);
    setMonth(monthOf(anchor));
    pop.setOpen(true);
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: once, when shown from a menu
  useEffect(() => {
    if (autoOpen) openPicker();
  }, []);
  // The focused day follows the keyboard, also into the next month.
  useEffect(() => {
    if (pop.open && pop.place) dayRefs.current.get(focus)?.focus();
  }, [pop.open, pop.place, focus]);

  const pick = (d: string) => {
    if (!allowed(d)) return;
    onChange(d);
    pop.close();
  };
  const moveTo = (d: string) => {
    setFocus(d);
    if (monthOf(d) !== month) setMonth(monthOf(d));
  };
  const onDayKey = (e: KeyboardEvent, d: string) => {
    const at = `${d}T12:00:00`;
    const dow = (noon(d).getDay() + 6) % 7;
    const step: Record<string, () => string> = {
      ArrowLeft: () => dayAfter(at, -1),
      ArrowRight: () => dayAfter(at, 1),
      ArrowUp: () => dayAfter(at, -7),
      ArrowDown: () => dayAfter(at, 7),
      Home: () => dayAfter(at, -dow),
      End: () => dayAfter(at, 6 - dow),
      PageUp: () => shiftMonth(d, -1),
      PageDown: () => shiftMonth(d, 1),
    };
    const next = step[e.key]?.();
    if (!next) return;
    e.preventDefault();
    moveTo(next);
  };

  const today = localDay(new Date());
  const days = weeksOf(month);
  const title = noon(`${month}-01`).toLocaleDateString(undefined, { month: "long", year: "numeric" });
  return (
    <>
      <button
        ref={(el) => {
          pop.triggerRef.current = el;
        }}
        id={id}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={pop.open}
        aria-controls={pop.open ? `${id}-pop` : undefined}
        onClick={() => (pop.open ? pop.close() : openPicker())}
        className={cx(field, className)}
      >
        <CalendarDays className="size-3.5 shrink-0 text-muted" aria-hidden />
        <span className={cx("min-w-0 flex-1 truncate", !isDay(value) && "text-muted")}>{isDay(value) ? fieldDay(value) : placeholder}</span>
      </button>
      {name && <input type="hidden" name={name} value={value} />}
      {pop.open && (
        <Popover id={`${id}-pop`} label={label} pop={pop} className="grid w-72 gap-3 p-3">
          {quick && quick.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {quick.map((q) => (
                <Chip key={q.label} pressed={q.value === value} disabled={!allowed(q.value)} onClick={() => pick(q.value)}>
                  {q.label}
                </Chip>
              ))}
            </div>
          )}
          <div className="flex items-center justify-between">
            <IconButton label="Previous month" className="size-8" onClick={() => setMonth(addMonths(month, -1))}>
              <ChevronLeft className="size-4" />
            </IconButton>
            <span className="type-label" aria-live="polite">
              {title}
            </span>
            <IconButton label="Next month" className="size-8" onClick={() => setMonth(addMonths(month, 1))}>
              <ChevronRight className="size-4" />
            </IconButton>
          </div>
          {/* Each day is a button named with its full date; one of them is in the tab order (roving focus). */}
          <div className="grid grid-cols-7 gap-0.5 text-center">
            {WEEKDAYS.map((w) => (
              <span key={w} aria-hidden className="py-1 type-meta text-muted">
                {w}
              </span>
            ))}
            {days.map((d) => {
              const inMonth = monthOf(d) === month;
              const selected = d === value;
              const ok = allowed(d);
              return (
                <button
                  key={d}
                  ref={(el) => {
                    if (el) dayRefs.current.set(d, el);
                    else dayRefs.current.delete(d);
                  }}
                  type="button"
                  aria-pressed={selected}
                  aria-label={fieldDay(d)}
                  aria-current={d === today ? "date" : undefined}
                  aria-disabled={!ok || undefined}
                  tabIndex={d === focus ? 0 : -1}
                  onClick={() => pick(d)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      pick(d);
                    } else onDayKey(e, d);
                  }}
                  className={cx(
                    "h-8 rounded-sm tabular type-small transition-colors",
                    selected ? "bg-ink font-semibold text-canvas" : ok ? "hover:bg-hover" : "cursor-default",
                    !selected && (!inMonth || !ok) && "text-muted",
                    !ok && "opacity-40",
                    d === today && !selected && "ring-1 ring-control ring-inset",
                  )}
                >
                  {Number(d.slice(8))}
                </button>
              );
            })}
          </div>
          {clearable && isDay(value) && (
            <button
              type="button"
              className="justify-self-start type-small text-muted underline hover:text-ink"
              onClick={() => {
                onChange("");
                pop.close();
              }}
            >
              Clear date
            </button>
          )}
        </Popover>
      )}
    </>
  );
}

/** Every 15 minutes from 07:00 to 21:45: the times offered first. */
const TIMES = Array.from({ length: 60 }, (_, i) => {
  const m = 7 * 60 + i * 15;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
});
/** "14:30", "2:30 pm", "1430", "9" as HH:MM; undefined when it isn't a time. */
export function parseTime(raw: string): string | undefined {
  const m = raw
    .trim()
    .toLowerCase()
    .match(/^(\d{1,2})(?::?(\d{2}))?\s*(am|pm)?$/);
  if (!m) return undefined;
  let h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  if (m[3] === "pm" && h < 12) h += 12;
  if (m[3] === "am" && h === 12) h = 0;
  return h < 24 && min < 60 ? `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}` : undefined;
}
/** "2:30 PM" in the reader's own clock. */
export const fieldTime = (hhmm: string) => new Date(`2000-01-01T${hhmm}:00`).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

/**
 * A time (HH:MM): type it ("2:30 pm", "14:30") or pick one from the list that opens on a press
 * anywhere on the field (every 15 minutes, 07:00 to 21:45). Empty means no time.
 */
export function TimeField({
  label,
  value,
  onChange,
  name,
  id: givenId,
  className,
}: {
  label: string;
  value: string;
  onChange: (time: string) => void;
  name?: string;
  id?: string;
  className?: string;
}) {
  const autoId = useId();
  const id = givenId ?? autoId;
  const pop = usePopover();
  const [text, setText] = useState(value ? fieldTime(value) : "");
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => setText(value ? fieldTime(value) : ""), [value]);
  // Scroll the list to the chosen time, or to 09:00.
  useEffect(() => {
    if (!pop.open || !pop.place) return;
    const at = listRef.current?.querySelector<HTMLElement>(`[data-time="${value || "09:00"}"]`);
    at?.scrollIntoView({ block: "center" });
  }, [pop.open, pop.place, value]);
  const commit = () => {
    if (!text.trim()) return onChange("");
    const t = parseTime(text);
    if (t) onChange(t);
    else setText(value ? fieldTime(value) : "");
  };
  return (
    <>
      <div
        // The whole box anchors the list, so it lines up with the field.
        ref={(el) => {
          pop.triggerRef.current = el;
        }}
        className={cx(field, "pr-1", pop.open && "border-ink", className)}
      >
        <Clock className="size-3.5 shrink-0 text-muted" aria-hidden />
        <input
          id={id}
          value={text}
          placeholder="Add a time"
          autoComplete="off"
          onChange={(e) => setText(e.target.value)}
          onFocus={() => pop.setOpen(true)}
          onClick={() => pop.setOpen(true)}
          onBlur={(e) => {
            // Leaving for the list keeps it open; anywhere else commits what was typed.
            if (!pop.popRef.current?.contains(e.relatedTarget as Node)) {
              commit();
              pop.setOpen(false);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
              pop.setOpen(false);
            } else if (e.key === "ArrowDown") {
              e.preventDefault();
              listRef.current?.querySelector<HTMLElement>("[aria-selected=true], button")?.focus();
            } else if (e.key === "Escape" && pop.open) {
              e.preventDefault();
              e.stopPropagation();
              pop.setOpen(false);
            }
          }}
          aria-label={label}
          className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted"
        />
      </div>
      {name && <input type="hidden" name={name} value={value} />}
      {pop.open && (
        <Popover id={`${id}-pop`} label={label} pop={pop} className="w-44 p-1">
          <div ref={listRef} role="listbox" aria-label={label} className="grid max-h-56 overflow-y-auto">
            {TIMES.map((t) => (
              <button
                key={t}
                type="button"
                role="option"
                data-time={t}
                aria-selected={t === value}
                className={cx("rj-menu__item tabular", t === value && "bg-active")}
                onClick={() => {
                  onChange(t);
                  pop.setOpen(false);
                }}
                onKeyDown={(e) => {
                  const sib = e.key === "ArrowDown" ? e.currentTarget.nextElementSibling : e.key === "ArrowUp" ? e.currentTarget.previousElementSibling : null;
                  if (sib) {
                    e.preventDefault();
                    (sib as HTMLElement).focus();
                  }
                }}
              >
                {fieldTime(t)}
              </button>
            ))}
          </div>
        </Popover>
      )}
    </>
  );
}

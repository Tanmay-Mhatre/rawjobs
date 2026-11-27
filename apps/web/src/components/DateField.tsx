import { CalendarDays, ChevronLeft, ChevronRight, Clock } from "lucide-react";
import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { dayAfter, isDay } from "../lib/userState";
import { Chip, Popover, usePopover } from "./primitives";
import { cx, IconButton } from "./ui";

const field = "inline-flex h-9 w-full min-w-0 items-center gap-2 rounded-md border border-control bg-raised px-2.5 text-left type-small text-ink hover:border-control-hover aria-expanded:border-ink";
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
    if (pop.open) dayRefs.current.get(focus)?.focus();
  }, [pop.open, focus]);

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
        <Popover {...pop.props} id={`${id}-pop`} role="dialog" aria-label={label} className="grid w-72 gap-3 p-3">
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
                    !ok && "opacity-40", // design-lint-ignore: muted state, reviewed in 6B
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

/** The id of the list's option at index `i`. */
const optionId = (id: string, i: number) => `${id}-opt-${i}`;

/**
 * A time (HH:MM): type it ("2:30 pm", "14:30") or pick one from the list (every 15 minutes, 07:00 to
 * 21:45). Empty means no time. An ARIA editable combobox with a list: focus stays in the input; Down
 * and Up open the list and move through it, Alt+Down only opens it, Enter takes the highlighted time
 * (or what was typed), Escape closes the list, and Tab or leaving the field keeps what was typed.
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
  const listId = `${id}-list`;
  const pop = usePopover();
  const [text, setText] = useState(value ? fieldTime(value) : "");
  // The highlighted option (aria-activedescendant); null until the arrow keys, a hover or typing pick one.
  const [active, setActive] = useState<number | null>(null);
  useEffect(() => setText(value ? fieldTime(value) : ""), [value]);
  useEffect(() => {
    if (!pop.open) setActive(null);
  }, [pop.open]);
  // Keep the highlighted time in view; on opening, show the chosen time, or 09:00, in the middle.
  useEffect(() => {
    const list = pop.popRef.current;
    if (!pop.open || !list) return;
    const at = (active === null ? list.querySelector(`[data-time="${value || "09:00"}"]`) : list.children[active]) as HTMLElement | null;
    if (!at) return;
    if (active === null) list.scrollTop = at.offsetTop - (list.clientHeight - at.offsetHeight) / 2;
    else if (at.offsetTop < list.scrollTop) list.scrollTop = at.offsetTop;
    else if (at.offsetTop + at.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = at.offsetTop + at.offsetHeight - list.clientHeight;
  }, [pop.open, active, value, pop.popRef]);
  const commit = () => {
    if (!text.trim()) return onChange("");
    const t = parseTime(text);
    if (t) onChange(t);
    else setText(value ? fieldTime(value) : "");
  };
  const take = (t: string) => {
    onChange(t);
    setText(fieldTime(t));
    pop.setOpen(false);
  };
  /** Where the arrow keys start: the chosen time, else 09:00. */
  const start = () => {
    const i = TIMES.indexOf(value);
    return i >= 0 ? i : TIMES.indexOf("09:00");
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      pop.setOpen(true);
      if (e.altKey) return;
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((a) => (a === null ? start() : Math.min(Math.max(a + step, 0), TIMES.length - 1)));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (pop.open && active !== null) take(TIMES[active]!);
      else {
        commit();
        pop.setOpen(false);
      }
    }
    // Escape is the popover's: it closes the list and stops there. With the list closed, it reaches the dialog.
  };
  return (
    <>
      <div
        // The whole box anchors the list, so it lines up with the field; the ring shows while the input has focus.
        ref={(el) => {
          pop.triggerRef.current = el;
        }}
        className={cx(field, "pr-1 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[var(--focus-ring)]", pop.open && "border-ink", className)}
      >
        <Clock className="size-3.5 shrink-0 text-muted" aria-hidden />
        <input
          id={id}
          role="combobox"
          aria-label={label}
          aria-expanded={pop.open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={pop.open && active !== null ? optionId(id, active) : undefined}
          value={text}
          placeholder="Add a time"
          autoComplete="off"
          onChange={(e) => {
            setText(e.target.value);
            pop.setOpen(true);
            // A typed time that's in the list is highlighted; Enter still keeps what was typed when it isn't.
            const t = parseTime(e.target.value);
            const i = t ? TIMES.indexOf(t) : -1;
            setActive(i >= 0 ? i : null);
          }}
          onFocus={() => pop.setOpen(true)}
          onClick={() => pop.setOpen(true)}
          onBlur={() => {
            // Options keep focus here (mousedown is cancelled), so a blur is leaving the field: keep what was typed.
            commit();
            pop.setOpen(false);
          }}
          onKeyDown={onKey}
          className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted"
        />
      </div>
      {name && <input type="hidden" name={name} value={value} />}
      {pop.open && (
        <Popover {...pop.props} id={listId} role="listbox" aria-label={label} onMouseDown={(e) => e.preventDefault()} className="grid max-h-56 w-44 overflow-y-auto p-1">
          {/* A press on the list (an option, its scrollbar) keeps focus in the input. */}
          {TIMES.map((t, i) => (
            // biome-ignore lint/a11y/useFocusableInteractive: ARIA combobox option: reached with aria-activedescendant, so not focusable itself
            // biome-ignore lint/a11y/useKeyWithClickEvents: the keys are on the input (Enter takes the highlighted option)
            <li
              key={t}
              id={optionId(id, i)}
              // biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: ARIA combobox: focus stays in the input and options are reached with aria-activedescendant
              role="option"
              data-time={t}
              aria-selected={t === value}
              onMouseEnter={() => setActive(i)}
              onClick={() => take(t)}
              className={cx("rj-menu__item cursor-pointer tabular", t === value && "font-semibold", i === active && "bg-active")}
            >
              {fieldTime(t)}
            </li>
          ))}
        </Popover>
      )}
    </>
  );
}

import { X } from "lucide-react";
import { useEffect, useLayoutEffect, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from "react";
import { Button, cx } from "./ui";

/**
 * App-wide toasts (design/components/Toast): the past-tense verb plus the object ("Saved Head of
 * Product, Exchange"), with an optional Undo. Call `toast({...})` from anywhere. One at a time: a new
 * toast replaces the last. Each stays 5 seconds (8 with an action), paused while hovered or focused so
 * keyboard and screen-reader users can reach Undo (WCAG 2.2.1), and Esc dismisses it.
 * Never for an error that needs action: that stays inline, next to what failed.
 *
 * Where they show: a modal <dialog> makes everything outside it inert (HTML §6.3.1), so a toast on the
 * page can't be clicked or announced while one is open. Each open Dialog renders a <ToastHost /> as its
 * last child and the page renders the root one (<Toaster />); only the most recently opened host shows
 * the messages. Timing lives here in the store, so a toast that moves host (its dialog closed) keeps
 * the time it had left.
 *
 * Pinned items (`pin(id, …)`) sit above the toast in the same column and never time out: a question
 * that waits for an answer, like "Did you apply?".
 */
export type ToastAction = { label: string; onClick: () => void; primary?: boolean };

export type ToastInput = {
  message: ReactNode;
  /** e.g. "Undo". Shorthand for one entry in `actions`. */
  actionLabel?: string;
  onAction?: () => void;
  /** Buttons after the message; each one also dismisses the toast. */
  actions?: ToastAction[];
  /** ms; default 5000, or 8000 when the toast has an action. */
  duration?: number;
  /**
   * "popover": a light L2 surface (the menu's) instead of the inverted toast, for a toast that holds
   * chips, like the Not interested reasons. Same timing, pausing, Esc and live region.
   */
  surface?: "popover";
};
type ToastItem = ToastInput & {
  id: number;
  closing?: boolean;
  /** When it closes (ms since the epoch), while it runs. */
  deadline: number;
  /** Time it had left when hover or focus paused it. */
  pausedLeft?: number;
};

/** A question that stays until answered or withdrawn. Its buttons don't dismiss it: the owner does, with `pin(id, null)`. */
export type PinInput = {
  message: ReactNode;
  icon?: ReactNode;
  actions?: ToastAction[];
};
type PinItem = PinInput & { id: string };

export const DEFAULT_MS = 5000;
export const ACTION_MS = 8000;
/** Back from hover or focus: leave time to read whatever changed meanwhile. */
const RESUME_MIN_MS = 3000;

let items: ToastItem[] = [];
let pins: PinItem[] = [];
let nextId = 1;
const timers = new Map<number, ReturnType<typeof setTimeout>>();
const listeners = new Set<() => void>();
const emit = () => {
  for (const l of listeners) l();
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};
const snapshot = () => items;
const pinSnapshot = () => pins;

const actionsOf = (t: ToastInput): ToastAction[] => [...(t.actionLabel && t.onAction ? [{ label: t.actionLabel, onClick: t.onAction }] : []), ...(t.actions ?? [])];

function update(id: number, patch: Partial<ToastItem>) {
  items = items.map((t) => (t.id === id ? { ...t, ...patch } : t));
  emit();
}

function schedule(id: number, ms: number) {
  clearTimeout(timers.get(id));
  timers.set(
    id,
    setTimeout(() => dismissToast(id), ms),
  );
}

export function toast(t: ToastInput): number {
  const id = nextId++;
  for (const old of items) clearTimeout(timers.get(old.id));
  timers.clear();
  const ms = t.duration ?? (actionsOf(t).length ? ACTION_MS : DEFAULT_MS);
  items = [{ ...t, id, deadline: Date.now() + ms }];
  schedule(id, ms);
  emit();
  return id;
}

/** Plays the exit animation, then removes it. */
export function dismissToast(id: number) {
  const t = items.find((x) => x.id === id);
  if (!t || t.closing) return;
  clearTimeout(timers.get(id));
  // Removed on animationend; this covers a browser that skips the animation, or a host that went away.
  timers.set(
    id,
    setTimeout(() => removeToast(id), 250),
  );
  update(id, { closing: true });
}

function removeToast(id: number) {
  clearTimeout(timers.get(id));
  timers.delete(id);
  if (!items.some((t) => t.id === id)) return;
  items = items.filter((t) => t.id !== id);
  emit();
}

function pauseToast(id: number) {
  const t = items.find((x) => x.id === id);
  if (!t || t.closing || t.pausedLeft !== undefined) return;
  clearTimeout(timers.get(id));
  update(id, { pausedLeft: Math.max(0, t.deadline - Date.now()) });
}

function resumeToast(id: number) {
  const t = items.find((x) => x.id === id);
  if (!t || t.closing || t.pausedLeft === undefined) return;
  const ms = Math.max(t.pausedLeft, RESUME_MIN_MS);
  schedule(id, ms);
  update(id, { pausedLeft: undefined, deadline: Date.now() + ms });
}

/** Show (or replace) the pinned item `id`, or remove it with `null`. At most one per id, shown in pin order. */
export function pin(id: string, input: PinInput | null) {
  const at = pins.findIndex((p) => p.id === id);
  if (!input) {
    if (at < 0) return;
    pins = pins.filter((p) => p.id !== id);
  } else if (at < 0) pins = [...pins, { ...input, id }];
  else pins = pins.map((p) => (p.id === id ? { ...input, id } : p));
  emit();
}

// ---------- hosts ----------

/** Open hosts, oldest first; the root (page) host is always first. The last one shows the messages. */
let hosts: symbol[] = [];

function useHostToken(root: boolean) {
  const [me] = useState(() => Symbol(root ? "root toast host" : "dialog toast host"));
  // Layout effect, so the host is in place before the dialog's own effect calls showModal().
  useLayoutEffect(() => {
    hosts = root ? [me, ...hosts] : [...hosts, me];
    emit();
    return () => {
      hosts = hosts.filter((h) => h !== me);
      emit();
    };
  }, [me, root]);
  return me;
}

/**
 * Where toasts and pinned items render. The page has one root host (`<Toaster />`); every Dialog
 * renders one as its last child, so the messages are inside the modal (clickable, announced, and on
 * the dialog's Tab order). An inactive host keeps an empty live region, so it's ready when it's on top again.
 */
export function ToastHost({ root = false }: { root?: boolean }) {
  const me = useHostToken(root);
  const active = useSyncExternalStore(subscribe, () => hosts.at(-1) === me);
  const list = useSyncExternalStore(subscribe, snapshot);
  const pinned = useSyncExternalStore(subscribe, pinSnapshot);
  return (
    // The live region is always there, so each new message is announced.
    <div className="rj-toast-region pointer-events-none fixed inset-x-0 z-toast flex flex-col items-center gap-2 px-4" role="status" aria-live="polite">
      {active && pinned.map((p) => <PinRow key={p.id} item={p} />)}
      {active && list.map((t) => <ToastRow key={t.id} item={t} />)}
    </div>
  );
}

/** The page's host; mounted once in App. */
export function Toaster() {
  return <ToastHost root />;
}

function PinRow({ item }: { item: PinItem }) {
  return (
    <div className="pointer-events-auto flex w-full max-w-xl flex-wrap items-center gap-3 rounded-md border border-line bg-raised p-3 pl-4 shadow-l3">
      {item.icon}
      {/* Its own line on phones, so the buttons wrap below it instead of squeezing it. */}
      <p className="min-w-0 grow basis-60 type-small">{item.message}</p>
      {!!item.actions?.length && (
        <div className="flex gap-2">
          {item.actions.map((a) => (
            <Button key={a.label} size="sm" variant={a.primary ? "primary" : "ghost"} onClick={a.onClick}>
              {a.label}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

function ToastRow({ item }: { item: ToastItem }) {
  const [paused, setPaused] = useState(false);
  // In the store, so the time left survives this row moving to another host; leaving (unmount) resumes.
  useEffect(() => {
    if (!paused) return;
    pauseToast(item.id);
    return () => resumeToast(item.id);
  }, [paused, item.id]);

  const actions = actionsOf(item);
  const stacked = actions.length > 1;
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: hover, focus or drop handling around real controls; nothing here is only reachable by mouse
    <div
      className={item.surface === "popover" ? "rj-menu pointer-events-auto flex w-full max-w-md items-start gap-2 p-3 type-small text-ink" : cx("rj-toast pointer-events-auto", stacked && "flex-wrap")}
      data-state={item.closing ? "closing" : undefined}
      onAnimationEnd={() => item.closing && removeToast(item.id)}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      onKeyDown={(e: KeyboardEvent) => {
        if (e.key !== "Escape") return;
        // Esc closes the toast only: not the dialog it's in, nor anything listening on the page.
        e.preventDefault();
        e.stopPropagation();
        dismissToast(item.id);
      }}
    >
      <div className="min-w-0 flex-1">{item.message}</div>
      {/* Two or more actions go on their own row under the message, so it isn't squeezed on phones. */}
      <div className={stacked ? "order-last -ml-2 flex basis-full gap-1" : "contents"}>
        {actions.map((a) => (
          <button
            key={a.label}
            type="button"
            className="rj-btn rj-btn--quiet rj-btn--sm"
            onClick={() => {
              a.onClick();
              dismissToast(item.id);
            }}
          >
            {a.label}
          </button>
        ))}
      </div>
      <button type="button" aria-label="Dismiss" title="Dismiss (Esc)" className="rj-btn rj-btn--quiet rj-btn--icon rj-btn--sm" onClick={() => dismissToast(item.id)}>
        <X className="rj-icon" aria-hidden />
      </button>
    </div>
  );
}

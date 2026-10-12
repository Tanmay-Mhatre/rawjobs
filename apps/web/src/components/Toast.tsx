import { X } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from "react";

/**
 * App-wide toasts (design/components/Toast): the past-tense verb plus the object ("Saved Head of
 * Product, Exchange"), with an optional Undo. Call `toast({...})` from anywhere; <Toaster /> is mounted
 * once in App. One at a time: a new toast replaces the last. Each stays 5 seconds, paused while hovered
 * or focused so keyboard and screen-reader users can reach Undo (WCAG 2.2.1), and Esc dismisses it.
 * Never for an error that needs action: that stays inline, next to what failed.
 */
export type ToastInput = {
  message: ReactNode;
  /** e.g. "Undo". */
  actionLabel?: string;
  onAction?: () => void;
  /** ms; default 5000. */
  duration?: number;
  /**
   * "popover": a light L2 surface (the menu's) instead of the inverted toast, for a toast that holds
   * chips, like the Not interested reasons. Same timing, pausing, Esc and live region.
   */
  surface?: "popover";
};
type ToastItem = ToastInput & { id: number; closing?: boolean };

let items: ToastItem[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => {
  for (const l of listeners) l();
};

export function toast(t: ToastInput): number {
  const id = nextId++;
  items = [{ ...t, id }];
  emit();
  return id;
}

/** Plays the exit animation, then removes it. */
export function dismissToast(id: number) {
  items = items.map((t) => (t.id === id ? { ...t, closing: true } : t));
  emit();
}

function removeToast(id: number) {
  items = items.filter((t) => t.id !== id);
  emit();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};
const snapshot = () => items;

export function Toaster() {
  const list = useSyncExternalStore(subscribe, snapshot);
  return (
    // The live region is always there, so each new message is announced.
    <div className="pointer-events-none fixed inset-x-0 bottom-20 z-toast flex flex-col items-center gap-2 px-4 md:bottom-6" role="status" aria-live="polite">
      {list.map((t) => (
        <ToastRow key={t.id} item={t} />
      ))}
    </div>
  );
}

function ToastRow({ item }: { item: ToastItem }) {
  const [paused, setPaused] = useState(false);
  const left = useRef(item.duration ?? 5000);
  const wasPaused = useRef(false);
  useEffect(() => {
    if (paused) wasPaused.current = true;
    if (paused || item.closing) return;
    // Back from hover or focus: leave time to read whatever changed meanwhile.
    if (wasPaused.current) left.current = Math.max(left.current, 3000);
    const started = Date.now();
    const timer = setTimeout(() => dismissToast(item.id), left.current);
    return () => {
      clearTimeout(timer);
      left.current -= Date.now() - started;
    };
  }, [paused, item.id, item.closing]);

  // Removed on animationend; the timer covers a browser that skips the animation.
  useEffect(() => {
    if (!item.closing) return;
    const t = setTimeout(() => removeToast(item.id), 250);
    return () => clearTimeout(t);
  }, [item.closing, item.id]);

  return (
    <div
      className={item.surface === "popover" ? "rj-menu pointer-events-auto flex w-full max-w-md items-start gap-2 p-3 type-small text-ink" : "rj-toast pointer-events-auto"}
      data-state={item.closing ? "closing" : undefined}
      onAnimationEnd={() => item.closing && removeToast(item.id)}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      onKeyDown={(e: KeyboardEvent) => e.key === "Escape" && dismissToast(item.id)}
    >
      <div className="min-w-0 flex-1">{item.message}</div>
      {item.actionLabel && item.onAction && (
        <button
          type="button"
          className="rj-btn rj-btn--quiet rj-btn--sm"
          onClick={() => {
            item.onAction!();
            dismissToast(item.id);
          }}
        >
          {item.actionLabel}
        </button>
      )}
      <button type="button" aria-label="Dismiss" title="Dismiss (Esc)" className="rj-btn rj-btn--quiet rj-btn--icon rj-btn--sm" onClick={() => dismissToast(item.id)}>
        <X className="rj-icon" aria-hidden />
      </button>
    </div>
  );
}

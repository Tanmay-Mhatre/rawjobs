import { type HTMLAttributes, type ReactNode, type RefObject, useEffect, useLayoutEffect, useRef, useState } from "react";
import { cx } from "../../lib/cx";

/** Space kept between a popover and the window's edge. */
const EDGE = 8;

export type PopoverAlign = "start" | "end";
export type PopoverPlace = { top: number; left: number; width?: number };

/**
 * Where a popover opens: under its anchor, or above it when there's no room below. Its start edge
 * lines up with the anchor's (`align: "end"`: its end edge), kept inside the window. Position fixed,
 * so a scrolling panel or a dialog's edge never cuts it off. It's measured against the popover's own
 * containing block, so an ancestor with a transform or a backdrop filter (the header) doesn't shift it.
 * `matchWidth` makes it as wide as the anchor (a combobox's list).
 */
export function usePopoverPlace(
  open: boolean,
  anchor: RefObject<HTMLElement | null>,
  pop: RefObject<HTMLElement | null>,
  { align = "start", offset = 4, matchWidth = false }: { align?: PopoverAlign; offset?: number; matchWidth?: boolean } = {},
) {
  const [place, setPlace] = useState<PopoverPlace | null>(null);
  useLayoutEffect(() => {
    if (!open) return setPlace(null);
    const update = () => {
      const a = anchor.current?.getBoundingClientRect();
      const el = pop.current;
      if (!a || !el) return;
      const p = el.getBoundingClientRect();
      // Where top: 0, left: 0 lands: the window's corner, or a transformed ancestor's.
      const originTop = p.top - (Number.parseFloat(el.style.top) || 0);
      const originLeft = p.left - (Number.parseFloat(el.style.left) || 0);
      const width = matchWidth ? a.width : p.width;
      const below = a.bottom + offset;
      const top = below + p.height <= innerHeight - EDGE ? below : Math.max(EDGE, a.top - offset - p.height);
      const want = align === "end" ? a.right - width : a.left;
      const left = Math.max(EDGE, Math.min(want, innerWidth - width - EDGE));
      setPlace((was) => {
        const next = { top: top - originTop, left: left - originLeft, width: matchWidth ? width : undefined };
        return was && was.top === next.top && was.left === next.left && was.width === next.width ? was : next;
      });
    };
    update();
    addEventListener("resize", update);
    // Capture: any scrolling panel moves the anchor.
    addEventListener("scroll", update, true);
    // What's inside can grow or shrink (a scan's details), which can flip it.
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    if (pop.current) ro?.observe(pop.current);
    return () => {
      removeEventListener("resize", update);
      removeEventListener("scroll", update, true);
      ro?.disconnect();
    };
  }, [open, anchor, pop, align, offset, matchWidth]);
  return place;
}

/** The control that opens a popover: the anchor itself, or the control inside it that says it's expanded. */
const triggerOf = (anchor: HTMLElement | null) => (anchor?.matches("button, input, a[href]") ? anchor : anchor?.querySelector<HTMLElement>("[aria-expanded]"));

/** Put focus back on the control that opened a popover. */
function focusTrigger(anchor: HTMLElement | null) {
  triggerOf(anchor)?.focus();
}

/**
 * Open state for one popover, and the props `Popover` needs. `close()` puts focus back on the
 * trigger; `close(false)` doesn't (a press somewhere else already moved it).
 */
export function usePopover() {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLElement | null>(null);
  const popRef = useRef<HTMLElement | null>(null);
  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) focusTrigger(triggerRef.current);
  };
  return { open, setOpen, close, triggerRef, popRef, props: { anchor: triggerRef, popRef, onDismiss: () => setOpen(false) } };
}

type PopoverProps = Omit<HTMLAttributes<HTMLElement>, "role"> & {
  /** The trigger, or the box around it: placement, presses that don't count as outside, where focus goes back. */
  anchor: RefObject<HTMLElement | null>;
  /** Escape or a press outside. On Escape, focus is already back on the trigger. */
  onDismiss: () => void;
  /**
   * `dialog`: a non-modal dialog (a calendar, a card with buttons); name it with aria-label.
   * `listbox`: a list of options (rendered as a <ul>). `group`: a set of controls (filters).
   * `tooltip` / `alert`: a card that only describes its trigger, or one that reports a failure.
   */
  role: "dialog" | "listbox" | "group" | "tooltip" | "alert";
  align?: PopoverAlign;
  /** Gap to the anchor, in px. */
  offset?: number;
  matchWidth?: boolean;
  /** The popover's element, for a caller that checks where focus went. */
  popRef?: RefObject<HTMLElement | null>;
  children: ReactNode;
};

/**
 * design-system popover: the one floating surface for anything that isn't an action menu (Menu) or a
 * modal (Dialog). Mount it only while open. It's not a native <dialog>: that would trap focus inside
 * the job's own dialog. Escape closes only the popover (it doesn't reach a dialog around it) and puts
 * focus back on the trigger; a press outside it and its anchor closes it. Under the anchor, or above
 * when there's no room.
 */
export function Popover({ anchor, onDismiss, role, align, offset, matchWidth, popRef, className, style, children, ...rest }: PopoverProps) {
  const own = useRef<HTMLElement | null>(null);
  const place = usePopoverPlace(true, anchor, own, { align, offset, matchWidth });
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;
  useEffect(() => {
    const pop = own.current;
    const box = anchor.current;
    // Only the trigger itself: another control next to it (Stop, a menu's button) keeps its own Escape.
    const trigger = triggerOf(box);
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!pop?.contains(t) && !box?.contains(t)) dismiss.current();
    };
    // Native listeners on the popover and its trigger, so Escape stops here: a dialog around it stays open.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      dismiss.current();
      trigger?.focus();
    };
    document.addEventListener("pointerdown", onDown);
    pop?.addEventListener("keydown", onKey);
    trigger?.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      pop?.removeEventListener("keydown", onKey);
      trigger?.removeEventListener("keydown", onKey);
    };
  }, [anchor]);
  const Tag = role === "listbox" ? "ul" : "div";
  return (
    <Tag
      {...rest}
      ref={(el: HTMLElement | null) => {
        own.current = el;
        if (popRef) popRef.current = el;
      }}
      role={role}
      // Measured first, then shown: transparent rather than hidden, so focus can move in at once.
      style={{ ...style, ...(place ? { top: place.top, left: place.left, width: place.width } : { top: 0, left: 0, opacity: 0, pointerEvents: "none" }) }}
      className={cx("fixed z-menu whitespace-normal rounded-md border border-line bg-overlay text-left shadow-l3", className)}
    >
      {children}
    </Tag>
  );
}

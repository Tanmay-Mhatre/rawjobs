import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { cx } from "../../lib/cx";
import { Kbd } from "./Kbd";
import { useClosing } from "./useClosing";

/** `hint`: a second, quieter line under the label (what the item does, how long it takes). */
export type MenuItem = { id: string; label: string; hint?: string; icon?: ReactNode; shortcut?: string; danger?: boolean; onSelect: () => void } | { separator: true; id: string };

const isAction = (i: MenuItem): i is Extract<MenuItem, { onSelect: () => void }> => !("separator" in i);

/**
 * design/components/Menu: the actions for one thing, with their shortcuts. Opens on click, Enter or
 * Space and focuses the first item; arrow keys, Home and End move real focus (roving tabindex); Esc,
 * Tab or a click outside closes it and focus goes back to the trigger. Danger items go last.
 */
export function Menu({
  label,
  trigger,
  items,
  align = "end",
  side = "below",
  className,
}: {
  /** Names the menu ("Job actions"). */
  label: string;
  /** Renders the button that opens it; spread the props onto a <button>. */
  trigger: (props: {
    ref: (el: HTMLButtonElement | null) => void;
    onClick: () => void;
    onKeyDown: (e: KeyboardEvent) => void;
    "aria-haspopup": "menu";
    "aria-expanded": boolean;
    "aria-controls": string;
  }) => ReactNode;
  items: MenuItem[];
  /** The trigger's edge the menu lines up with. Near the window's edge it uses the other edge, or slides in. */
  align?: "start" | "end";
  /** "above" for a trigger at the bottom of a panel (the job's foot), so the menu isn't cut off. */
  side?: "below" | "above";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const { mounted, state, done } = useClosing(open);
  const menuId = useId();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const actions = items.filter(isAction);
  // Where the menu's left edge sits, from the trigger's left edge. Undefined until measured: the classes place it.
  const [left, setLeft] = useState<number>();

  // Measured before paint, so the menu never shows cut off first. It stays inside the window and any
  // scrolling box around it: a trigger near the edge (Snooze, a Pipeline card in the last column)
  // lines its menu up with its other edge, or slides it in when neither edge leaves room.
  useLayoutEffect(() => {
    const width = menuRef.current?.offsetWidth;
    const wrap = wrapRef.current;
    if (!open || !width || !wrap) return;
    const anchor = wrap.getBoundingClientRect();
    const gap = 8;
    let min = gap;
    let max = window.innerWidth - gap;
    // Up to the body: the window bounds already stand for it and the page root.
    for (let el = wrap.parentElement; el && el !== document.body; el = el.parentElement) {
      const overflow = getComputedStyle(el).overflowX;
      if (!overflow || overflow === "visible") continue;
      const r = el.getBoundingClientRect();
      min = Math.max(min, r.left + gap);
      max = Math.min(max, r.right - gap);
    }
    const start = anchor.left;
    const end = anchor.right - width;
    const fits = (x: number) => x >= min && x + width <= max;
    // The asked-for edge, else the trigger's other edge, else as close as the room allows.
    const x = [align === "start" ? start : end, align === "start" ? end : start].find(fits) ?? Math.max(min, Math.min(start, max - width));
    setLeft(Math.round(x - anchor.left));
  }, [open, align]);

  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  };

  // Focus follows the active item while open.
  useEffect(() => {
    if (open) itemRefs.current[active]?.focus();
  }, [open, active]);

  // A click outside closes it without stealing focus back.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-registered on each open; close only uses refs and setters
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) close(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  const openAt = (i: number) => {
    setActive(i);
    setOpen(true);
  };

  const onMenuKey = (e: KeyboardEvent) => {
    const n = actions.length;
    const move = { ArrowDown: active + 1, ArrowUp: active - 1, Home: 0, End: n - 1 }[e.key];
    if (move !== undefined) {
      e.preventDefault();
      setActive((move + n) % n);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === "Tab") {
      close(false);
    }
  };

  let actionIndex = -1;
  return (
    <div ref={wrapRef} className={cx("relative inline-block", className)}>
      {trigger({
        ref: (el) => (triggerRef.current = el),
        onClick: () => (open ? close() : openAt(0)),
        onKeyDown: (e) => {
          if (e.key === "ArrowDown" || ((e.key === "Enter" || e.key === " ") && !open)) {
            e.preventDefault();
            openAt(0);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            openAt(actions.length - 1);
          }
        },
        "aria-haspopup": "menu",
        "aria-expanded": open,
        "aria-controls": menuId,
      })}
      {mounted && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={label}
          data-state={state}
          onAnimationEnd={done}
          onKeyDown={onMenuKey}
          className={cx("rj-menu absolute z-menu", side === "above" ? "bottom-full mb-1" : "top-full mt-1", align === "end" ? "right-0" : "left-0")}
          style={left === undefined ? undefined : { left, right: "auto" }}
        >
          {items.map((item) => {
            // biome-ignore lint/a11y/useSemanticElements: an ARIA role on purpose: the native element (fieldset, output, input, hr, ul) would change layout or behaviour here
            if (!isAction(item)) return <div key={item.id} className="rj-menu__sep" role="separator" />;
            const i = ++actionIndex;
            return (
              <button
                key={item.id}
                ref={(el) => {
                  itemRefs.current[i] = el;
                }}
                type="button"
                role="menuitem"
                tabIndex={i === active ? 0 : -1}
                aria-keyshortcuts={item.shortcut}
                className={cx("rj-menu__item", item.danger && "rj-menu__item--danger", item.hint && "rj-menu__item--hint")}
                onClick={() => {
                  close();
                  item.onSelect();
                }}
                onFocus={() => setActive(i)}
              >
                {item.icon}
                {item.hint ? (
                  <span className="min-w-0">
                    <span className="block">{item.label}</span>
                    <span className="block type-meta font-normal text-muted">{item.hint}</span>
                  </span>
                ) : (
                  item.label
                )}
                {item.shortcut && <Kbd hidden>{item.shortcut}</Kbd>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

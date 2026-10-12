import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { cx } from "../ui";
import { Kbd } from "./Kbd";
import { useClosing } from "./useClosing";

export type MenuItem = { id: string; label: string; icon?: ReactNode; shortcut?: string; danger?: boolean; onSelect: () => void } | { separator: true; id: string };

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
  align?: "start" | "end";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const { mounted, state, done } = useClosing(open);
  const menuId = useId();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const actions = items.filter(isAction);

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
          id={menuId}
          role="menu"
          aria-label={label}
          data-state={state}
          onAnimationEnd={done}
          onKeyDown={onMenuKey}
          className={cx("rj-menu absolute top-full z-menu mt-1", align === "end" ? "right-0" : "left-0")}
        >
          {items.map((item) => {
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
                className={cx("rj-menu__item", item.danger && "rj-menu__item--danger")}
                onClick={() => {
                  close();
                  item.onSelect();
                }}
                onFocus={() => setActive(i)}
              >
                {item.icon}
                {item.label}
                {item.shortcut && <Kbd hidden>{item.shortcut}</Kbd>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

import { useEffect, useRef, type ReactNode } from "react";
import { cx } from "./ui";

/**
 * Accessible modal on top of the native <dialog>: `showModal()` traps focus, makes the page behind it inert
 * and closes on Escape; on close, focus returns to whatever opened it. Clicking the backdrop closes it too.
 *
 * placement: "center" (default), "right" (side drawer) or "bottom" (sheet on phones, centered from sm up).
 */
export function Dialog({
  open,
  onClose,
  label,
  labelledBy,
  placement = "center",
  className,
  initialFocus,
  persistent = false,
  children,
}: {
  open: boolean;
  onClose: () => void;
  /** Accessible name when there's no visible heading to point `labelledBy` at. */
  label?: string;
  labelledBy?: string;
  placement?: "center" | "right" | "bottom";
  className?: string;
  /** CSS selector inside the dialog to focus first; defaults to the first focusable element. */
  initialFocus?: string;
  /**
   * Only `open` closes it: not Escape, the backdrop, or the browser (Chrome closes a modal on Escape
   * by itself when there's been no click since it opened). A required update uses this.
   */
  persistent?: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<Element | null>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      opener.current = document.activeElement;
      d.showModal();
      const target = initialFocus ? d.querySelector<HTMLElement>(initialFocus) : null;
      target?.focus();
    } else if (!open && d.open) {
      d.close();
    }
  }, [open, initialFocus]);

  // Restore focus to the opener when the dialog goes away (closed or unmounted).
  useEffect(() => {
    if (!open) return;
    return () => {
      const el = opener.current as HTMLElement | null;
      if (el && document.contains(el)) el.focus();
    };
  }, [open]);

  if (!open) return null;
  return (
    <dialog
      ref={ref}
      aria-label={label}
      aria-labelledby={labelledBy}
      className={cx(
        "jh-dialog",
        placement === "center" && "m-auto w-[calc(100%-2rem)] max-w-lg",
        // design/components/Drawer: drawer-width (560px), full width under 720px.
        placement === "right" && "jh-drawer ml-auto mr-0 h-dvh max-h-dvh w-full min-[721px]:max-w-[var(--drawer-width)]",
        placement === "bottom" && "mx-auto mb-0 mt-auto w-full sm:m-auto sm:max-w-lg",
        className,
      )}
      // Escape fires "cancel"; let React state drive the close so parents stay in sync.
      onCancel={(e) => {
        e.preventDefault();
        if (!persistent) close.current();
      }}
      onClose={(e) => {
        if (persistent && !e.currentTarget.open) e.currentTarget.showModal();
      }}
      onMouseDown={(e) => {
        // A press on the <dialog> element itself (not its content) is a press on the backdrop.
        if (e.target === e.currentTarget && !persistent) close.current();
      }}
    >
      {children}
    </dialog>
  );
}

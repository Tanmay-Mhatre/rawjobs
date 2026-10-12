import type { ReactNode } from "react";
import { cx } from "../ui";

/** design/components/Kbd: one element per key ("⌘" and "K" are two). A <kbd>, so it's announced as a key. */
export function Kbd({ children, className, hidden }: { children: ReactNode; className?: string /** Decorative next to a labelled control. */; hidden?: boolean }) {
  return (
    <kbd className={cx("rj-kbd", className)} aria-hidden={hidden || undefined}>
      {children}
    </kbd>
  );
}

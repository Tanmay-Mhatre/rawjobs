import { useEffect, useRef } from "react";

/**
 * Single-key shortcuts (design/README.md, Interaction) stay out of the way: not while you type in a
 * field, and not with Ctrl, Cmd or Alt held (Ctrl+C is copy, not C).
 */
export function ignoreShortcut(e: Pick<KeyboardEvent, "metaKey" | "ctrlKey" | "altKey" | "target">): boolean {
  if (e.metaKey || e.ctrlKey || e.altKey) return true;
  const t = e.target as HTMLElement | null;
  return !!t?.closest?.("input, textarea, select, [contenteditable=''], [contenteditable='true'], [contenteditable='plaintext-only']");
}

/** "g" then a letter goes to a section from any page, as in Gmail and GitHub. */
export const GO_TO = { r: "radar", p: "pipeline", c: "companies", s: "settings" } as const;
export type GoToSection = (typeof GO_TO)[keyof typeof GO_TO];
/** How long after "g" the letter still counts. */
export const GO_TO_MS = 1000;

/**
 * Listens for "g" then r, p, c or s. It listens in the capture phase and stops the letter there, so
 * "g s" goes to Settings without also saving the job the Radar has selected, and "g r" doesn't scan.
 * `canGo` is asked at each key press (false under a dialog or during setup).
 */
export function useGoToKeys(onGo: (section: GoToSection) => void, canGo: () => boolean): void {
  const latest = useRef({ onGo, canGo });
  latest.current = { onGo, canGo };
  useEffect(() => {
    let armedAt = -Infinity;
    const onKey = (e: KeyboardEvent) => {
      const armed = Date.now() - armedAt <= GO_TO_MS;
      armedAt = -Infinity;
      if (ignoreShortcut(e) || !latest.current.canGo()) return;
      const section = armed ? GO_TO[e.key as keyof typeof GO_TO] : undefined;
      if (section) {
        e.preventDefault();
        e.stopImmediatePropagation();
        latest.current.onGo(section);
      } else if (e.key === "g") armedAt = Date.now();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);
}

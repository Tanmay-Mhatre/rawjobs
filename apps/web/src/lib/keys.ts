/**
 * Single-key shortcuts (design/README.md, Interaction) stay out of the way: not while you type in a
 * field, and not with Ctrl, Cmd or Alt held (Ctrl+C is copy, not C).
 */
export function ignoreShortcut(e: Pick<KeyboardEvent, "metaKey" | "ctrlKey" | "altKey" | "target">): boolean {
  if (e.metaKey || e.ctrlKey || e.altKey) return true;
  const t = e.target as HTMLElement | null;
  return !!t?.closest?.("input, textarea, select, [contenteditable=''], [contenteditable='true'], [contenteditable='plaintext-only']");
}

/** Join class names, skipping empty ones. Its own module so the primitives don't import ui.tsx (which re-exports them). */
export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

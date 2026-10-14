import { useSyncExternalStore } from "react";

/** Whether a media query matches, kept up to date (true where matchMedia doesn't exist). */
export function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (on) => {
      if (typeof matchMedia !== "function") return () => {};
      const m = matchMedia(query);
      m.addEventListener("change", on);
      return () => m.removeEventListener("change", on);
    },
    () => typeof matchMedia !== "function" || matchMedia(query).matches,
  );
}

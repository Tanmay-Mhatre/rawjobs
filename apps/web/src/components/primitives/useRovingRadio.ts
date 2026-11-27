import { type KeyboardEvent, useRef } from "react";

const STEP: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

/**
 * Keyboard for a radio group of buttons, after the APG radio group pattern: only the checked radio
 * is in the Tab order (the first one when none is checked), the arrow keys move to the next or
 * previous radio and check it, wrapping at the ends, and Home and End go to the first and last.
 * Spread `itemProps(i)` on the i-th radio.
 */
export function useRovingRadio<T>(values: readonly T[], value: T, onChange: (v: T) => void) {
  const refs = useRef<(HTMLElement | null)[]>([]);
  const checked = Math.max(0, values.indexOf(value));
  const onKeyDown = (i: number) => (e: KeyboardEvent<HTMLElement>) => {
    const step = STEP[e.key];
    const to = e.key === "Home" ? 0 : e.key === "End" ? values.length - 1 : step ? (i + step + values.length) % values.length : -1;
    if (to < 0) return;
    e.preventDefault();
    onChange(values[to]!);
    refs.current[to]?.focus();
  };
  return {
    itemProps: (i: number) => ({
      ref: (el: HTMLElement | null) => {
        refs.current[i] = el;
      },
      tabIndex: i === checked ? 0 : -1,
      onKeyDown: onKeyDown(i),
    }),
  };
}

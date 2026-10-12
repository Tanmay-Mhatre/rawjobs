import { useEffect, type KeyboardEvent, type ReactNode } from "react";
import { ignoreShortcut } from "../../lib/keys";
import { SearchField } from "../primitives";
import { cx } from "../ui";
import type { SettingsHit } from "./search";

export const SEARCH_ID = "settings-search";
const LIST_ID = "settings-search-results";
const optionId = (i: number) => `settings-hit-${i}`;

/** "/" on the Settings tab goes to its search, the way it goes to the Radar's search on the Radar. */
export function useSearchShortcut() {
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "/" || ignoreShortcut(e) || document.querySelector("dialog[open]")) return;
      const input = document.getElementById(SEARCH_ID);
      if (!input?.offsetParent) return;
      e.preventDefault();
      input.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

/** The search box: arrows move through the results, Enter opens one, Esc clears. */
export function SettingsSearchBox({
  query,
  onQuery,
  hits,
  active,
  onActive,
  onOpen,
}: {
  query: string;
  onQuery: (q: string) => void;
  hits: SettingsHit[];
  active: number;
  onActive: (i: number) => void;
  onOpen: (hit: SettingsHit) => void;
}) {
  const usable = hits.filter((h) => !h.unavailable);
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape" && query) {
      e.preventDefault();
      e.stopPropagation();
      onQuery("");
    } else if ((e.key === "ArrowDown" || e.key === "ArrowUp") && usable.length) {
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : usable.length - 1;
      onActive((active + step) % usable.length);
    } else if (e.key === "Enter" && usable[active]) {
      e.preventDefault();
      onOpen(usable[active]!);
    }
  };
  return (
    <SearchField
      id={SEARCH_ID}
      label="Search settings"
      placeholder="Search"
      value={query}
      onChange={(e) => onQuery(e.target.value)}
      onKeyDown={onKeyDown}
      autoComplete="off"
      role="combobox"
      aria-expanded={!!query.trim()}
      aria-controls={LIST_ID}
      aria-activedescendant={query.trim() && usable.length ? optionId(active) : undefined}
      className="mb-4"
    />
  );
}

/** The matching cards, each with its place in Settings and, when the title doesn't say, why it matched. */
export function SettingsSearchResults({ query, hits, active, onOpen }: { query: string; hits: SettingsHit[]; active: number; onOpen: (hit: SettingsHit) => void }) {
  const terms = query.trim().split(/\s+/).filter(Boolean);
  let usable = -1;
  return (
    <div className="space-y-3">
      <h2 className="type-subheading text-ink" aria-live="polite">
        {hits.length ? `${hits.length} setting${hits.length === 1 ? "" : "s"}` : `No setting matches “${query.trim()}”`}
      </h2>
      {!hits.length && <p className="type-small text-muted">Try “alerts”, “salary” or “theme”, or pick a page.</p>}
      {/* biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: ARIA combobox: focus stays in the search box and options are reached with aria-activedescendant */}
      <ul id={LIST_ID} role="listbox" aria-label="Matching settings" className="space-y-2">
        {hits.map((hit) => {
          const i = hit.unavailable ? -1 : ++usable;
          return (
            // biome-ignore lint/a11y/useFocusableInteractive: ARIA combobox option: reached with aria-activedescendant, so not focusable itself
            // biome-ignore lint/a11y/useKeyWithClickEvents: the search box handles the keys (arrows and Enter)
            <li
              key={hit.section.id}
              id={i >= 0 ? optionId(i) : undefined}
              // biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: ARIA combobox: focus stays in the search box and options are reached with aria-activedescendant
              role="option"
              aria-selected={i === active}
              aria-disabled={!!hit.unavailable}
              onClick={() => !hit.unavailable && onOpen(hit)}
              className={cx("rounded-md border bg-raised px-4 py-3", hit.unavailable ? "border-line text-muted" : "cursor-pointer hover:border-control", i === active ? "border-ink" : "border-line")}
            >
              <span className="block type-body font-medium">{mark(hit.section.title, terms)}</span>
              <span className="block type-meta text-muted">{hit.path}</span>
              {(hit.unavailable ?? hit.why) && <span className="mt-0.5 block type-small text-muted">{hit.unavailable ?? mark(hit.why!, terms)}</span>}
            </li>
          );
        })}
      </ul>
      {hits.some((h) => !h.unavailable) && <p className="hidden type-meta text-muted md:block">↑ ↓ to move, Enter to open, Esc to clear</p>}
    </div>
  );
}

/** The first typed word found in `text`, marked. */
function mark(text: string, terms: string[]): ReactNode {
  const lower = text.toLowerCase();
  for (const t of terms) {
    const i = lower.indexOf(t.toLowerCase());
    if (i >= 0)
      return (
        <>
          {text.slice(0, i)}
          <mark className="rounded-sm bg-active text-ink">{text.slice(i, i + t.length)}</mark>
          {text.slice(i + t.length)}
        </>
      );
  }
  return text;
}

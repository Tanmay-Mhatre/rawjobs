# Scan progress pop-over: redesign

Status: Shipped (PR #230 / v0.6.11). Mockup: [`scan-progress-popover-mockup.html`](scan-progress-popover-mockup.html)
(from before the decisions below: its Done line lists names; the build shows a count).

## Problem

The header "Scanning 16%" button opens a pop-over (`ScanStatus` in
`apps/web/src/components/ScanButton.tsx`, styles `.rj-progress*` in `design/components/bundle.css`).
For an "Every company" scan it lists one row per hiring system, and that breaks:

1. **Ragged rows.** The grid is `128px minmax(0,1fr) 64px`. A count like `142 / 12,215` does not fit
   in 64px and wraps to two lines, so rows have different heights.
2. **Overflow.** The pop-over has no max height. Twenty-plus rows run past the bottom of the window.
3. **Clipped labels.** `SourceTag` is `inline-flex`, so `truncate` clips the text node without an
   ellipsis: `ADP WORKFORCE NOW` is cut mid-letter.
4. **Overload.** Twenty bars at 1 to 3% say little. Finished systems (Greenhouse 7,715 / 7,715) sit
   among unfinished ones, and nothing shows the scan's overall progress as a bar.

The same pop-over serves small scans ("Scan" with 4 source rows; "Only my companies" with 1 to 5
hiring systems and hundreds of companies). It must work on phones (about 375px) and in dark mode.
`ScanProgress` (the Guidance card) renders the same `.rj-progress` rows and has bugs 1 and 3 too.

## Recommendation: overall bar, top five, the rest one click away

One structure for every scan size:

1. **Headline + overall bar.** `scanLine(scan)` stays as is. Under it, one full-width overall bar:
   the answer to "how far along is it?" at a glance.
2. **Up to five rows (three on phones), biggest first.** Unfinished systems, sorted as today (total, descending; never
   by progress, so rows don't jump on each tick). The biggest systems decide the time left, so they
   are the ones worth watching.
3. **Finished systems leave the list** for one count line: `✓ 3 hiring systems done`.
4. **"Show all 19 hiring systems"** (the count is live) expands the full unfinished list inside a
   scroll area with a max height; "Show fewer" collapses it.
5. **Numbers that fit.** Counts never wrap: compact from 10,000 up (`142 / 12.2K`), exact below
   (`41 / 120`, `1,302 / 4,834`). The exact numbers are in the row's tooltip and screen-reader text.
6. **Labels that ellipsize**, with the full name in the tooltip.
7. **Narrow width:** a container query turns each row into two lines (name and count, then a
   full-width bar), so phones get readable names instead of a 60px bar.

Small scans (five rows or fewer) show every row in place, finished ones included (full green bar,
green count like `64 / 64`), because a short list is not overload and a full row is reassuring.

Why this one: it fixes all four bugs with one rule set, keeps the per-system detail people use to
understand a long time estimate, never grows taller than the window, and needs no new surface.

Rejected:

- **Scroll the full list only:** fixes overflow, not overload; twenty near-empty bars remain.
- **Overall bar only, no per-system rows:** hides why an all-company scan takes hours and what the small
  scans cover.
- **Sort by progress or by time left:** rows reorder on every tick; hard to read and to point at.
- **One stacked bar coloured per system:** twenty colours, unreadable, fails contrast and colour-blind use.
- **Percent per row:** "1%" says less than "142 / 12.2K", and the current contract keeps percent
  only on the header button.
- **Move details to a drawer or Scans page:** a bigger surface for a glance; reconsider only if
  people ask for per-company detail during a scan.

## Layout

Pop-over shell (Tailwind, `ScanStatus`):

```
absolute right-0 top-full z-40 mt-2 w-[24rem] max-w-[calc(100vw-2rem)]
max-h-[min(36rem,calc(100dvh-6rem))] flex flex-col
rounded-md border border-line bg-raised shadow-l3
```

Inside, three blocks; padding `var(--space-4)` (16px):

| Block | Content | Notes |
| --- | --- | --- |
| Head | headline (`type-small font-semibold`), overall bar | `margin-top: var(--space-2)` before the bar |
| Body | section label, rows, Done line, expander | `flex: 1; min-height: 0`; the rows list scrolls when expanded |
| Foot | matches line, notify line | `border-top: 1px solid var(--border-subtle)`, never scrolls away |

Section label: `By hiring system` for per-ATS rows, `By source` for the "Scan" rows
(`sourceRows`). Style: `type-meta text-muted`, `margin: var(--space-4) 0 var(--space-2)`.

### CSS (all in `design/components/bundle.css`, tokens only)

```css
.rj-progress { display: grid; gap: var(--space-2); container-type: inline-size; margin: 0; padding: 0; list-style: none; }
.rj-progress__row {
  display: grid; align-items: center; gap: var(--space-3);
  grid-template-columns: minmax(0, 8rem) minmax(2rem, 1fr) 6rem;
  grid-template-areas: "label track count";
}
.rj-progress__row .rj-source { grid-area: label; display: block; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.rj-progress__track { grid-area: track; height: 4px; background: var(--progress-track); border-radius: var(--radius-0); overflow: hidden; }
.rj-progress__fill { display: block; height: 100%; background: var(--progress-fill); transform-origin: left; transition: transform var(--duration-base) var(--ease-enter); }
.rj-progress__count { grid-area: count; font: var(--text-meta, 400 12px/16px var(--font-sans)); color: var(--text-secondary); text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
.rj-progress__row[data-done] .rj-progress__fill { background: var(--success-solid); }
.rj-progress__row[data-done] .rj-progress__count { color: var(--success-text); }

/* Overall bar: same parts, a touch heavier. */
.rj-progress__track--overall { height: 6px; }

/* Expanded list: scrolls inside the pop-over. */
.rj-progress--scroll { max-height: 15rem; overflow-y: auto; overscroll-behavior: contain; scrollbar-gutter: stable; padding-right: var(--space-1); }

/* Done line and expander. */
.rj-progress__done { display: flex; gap: var(--space-2); align-items: flex-start; font: var(--text-meta, 400 12px/16px var(--font-sans)); color: var(--text-secondary); }
.rj-progress__done .rj-icon { width: 14px; height: 14px; color: var(--success-text); flex: none; margin-top: 1px; }
.rj-progress__done span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* Narrow (phones, a narrow Guidance card): name and count, then the bar. */
@container (max-width: 20rem) {
  .rj-progress__row { grid-template-columns: minmax(0, 1fr) auto; grid-template-areas: "label count" "track track"; row-gap: var(--space-1); }
}
@media (prefers-reduced-motion: reduce) {
  .rj-progress__fill { transition: none; }
}
```

The expander is a quiet small button: `rj-btn rj-btn--quiet rj-btn--sm`, left-aligned with the rows
(`margin-left: calc(-1 * var(--space-3))` so its text lines up with the labels), `ChevronDown` /
`ChevronUp` icon after the text.

Measured fit: the count column is 6rem (96px); the widest count, `9,999 / 99.9K` (13 characters,
12px Geist tabular), is about 80px. The label column is 8rem; `SMARTRECRUITERS` fits,
`ADP WORKFORCE NOW` ellipsizes to `ADP WORKFORCE N…`.

## Numbers

New helper `shortCount(n)` in `apps/web/src/lib/format.ts`:

- `n < 10000`: `n.toLocaleString()` (`41`, `1,302`, `9,870`).
- `n >= 10000`: `Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 })`
  (`12.2K`, `10.4K`). Locale-aware, so other locales get their own suffix.

Rows show `${shortCount(done)} / ${shortCount(total)}`. The row's `title` and screen-reader text use
full numbers: `SmartRecruiters: 142 of 12,215 companies`. The headline keeps full numbers.

No fixed counts anywhere in copy: every number (rows, "Show all N", the Done count) comes from the
scan state.

## Ordering and splitting

New pure helper in `apps/web/src/lib/scan.ts`:

```ts
/** Rows for the pop-over: up to `limit` unfinished (biggest first), the finished ones, and how many more. */
export function splitProgress<R extends { done: number; total: number; feed?: true }>(rows: R[], limit = 5)
  : { shown: R[]; rest: R[]; done: R[]; inPlace: boolean }
```

- `inPlace` is true when `rows.length <= limit`: show every row in its own order, finished ones
  included (`data-done`: green bar and count; the count keeps its numbers).
- Otherwise: `done` = rows with `done >= total` (or `feed`), in the existing order; `shown` = first
  `limit` unfinished; `rest` = the other unfinished rows.
- Input order stays `progressRows` / `sourceRows` order, so rows never reorder by progress. A row
  moves only once: when it finishes, into the Done line.

## Copy

| Element | String |
| --- | --- |
| Section label | `By hiring system` / `By source` |
| Done line | `3 hiring systems done` (live count; `1 hiring system done`; `3 sources done` for "Scan"; no names) |
| Done line, every system finished | `All 22 hiring systems checked` (live count; `All sources checked` for "Scan") |
| Expander, collapsed | `Show all 19 hiring systems` (unfinished count = `shown + rest`) |
| Expander, expanded | `Show fewer` |
| Finished row (in place) | count stays `64 / 64`, in green (the shared feed row reads `done`) |
| Starting | headline `Starting scan…`, no section, a skeleton overall bar |
| Syncing | headline `Updating the company directory…`, no section |
| Footer | unchanged: `N matches so far. Stop any time: the next scan carries on from here.` |

## States

- **Large scan ("Every company", 22 systems).** Headline, overall bar at 17%, five rows
  (SmartRecruiters, BambooHR, Paylocity, Workday, ADP Workforce Now), Done line
  ("3 hiring systems done"), "Show all 19 hiring systems", footer. About 330px tall, whatever the
  number of systems.
- **Large scan, expanded.** The 19 unfinished rows in a 15rem scroll area with a stable gutter;
  head and foot stay put; the pop-over is pinned (see Keyboard).
- **Small scan ("Scan", `sourceRows`).** Four rows in place: Shared feed (Done), Your companies
  41 / 120, Past matches 12 / 38, Feed picks 0 / 64. No Done line, no expander.
- **Small scan ("Only my companies", 2 to 5 systems).** Same, per hiring system.
- **Every system finished, scan wrapping up.** Overall bar full, the rows block replaced by the
  "All 22 hiring systems checked" line, footer. (The pop-over closes when the phase leaves
  `running`, as today.)
- **Starting / syncing.** Headline only plus a `rj-skel` overall bar (shimmer off under reduced
  motion: it already uses an animation, see below). No empty "By hiring system" label.
- **Older CLI (no breakdown).** One "All companies" row, shown in place.
- **Phone (375px).** The pop-over is `max-w-[calc(100vw-2rem)]` (343px); the content is 311px, under
  the 20rem container breakpoint, so rows go two-line. Three rows before "Show all" (`limit = 3`
  under `max-sm`, via `useMedia("(max-width: 639px)")`, moved from `Companies.tsx` to a shared
  hook); a scan with three systems or fewer shows them all in place. On `max-sm`, anchor the pop-over to the
  viewport, not the button, so it never runs off the left edge:
  `max-sm:fixed max-sm:inset-x-4 max-sm:top-16 max-sm:w-auto` (the header is `h-14`, so `top-16`
  leaves the same 8px gap as `mt-2`).
- **Dark mode / high contrast.** Tokens only (`--progress-track`, `--progress-fill`,
  `--success-solid`, `--success-text`, `--border-subtle`, `--shadow-l3`); no new colours. In HC themes
  `--shadow-l3` is `none` and the `border-line` border carries the edge.

## Accessibility

- **Overall bar:** `role="progressbar"`, `aria-label="Scan progress"`, `aria-valuemin=0`,
  `aria-valuemax={total}`, `aria-valuenow={done}`, `aria-valuetext="20,751 of 122,651 companies"`.
  Not a live region (the existing `role="status"` text stays the only announcement).
- **Rows:** a `<ul class="rj-progress" aria-label="By hiring system">` of `<li>`s (replaces the
  `role="group"` div, and its biome-ignore). The bar is `aria-hidden`; the compact count is
  `aria-hidden` and followed by `<span class="sr-only">142 of 12,215</span>`. A finished row reads its
  full count ("64 of 64 companies").
- **Expander:** a real `<button>` with `aria-expanded` and `aria-controls` pointing at the list.
  Clicking it pins the pop-over (`setOpen("pinned")`) so a hover pop-over doesn't close while the
  user reads. After "Show fewer", focus stays on the button.
- **Scroll area:** when expanded, the list gets `tabIndex={0}` so keyboard users can scroll it, with
  the existing focus-visible ring.
- **Keyboard:** Tab from the header button into the pop-over reaches the expander; Esc closes a
  pinned pop-over and returns focus to the header button (add `triggerRef.focus()` to the Esc
  handler in `useHoverDetails`).
- **Reduced motion:** `.rj-progress__fill` has no transition; `.rj-skel::after` shimmer should be
  off under `prefers-reduced-motion: reduce` (add the rule if it isn't global). No expand animation.
- **Contrast:** count text uses `--text-secondary` on `--bg-raised` (same as today); the Done check
  uses `--success-text`, with the words "… done" next to it, and a finished row's full count says
  it is complete, so colour is never the only signal.

## Implementation change list

1. `apps/web/src/lib/format.ts`: add `shortCount(n)`.
2. `apps/web/src/lib/scan.ts`: add `splitProgress(rows, limit = 5)`. No change to `progressRows`,
   `sourceRows` or `scanLine`.
3. `apps/web/src/components/ScanBars.tsx` (new, small): `ScanBars({ rows, label, kind })` renders the
   section label, the `<ul>`, the Done line and the expander; owns the `expanded` state. Rows are
   normalized `{ key, label, done, total, feed? }`.
4. `apps/web/src/components/ScanButton.tsx` (`ScanStatus`): pop-over shell classes above; head with
   the overall progressbar; `ScanBars` in the body; footer block with a top border; `max-sm` fixed
   anchoring; Esc returns focus.
5. `apps/web/src/components/ScanProgress.tsx` (Guidance): use `ScanBars` too, so both places share
   the fixes and the same collapse (5 rows, 3 on phones; Done count line; "Show all" expander).
6. `design/components/bundle.css`: the `.rj-progress*` rules above (replace lines for
   `.rj-progress`, `__row`, `__track`, `__fill`, `__count`; add `__track--overall`, `--scroll`,
   `__done`, the container query and the reduced-motion rule). If the design package keeps
   component docs under `design/components/Loading/`, add the new parts there and refresh its
   screenshots.
7. Tests:
   - `apps/web/test/scanProgress.test.tsx`: the existing two `ScanProgress` cases keep passing
     (`41 / 120`, `64 / 64` stay exact under 10,000; "no %" still holds). Change the `role="group"`
     lookup to `getByRole("list", { name: "By hiring system" })` and `.rj-progress__row` stays the row
     class. Add: 8 systems, 2 finished → 5 rows, Done line reads "2 hiring systems done", expander
     reads "Show all 6 hiring systems", click shows 6 rows and `aria-expanded="true"`; at phone
     width (matchMedia mocked) → 3 rows.
   - New unit tests for `shortCount` (9,999 → `9,999`; 12,215 → `12.2K`) and `splitProgress`
     (in place at ≤ 5; order kept; finished rows split out; `rest` count).
   - A `ScanStatus` test: overall `progressbar` has `aria-valuetext` with full numbers; a row's
     screen-reader text has full numbers while the visible text is compact.
8. Check: `pnpm check`; run the app on a scratch `RAWJOBS_HOME`, start "Check every company now",
   screenshot the pop-over collapsed, expanded, at 375px and in dark mode (CLAUDE.md UI rule).

Release note: `Improved: The scan details pop-over stays tidy on big scans: an overall bar, the five
biggest hiring systems, finished ones on one line, and the rest one click away.`

## Decisions (2026-10-14)

1. Five rows before "Show all" on desktop, three on phones.
2. Done line is a count only: "3 hiring systems done".
3. The Guidance `ScanProgress` card collapses the same way.

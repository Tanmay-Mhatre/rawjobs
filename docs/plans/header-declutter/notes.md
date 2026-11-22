# Header declutter

The top bar got crowded when several states showed at once: Update to 0.7.10 (bordered),
"Last scan 2h ago" (wrapped to 3 lines), "2 failing" (amber bordered chip, wrapped to 2 lines),
"Pausing… 74%" (bordered pill), Scan now, the keyboard icon. Four separate bordered boxes,
scan state spread over four elements, and the update as loud as the main action.

## What changed

- **One row, no wrapping.** The right side is `whitespace-nowrap`; every shot below measures a
  56px row with no overflow at 1024, 1280 and 1536px.
- **One scan cluster.** Last scan, failing and the background check sit in one group right next
  to Scan now (4px gaps inside, 12px between groups). While a scan or background check runs, its
  status replaces "Last scan".
- **Only Scan now keeps a border.** Failing, the background-check pill and Update are quiet
  buttons (no border, no fill until hover). Scan now is the one outlined control.
- **Progressive labels by width:**
  - Update: icon + dot below 1280px; "Update" from 1280px; "Update to 0.7.10" from 1536px.
    The accessible name is always the full "Update to 0.7.10" (or "Update after scan" /
    "Updating…"), and the hover card still shows the version and what's in it.
  - Failing: icon + count below 1280px ("failing" stays in the accessible name); "2 failing" from 1280px.
  - Background check: "Checking the rest" from 1280px, ring + percent below. "Pausing…" and
    "Paused" always show their word (it's the state you just asked for).
  - Running scan: label from 1024px (was 640px), ring + percent below.
  - Last scan: text from 1280px. At any width it's also in the Scan now tooltip.
- **Required update keeps its emphasis.** A required update only shows in the pill while it waits
  for a scan (otherwise it has its own window). That case keeps the outlined style.
- Every click target, popover, keyboard shortcut and aria label is kept. The failing button still
  opens the failing companies view, and below 1024px the in-page FailingBanner still shows.

## Per skill

- **icon-buttons:** collapsed controls get a real tooltip, not `title`. Scan now has the
  `Tooltip` primitive with the shortcut Kbd (`R`), and `aria-keyshortcuts="R"`. The failing button
  has a `Tooltip` ("Review failing companies: usually the careers page moved"). The Update icon
  keeps its hover/focus card (role="tooltip") and gets an `aria-label` matching the full label.
  Scan now stays a labelled control because it's the primary action.
- **anti-slop:** took the decorative pill borders and amber fill off status metadata (failing,
  background check, update). Kept structure: the header's own border and the Scan split button.
- **spacing:** 4px inside the scan cluster, 12px between groups (update, scan cluster, keyboard),
  on the 4/8pt grid. The update dot moved onto the icon's corner so the icon-only state stays square.
- **loaders:** a running scan or check shows its progress inline on the control (ring + percent),
  with no extra spinner. The update's waiting state keeps its inline spinner on the button.

## Screenshots

Taken with demo data from `scripts/design/demo-data.ts` on a scratch server (127.0.0.1:5391,
mocked `/api`, no real data). The header is cropped at 2x.

- `1-busy-1280-light.png`: update ready + 2 failing + background check pausing at 74%
- `1b-busy-1536-light.png`: the same at 1536px (full "Update to 0.7.10")
- `2-idle-1280-light.png`: idle, update ready, "Last scan 2h ago"
- `2b-idle-no-update-1280-light.png`: idle, no update
- `3-busy-1024-light.png`, `3b-idle-1024-light.png`: 1024px
- `4-busy-1280-dark.png`, `4b-idle-1280-dark.png`: dark mode

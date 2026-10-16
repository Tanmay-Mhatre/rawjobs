# Radar toolbar + job footer (2026-10-15)

Status: mockups on the canvas (row "Toolbar + job footer — 3 options",
https://claude.ai/artifact/SavyR2gnvbJEtYsQViv11T). Awaiting the user's pick and go.

## Why it looks wrong (root causes)

| What you see | Cause | Where |
| --- | --- | --- |
| Tabs cut off at "A…" | One no-wrap row. The tabs are the only part that shrinks, they scroll sideways with no scrollbar, and the edge fade only shows on phones. Six built-in tabs (All, My companies, New, Strong, Saved, Applied), plus Save view, a 256px search, sort and Filters, need ~1100px. | `radar/RadarPage.tsx:413-460`, `radar/ViewsBar.tsx:8-15`, `bundle.css:123,316` |
| ⋯ on its own second row; footer 112px tall | The footer wraps. "Apply at jacqbennettconsulting" (~285px) + Save with key chip + Not interested with key chip + ⋯ is ~640px, wider than the ~598px inside the footer. The ⋯ is wrapped in a `div` by `Menu`, so the footer's icon-button rules never match it. | `bundle.css:253`, `JobDetail.tsx:510-569`, `primitives/Menu.tsx:93` |
| "jacqbennettconsulting" | `companyName()` only tidies names written all in capitals. A glued lowercase name with no slug word breaks or override stays as is. | `lib/format.ts:21`, `core/display-name.ts:83-118` |
| Everything cramped | The page is capped at `max-w-6xl` (1152px): the detail panel is ~646px at any window size. | `App.tsx:324`, `RadarPage.tsx:587` |
| Key hints only via `title` | No tooltip primitive. A native `title` is slow, never shows on keyboard focus, and can't show a key. | `primitives/Button.tsx:46` |

## What others do (research)

- **Notion:** tabs fold into "N more", and narrow widths become one view dropdown.
- **GitHub Primer UnderlineNav:** a priority-plus "More" menu.
- **Linear:** "Save view" appears only once the view changes, and sort sits under Display.
- **LinkedIn:** a plain "Apply" in the top card, with the company shown once above it. Actions sit at the top.
- **Gmail, Linear:** one labelled primary and icon secondaries with tooltips and keys.
- **Codex (Wikimedia):** button labels stay one line with an ellipsis and a tooltip.
- **Anti-patterns:**
  - Hard-clipped tabs with no menu.
  - Company data inside the main call-to-action, so it wraps.
  - Key chips inside every button.
  - Tooltips that only work on hover.

## Options (canvas)

- **A · Tidy, labels kept.**
  - Toolbar: 4 tabs (All, My companies, New, Strong) plus a "Views ▾" menu. The menu holds Saved and Applied (keys 5/6), your saved views and "+ Save current view…", with a dot when the view is unsaved. Search 240px, then sort + Filters together.
  - Footer: one row, 60px. Apply has an ellipsis; Save and Not interested keep their labels; key chips move to tooltips; ⋯ sits at the right.
- **B · Compact, icon actions.**
  - Toolbar: A's tabs; search becomes an icon that `/` opens; sort and filters sit in one "Display" pop-over with a filter count.
  - Footer: labelled Apply, with Save, Not interested and ⋯ as 36px icons with real tooltips that show the key.
- **C · View dropdown, actions up top.**
  - Toolbar: one "All 552 ▾" view menu, a wide search, sort and Filters, with quick view chips underneath.
  - Footer: none. Apply and the icon actions move into the job header (like LinkedIn), which shrinks on scroll. Phones keep a bottom bar.

## Recommendation

**A's toolbar + B's footer.**
- **Toolbar:** the least change for the most fix. Tabs never clip, and Save view stops taking room.
- **Footer:** one 60px row on every desktop width, with the primary still obvious.

Plus, in any option:
1. A `Tooltip` primitive, shown on hover and focus with a `Kbd` inside, replacing `title` in `IconButton` everywhere.
2. Fix the `Menu` wrapper, so the ⋯ trigger is styled as an icon button.
3. The Apply label truncates with "…" and shows the full name in a tooltip. Show plain "Apply" when the panel is narrow (container query).
4. Optional and separate: widen the page cap from 1152px to ~1440px, so the list and detail use big screens.

## Build plan (one PR, after go)

1. `Tooltip` primitive; `IconButton` uses it.
2. ViewsBar: 4 tabs; the Views menu always shows, holding Saved, Applied, your views and Save current view. Keys 1–6 are unchanged.
3. Toolbar spacing: search 240px; sort + Filters in one group, both 36px tall.
4. Footer:
   - Desktop: one row, no wrap, 12px padding; Save and Not interested as icon buttons with tooltips; the pressed state filled; the Menu wrapper fixed.
   - Phone: unchanged.
5. Tests and screenshots: 1440, 1024, phone and dark.

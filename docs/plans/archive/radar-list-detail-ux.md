# Radar list + job detail: UX review (2026-10-15)

Four reviewers (code trace, visual design, UX/interaction, accessibility) looked at the Radar split
pane: the job list on the left and the job detail with "Why it matched" on the right. Root causes
below were spot-checked against the code.

Status: Shipped through `radar-page-competitor-review.md` Phases 1-4 (PRs #243, #245, #246, #248 / v0.6.13). Design approved 2026-10-15. The build plan now lives in
`radar-page-competitor-review.md` (Phases 1-5); the PR list below is kept for reference and is
folded into those phases.

## Why the data looks wrong (root causes)

| What the user sees | Cause | Where |
| --- | --- | --- |
| Badge 83, breakdown 20 + 20 + 10 = 50 | With no topics, the score is 50 of 60 scaled to 100 (`why.scale = 100/60`). The breakdown shows raw points and never says it was scaled. | `packages/core/src/score.ts:111,116`; `primitives/ScoreBreakdown.tsx` |
| Only Title shows a max ("20/30"; "Place 20", "Industry 10") | The legend prints `/max` only when a part is not full. | `ScoreBreakdown.tsx:74` |
| "Remote, Remote · Remote" / "Remote · Remote" | Factorial joins office + "Remote" even when the office is "Remote". The row and detail then append the workplace label again. | `connectors/factorial.ts:73`; `radar/JobCard.tsx:72`; `JobDetail.tsx:144-147`; `lib/format.ts:77-90` |
| "WISE INTEGRATION" in caps; detail shows a different name than the list | `displayName` has no case normalising. The detail uses raw `job.company`. | `core/src/display-name.ts`; `JobDetail.tsx:145` |
| Mixed dots in "Still listed · checked 3h ago" | A literal " · " inside one meta part, next to padded separators. | `JobDetail.tsx:153,190` |
| "Add a note" looks cut off | The body scrolls above a fixed footer, with no fade or bottom space to show more content. | `bundle.css:251-253`; `JobDetail.tsx:253,401` |
| Bookmark/X on only some rows | Shown only on hover/focus. The narrow-pane container query doesn't repeat the always-show rule. | `bundle.css:191-201`; `index.css:154-180` |
| Source on its own line, tall rows | Container query below 560px puts `.rj-row__side` on a third line. | `index.css:154-180` |
| "Your industry" on some rows only | The tag needs a known industry match. The score gives 10 or 5 points without one, so tag and score disagree. | `RadarPage.tsx:347`; `score.ts:148-149` |
| A remote job with "(EU only)" scores 67 for a UAE user | Bare "Remote" scores +15 for place. Region limits in the title are never read. | `score.ts:333-359` |

## Plan: 4 PRs, in order

### PR 1: show the data right (P0)

1. Breakdown always shows `earned/max` (Title 20/30 · Place 20/20 · Industry 10/10).
2. Add a total line: "50 of 60 points → 83 (no topics set, so title, place and industry make the
   whole score)". It replaces the current footnote.
3. Copy:
   - Replace "Strong match. Threshold 70." with "Strong match, above your 70 cut-off" (70 links to
     Settings › Matching).
   - Move "the boost halves every 3 days" out of the score panel and into the Best match sort
     tooltip.
4. Dedupe places: skip the workplace label when the place already says it, and dedupe the
   comma-split place list. Fix the Factorial join at the source.
5. Use `displayName` in the detail too. Title-case company names that are all caps. Trim stray `_`
   in titles (wording unchanged).
6. Meta line: separate parts instead of literal " · ". Split into two lines: facts (company · place ·
   type · level) and freshness ("First seen Oct 15 · still listed, checked 3h ago").

### PR 2: list rows (P1)

1. Rows become 2 lines: source and age join the meta line ("Leading Edge · Dubai · Manatal 3h"),
   about 40% more jobs per screen.
2. "Your industry" becomes plain secondary text, not a bordered box (it looks like a button). Only
   show it when the industry actually matched.
3. Always show row actions on the selected row, and in the narrow container query.
4. Warnings ("Closed", "May be stale", failed filter) go first in the meta, so the ellipsis never
   hides them.
5. The new-job dot goes neutral, so orange means only Apply.

### PR 3: detail panel (P1)

1. Add a "Key facts" row under the title: Salary · Workplace · Seniority · Posted · Visa. Show
   "Not listed" when unknown instead of hiding the fact.
2. "Why it matched" starts folded (check why it opens in the screenshots). Put each check on the
   same line as its bar label. Make the bars taller with a wider gap so the parts read separately.
3. Drop the source and age from the detail header; they're already in the list row.
4. Status: a segmented control for Saved › Applied › Interviewing › Offer › Rejected. "Not
   interested" becomes a separate quiet button.
5. Footer:
   - Primary button "Apply at Leading Edge", with the ATS name in the tooltip.
   - Then Save (or Mark applied: see open question 1).
   - A ⋯ menu holds Add company and Copy.
   - Make `s` toggle the same way in the list and the detail.
6. Add a bottom fade on the scroll body and extra bottom padding so the last row never looks cut
   off.

### PR 4: accessibility (P1/P2)

1. Detail pane: `<section aria-label="Job details">`, and a polite live region announcing
   "Showing <title>" on selection.
2. Status control: `role="radiogroup"` / `aria-checked` (it is single-select today, announced as
   toggles).
3. Unpressed chip border to `--border-control` (3:1).
4. Check phone (375px) and dark mode with screenshots.

Already fine (no work): badge contrast in both themes, score not colour-only, bar chart
`role="img"` label, focus rings, reduced motion.

## Decisions (2026-10-15)

1. **Footer:** keep Save (`S`), add Not interested (`X`) next to it, and put Add company and Copy
   in a ⋯ menu.
2. **Score badge:** drop the square glyph everywhere. Show the number plus a band word (Strong /
   Fair) as the non-colour cue.
3. **Remote "EU only":**
   - Phase 1 shows it as an amber knock-out flag where `Eligibility` or the title says so.
   - Phase 4 makes it count against the score (a scoring change, with its own review).
4. **Status:** a compact dropdown with close reasons replaces the 6 chips and the segmented
   control.

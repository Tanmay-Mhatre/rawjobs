The score breakdown shows why a job scored what it did. It is the visual proof that RawJobs has no black box.

## Use
- `rj-breakdown` containing `rj-breakdown__bar` (four `rj-breakdown__seg`, each with an `<i>` scaled to the share earned via `transform: scaleX(earned / max)`), `rj-breakdown__legend` and an optional `rj-breakdown__why` line with matched keywords in `<mark>`.
- Segments are sized to their maximum points: title 30, place 20, keywords 40, industry 10. The parts come from `scoreParts` in `apps/web/src/components/primitives/ScoreBreakdown.tsx`, which builds the grid from them, so it isn't always four segments of 100:
  - With no keywords in the profile there is no keyword segment: three segments (60 points), which the scorer scales to 0..100.
  - A job scored before the industry part existed shows "Fresh" (freshness, out of 10) in its place until the next scan.
- The segments show points before that scaling and before anything the scorer takes off afterwards (years short of the must-haves, dealbreakers), so they don't always add up to the score. The full rules are in `packages/core/src/score.ts`.
- The bar gets `role="img"` and an `aria-label` that reads every value; the legend is `aria-hidden`.

## Rules
- Earned share fills in `breakdown-fill` over `breakdown-track`, and each segment carries a 1px `breakdown-track-border` outline so the unearned share reads at 3:1. Square segments, 4px gaps.
- Matched keywords use `accent-subtle` behind `accent-text`; this is one of the few places the accent appears as text.
- When filling on open, scale from 0 over `duration-base` with `ease-enter`; skip it under reduced motion.

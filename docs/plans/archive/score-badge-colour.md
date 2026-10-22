# Score badge colour: amber means caution only

Status: Shipped, option A (PR #257 / v0.6.14).

## Problem

The fit-score badge (`apps/web/src/components/primitives/ScoreBadge.tsx`) fills the Fair band with
`--score-fair-bg`, an alias of `--warning-solid` (amber). Amber also marks every caution in the app:
"May be stale", dealbreakers, "Failed your … filter", missed gaps in the reason line, "Applied, follow
up now". So a Fair row reads like a warning, and a Fair row with a stale label shows amber twice
for two different things.

Since PR #254 every Radar row carries a reason and a gap line (`FitReasons` in
`apps/web/src/components/radar/JobCard.tsx`). The "why" lives there now, so the badge only needs to
say how good the match is.

Goal: one meaning per colour. Green = strong match. Amber = caution. Everything else neutral.

## What changes in every option

- Only the component tokens in `apps/web/src/design/tokens.json` (`score-fair-bg`, `score-fair-fg`,
  `score-fair-estimated`, plus a new `score-fair-border`), recompiled to `tokens.css`, and the
  `.rj-score--fair` rules in `design/components/bundle.css`. No component logic changes.
- The band word stays under the number in the list and the drawer (`word` prop), and the
  `aria-label` still says "Fair match, score 58". So the band never rests on colour alone.
- The `ScoreBadge` README and previews are updated to match.
- Amber stays exactly where it is on warnings. Strong and Weak stay as they are.

## Options

Mockup (light and dark, real tokens and `bundle.css`): badges plus three sample Radar rows with
amber warnings next to them. Screenshot sent in the session.

### A. Neutral fill for Fair (recommended)

| Band | Look |
|---|---|
| Strong | green fill (unchanged) |
| Fair | neutral fill `bg-active`, `border-control-hover` edge, `text-primary` digits |
| Weak | outline only (unchanged) |
| Fair, estimated | dashed `border-control-hover`, `text-primary` digits, no fill |

- Three clearly different shapes: solid colour, solid grey, hollow. The step from Fair to Weak is
  fill vs no fill, not a colour.
- Green keeps one meaning, amber keeps one meaning, grey says "neither".
- Contrast: digits 14.1:1 (light) and 13.0:1 (dark). The grey fill itself is quiet (1.3:1 against
  the row), which is the point: Fair should not shout.

### B. Green ramp: tint for Fair

| Band | Look |
|---|---|
| Strong | green fill (unchanged) |
| Fair | pale green fill `success-subtle`, `success-text` digits |
| Weak | outline only (unchanged) |

- Reads as "a bit good", one hue doing a scale.
- Downsides: green now means two things (strong and fair), and the estimated Fair badge (dashed
  green) is nearly the same as estimated Strong. In dark mode the tint is very dark and the badge
  sinks into the row.
- Contrast: digits 5.2:1 (light), 10.3:1 (dark).

### C. Only Strong is filled

| Band | Look |
|---|---|
| Strong | green fill (unchanged) |
| Fair | outline `border-control-hover`, `text-primary` digits |
| Weak | lighter outline `border-default`, `text-secondary` digits |

- Calmest list: only the jobs worth a look have colour.
- Downside: Fair and Weak differ only by how dark the outline and digits are, so at a glance the
  list reads as two bands, not three. The word does the work.

### Dropping the band word in the list

Considered and not recommended: with the word gone, A and C rely on fill or weight alone, and the
reason line is about the job, not the band. Keep the word.

## Recommendation

Option A. It removes amber from the score without moving green, keeps three distinct shapes, and is
a token-only change.

## Checks when built

- `pnpm check` (includes the token compile test and the design lint).
- Screenshots in the built-in browser with a scratch `RAWJOBS_HOME`: Radar list and job detail, light
  and dark.

## Build notes

- The mockup used a `border-default` edge. In the app the selected Radar row is filled with
  `bg-active`, the same as the Fair fill, so on that row the badge turned into a faint outline. The
  edge is `border-control-hover` instead: 2.8:1 or more against `bg-active` in every theme, and
  darker than Weak's `border-control` outline, so Fair and Weak stay apart on a selected row.
- A stronger fill (`border-subtle`) was ruled out: in the high-contrast dark theme the digits drop to
  3.2:1 on it. On `bg-active` they stay at 13:1 or more in all four themes.

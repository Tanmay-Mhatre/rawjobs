Loading states match how long the wait is, and say what is happening.

## Use
- Under 100ms: show nothing. Up to 1s: keep the old content and dim nothing.
- First load of the feed (1 to 10s): `rj-skel` bars (`skeleton-bg`, shimmer `skeleton-shine`) shaped like real rows inside an L1 panel with `aria-busy="true"`.
- A scan longer than 10s: `rj-progress` with one row per hiring system (`rj-source` name, `progress-track` with a `progress-fill` scaled by `transform: scaleX()`, and a `41 / 120` count, shortened from 10,000 up: `142 / 12.2K`). Up to five rows (three on phones); finished rows fold into an `rj-progress__done` line ("3 hiring systems done") and the rest open with a "Show all" button into `rj-progress--scroll`. Short lists show every row in place, finished ones marked `data-done`.
- Total not known yet (a scan starting): `rj-progress__track--sweep`, a short bar that sweeps across the track every 1.6s so it never looks stuck; under reduced motion it stands still as a faint full-width bar. `rj-progress__track--paused` greys the fill while a scan is paused.
- While a scan starts: `rj-steps`, an `<ol>` of `rj-steps__step` items with `data-state` `done` (a check in `success-text`), `now` (a spinner, label in 500) or `todo` (a hollow `rj-steps__dot`, label in `text-disabled`). Each step has an `rj-steps__label`, an optional `rj-steps__detail` line and an `rj-steps__time` (how long it took, in tabular figures). Screen readers hear the state after the label (": done", ": in progress", ": next").
- While a scan runs: an `rj-pulse` dot (6px, `success-solid`, fading every 1.6s) before "Last checked Stripe · 2s ago". `rj-pulse--off` is the still, grey version.

## Rules
- No spinners on the feed; a spinner only marks the scan step being worked on. No percentages without counts; show the real numbers.
- Only things that show work in progress loop: the 1.4s shimmer, the progress sweep, the pulse and spinners. They are the documented exception to the four durations, and the shimmer, sweep and pulse stop under reduced motion.

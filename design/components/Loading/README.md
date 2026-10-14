Loading states match how long the wait is, and say what is happening.

## Use
- Under 100ms: show nothing. Up to 1s: keep the old content and dim nothing.
- First load of the feed (1 to 10s): `rj-skel` bars (`skeleton-bg`, shimmer `skeleton-shine`) shaped like real rows inside an L1 panel with `aria-busy="true"`.
- A scan longer than 10s: `rj-progress` with one row per hiring system (`rj-source` name, `progress-track` with a `progress-fill` scaled by `transform: scaleX()`, and a `41 / 120` count, shortened from 10,000 up: `142 / 12.2K`). Up to five rows (three on phones); finished rows fold into an `rj-progress__done` line ("3 hiring systems done") and the rest open with a "Show all" button into `rj-progress--scroll`. Short lists show every row in place, finished ones marked `data-done`.

## Rules
- No spinners on the feed. No percentages without counts; show the real numbers.
- The 1.4s shimmer is the one documented exception to the four durations: it is the only looping animation in RawJobs and stops under reduced motion.

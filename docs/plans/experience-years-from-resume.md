# Years of experience from the résumé

PR #259 added `experience_years`: jobs whose must-haves ask for more than a year beyond it rank
lower. Today the user must type it in Settings → Roles → More options, so most leave it empty and
the years check stays "unknown". This suggests the number from the résumé, the same way titles and
seniority are suggested. Rules only, no AI.

## Core: `experienceYearsFromResume(text, now)` (packages/core/src/employers.ts)

- Reads only the Experience section, with the same section bounds `rolesFromResume` uses
  (`employers.ts`), so Education, Projects and Volunteering dates don't count.
- Finds date ranges on role lines: `Mar 2018 – Jun 2021`, `March 2018 to Present`, `03/2018 – 06/2021`,
  `2018 – 2021`, `2021 – Current/Now/Today`. A year without a month reads as January; a range inside
  one year (`2020 – 2020`) counts 6 months.
- `Present` / `Current` / `Now` / `Today` = `now` (passed in, so tests are fixed).
- Skips: ranges on internship lines (`intern`, `internship`), end before start, start in the future,
  spans over 50 years. An end after `now` is cut to `now`.
- Merges overlapping and touching ranges before adding them up, so two jobs at once (or a side
  role) never count twice; gaps between jobs don't count.
- Result: `{ years, roles }` with `years` = total months / 12, rounded to the nearest whole year, or
  `undefined` when no range is found or the total is under 1 year.

## Suggestions (apps/web/src/lib/suggest.ts)

- `Suggestions` gets `experience: { years, roles } | null`, from the résumé text
  whether or not an AI profile is present (the AI profile has no years field).
- `prefillDraft` does **not** fill it: the number is never saved without the user's click.

## UI (apps/web/src/setup/RolesStep.tsx, Years of experience field)

- When there's a suggestion and the field doesn't already hold it: a line under the field,
  "From your resume: about 7 years across 4 roles, gaps left out." with a **Use 7** button that fills
  the field. Same field in setup and in Settings → Roles (both render `RolesStep`).
- The collapsed More options summary shows `7 years from resume?` when the field is empty, so the
  suggestion is seen without opening the section.
- When the field already matches: no line.
- The field's example placeholder ("6") is hidden while a suggestion shows, so it isn't mistaken for a value.

## Tests

- Core (`packages/core/test/employers.test.ts`): overlapping and nested ranges merge; `Present` uses `now`;
  gaps not counted; Education dates ignored; internship skipped; month and
  `MM/YYYY` formats; no ranges → `undefined`.
- Web (`apps/web/test/experienceYears.test.tsx`): `buildSuggestions` carries the number; `prefillDraft` leaves `experienceYears` alone;
  RolesStep shows the line and **Use** fills the field.

## Release note

Improved: Settings → Roles suggests your years of experience from your resume; one click to use it.

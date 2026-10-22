# Fix it from "Why it matched" (inline correction)

Status: Shipped (PR #258 / v0.6.14). From the 2026-10-15 scoring review (`docs/plans/archive/scoring-review.md`): only
Indeed lets you correct a wrong inference where you see it. RawJobs now says why each check passed or
not (`job.why.checks`, PR #254), so the next step is a one-click fix beside the checks that are wrong
because your profile is incomplete.

## What you see

Beside an unknown or missed check in "Why it matched", a small underlined text link. It shows in the
folded pills and in the open checklist.

| Check | When | Fix | What it does |
|---|---|---|---|
| Visa | unknown ("Doesn't say if it sponsors visas") or missed ("No visa sponsorship, and you need one for Germany") and the job is in exactly one country | **I can work in Germany** | Adds `germany` to `work_authorization`, saves |
| Pay | unknown ("Pay not listed", "Pay in USD, your floor is in EUR") or missed (below the floor) | **Change pay floor** | Opens Settings › Profile › Dealbreakers (`settingsHash("dealbreakers")`) |
| Level | the level check is missed and the title names a level word ("Lead", "Director") | **Count Lead roles** | Adds that word (`lead`) to `seniority_boost`, saves |

After a save, a toast: "Added Germany to where you can work. Scores update on the next scan." (or
"Lead roles now count as your level. …"). The score on screen does not change until the next scan,
which is what the toast says. The button then hides (the profile now has the value).

No button when the fix can't be made from the job alone:

- Visa with no single country (remote anywhere, several countries).
- Level for a mid-level title: it has no level word to add ("Product Manager"), so nothing would count it.
- Level on scores from before PR #254 (no `checks`): their level can't be read reliably.
- The demo, someone else's radar, or setup not finished: the same rule as the Radar's "Save to my
  profile" (`canRunLocally && personal && setupState === "configured"`).

## Mockup

Folded (default):

```
[72 Good]  Why it matched                                   [Show breakdown v]
           Good match, above your 60 cut-off.
 (v Title 25/30) (v Place 20/20) (v Topics 18/40)
 (x Lead: not near your level · Count Lead roles)
 (? Doesn't say if it sponsors visas · I can work in Germany)
 (? Pay not listed · Change pay floor)
```

Open:

```
 v  Title matches product manager, not near your level   Count Lead roles
 v  In one of your places (Germany)
 v  Mentions your topics: payments, growth
 ?  Doesn't say if it sponsors visas                      I can work in Germany
 ?  Pay not listed                                        Change pay floor
 v  In one of your industries: Fintech
```

The fix is an underlined text link (the same style as the "keyboard shortcuts" link), never a filled button: the check is the
content, the fix is a side action. While saving it shows "Saving…" and is disabled; on error the toast
shows the server's message.

## How it's built

- **`apps/web/src/lib/profileFix.ts`** (new, pure): `fitFixes(job)` returns the fixes for a job
  (a word to add to `workAuthorization` or `seniority`, or the settings section to open) from
  `job.why.checks`, `job.countries` and the title's level word (`seniorityCue`). Unit-tested.
- **Saving**: a small context, `ProfileFixProvider`, set up in `App.tsx` next to
  `saveProfileFromRadar`, giving `add(field, value) => Promise<string | null>`: `saveConfig(draftToConfig({
  ...saved, ...patch }))`, then `setup.refresh()`. It does not start a scan (unlike "Save to my
  profile"), so you can fix several things and let the next scan re-score once. A context, not a prop,
  so `RadarPage.tsx` stays untouched (PR #255 is changing it).
- **`JobDetail.tsx` › `WhyItMatches`**: reads the context; when it's there, each item that has a
  fix gets the link-button. The patch merges with the saved list (`[...saved.workAuthorization,
  "germany"]`), never replaces it.
- No change to `packages/core` or the scorer. No AI.

## Tests (`apps/web/test`)

- `profileFix.test.tsx`: visa unknown/missed in one country → fix; remote or many countries → none;
  already authorised → none; pay unknown/missed → link; level missed with "Lead" → `lead`; mid-level
  → none; no seniority words → none.
- same file, rendered: the fix renders in the pills and the open list; click calls the context
  with the merged patch and shows the toast; no context (demo) → no buttons.

## Not in this PR

- Re-scoring on the spot. The score comes from the scan; a local re-score would disagree with the
  saved file until the next scan. Possible later.
- Undo in the toast. The setting is one click away in Settings.
- Fixes for title, place, topics and industry ("Add this title", "Add this topic"): different
  flows, each its own decision.

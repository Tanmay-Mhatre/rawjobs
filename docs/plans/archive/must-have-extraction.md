# Must-have extraction (matching phase 3)

Status: Shipped (PR #259 / v0.6.14). "As built" below records where tuning moved the plan.

Read what a posting requires (must-haves, nice-to-haves, years of experience) with plain rules, and let the
score use it. No AI in the app. Open models (TechWolf ConTeXT, ESCO) stay a later option for the offline
directory pipeline only.

## Baseline (main at de0e167, `pnpm eval:match`)

| Metric | Now | Gate |
|---|---|---|
| NDCG@10 (mean) | 0.926 | stay at or above 0.906; aim to keep 0.926 |
| NDCG@5 | 0.915 | report |
| Spearman | 0.692 | report |
| Ties (top 50) | 0.013 | no worse than the baseline gate |
| Ties, no topics | 0.037 | no worse than the baseline gate |
| Same band | 278 / 294 | report |

The eval has 49 postings, 44 with a description. All 44 use a must heading ("Requirements", "What we're looking
for", "You have", "What you'll need"…), 17 a nice heading ("Nice to have", "Preferred", "Bonus points").

Worst miss the rules can fix: `ml-ds/ml-05` Staff Applied Scientist scores 83 against label 1 ("10+ years
post-PhD required; she has 4"). The scorer can't see years today.

## 1. Reading: `packages/core/src/posting.ts`

New `extractRequirements(text)`:

```ts
type Requirements = {
  must: string[];        // must-have lines (bullets or sentences)
  nice: string[];        // nice-to-have lines
  years?: { min: number; max?: number; line: string }; // highest minimum asked in the must lines
  structured: boolean;   // a must or nice heading was found
};
```

- **Headings**: a short line (under ~60 chars, no full stop, optional trailing colon) that names a section.
  - must: requirements, (minimum / basic / required) qualifications, what you'll need, what we're looking for,
    you have, you bring, what you (will) bring, who you are, about you, your profile, must have, essential
  - nice: nice to have, bonus (points), preferred (qualifications), plus, extra credit, ideally
  - any other heading ("What you'll do", "Benefits", "About us") ends the section
- **Cue words** in a line (outside sections, and to move a line inside a must section to nice):
  - nice: "is a plus", "a bonus", "nice to have", "preferred", "ideally", "desirable"
  - must: "must", "required", "minimum", "essential", "at least"
  - Nice cues win on the same line ("SQL is a plus" in a must section is nice).
- **Years**: "5+ years", "3-5 years", "at least 5 years", "minimum of 5 years", "five years", "5 yrs".
  Only in must lines (or anywhere when there's no structure and the line has a must cue). The highest
  minimum wins, capped 1-25. "Founded 10 years ago", "a 2-year contract" don't count: the line must say
  experience, or the years must be followed by "of" / "in" / "experience".
- Conservative like the rest of the file: unclear wording gives nothing.

## 2. Scoring: `packages/core/src/score.ts`

- **Where a topic is mentioned** (new, on top of mention strength):
  - title or a must line: full weight
  - only in nice lines: 0.5 of its weight (`POINTS.niceOnly`)
  - elsewhere (responsibilities, unstructured text): full, as now
- **"N of M must-haves"** in `why.musts = { met, of }` and a `why.checks` entry `{ id: "musts" }`:
  - M = must lines that name a skill the scorer knows (your topics, your industries' topics, any catalog
    industry topic), plus the years line. Lines with nothing checkable ("strong communication") aren't
    counted: unknown, never shown as missed.
  - N = those lines naming one of your topics, plus the years line when you have the years.
- **Years** via a new optional profile field `experience_years` (number):
  - `why.checks` gets `{ id: "experience" }`: met at or above the minimum, near one year short, missed further.
  - Missed takes the level points down one step (10 to 5, 5 to 0); near takes nothing. Not a dealbreaker.
  - No field set: unknown, no points move. Eval profiles get it from their `about` text.
  - Filling it from the résumé is a follow-up (not in this PR).
- **The 80 ceiling** on jobs with no description: today topics come only from the title (cap 20), so the
  most such a job gets is 80, and one with no topic word in its title tops out at 60, under every cut-off.
  Change: no description means topics are unknown, so they count as half the bar (20, like an unknown
  industry), and topic words in the title add up to 10 more. Max 90, still under a described job that
  meets everything (100), in line with the eval's "title-only caps at 3" rule. `why.estimated` already
  says the score is from title, place and industry.

Each part goes in as its own commit and is measured with `pnpm eval:match --compare`; a part that drops
NDCG@10 or raises ties past the gate is tuned or left out. Accepted state: `pnpm eval:match --json`.

## 3. Showing it

- `ScoreBreakdown` gains `musts?` and `FitCheck.id` gains `"musts" | "experience"`.
- Job detail "Why it matched": the musts and experience checks show next to pay and visa (one line each,
  e.g. "Names 3 of 4 must-haves you can check", "Asks for 10+ years; you have 4"). Unknown stays muted.
- No list-row change (RadarPage.tsx is in PR #255).

## Tests

- `requirements.test.ts`: headings, cue words, years forms and the false friends ("founded 10 years ago").
- `score.test.ts`: must vs nice weight, N of M, years check and level step, the no-description score.
- Eval before/after numbers in the PR.

## Not in scope

- Level from the description ("you'll manage a team of 4"), domain lock-in ("5+ years in construction
  chemicals"): next rules pass, or ConTeXT/ESCO in the directory pipeline.
- Files PR #255 touches: `learn.ts`, `filters.ts`, `RadarPage.tsx`.

## Decisions (2026-10-16)

1. `experience_years` goes on the profile, set in Settings → Roles → More options. Résumé fill is a follow-up.
2. No-description jobs: unknown topics count part of the bar.

## As built

| Metric | Before | After |
|---|---|---|
| NDCG@10 | 0.926 | 0.922 |
| NDCG@5 | 0.915 | 0.921 |
| P@5 | 0.500 | 0.533 |
| Spearman | 0.692 | 0.692 |
| Ties | 0.013 | 0.013 |
| Ties, no topics | 0.037 | 0.032 |
| Same band | 278 / 294 | 284 / 294 |

- No description: 15 for unknown topics, not 20, plus up to 10 for title topics (max 85). At 20 the three
  title-only postings (label 3) jumped described label-4 ones; at 10-12 ties rose past the gate.
- Years: missed also takes 3 points a year past the first year short, at most 10 (`why.yearsGap`), on top
  of the level step. The level step alone moved `ml-05` only 83 to 78; now 68. At 2.5 a year a new tie
  appeared in finance-analyst.
- With no topics of your own there are no must-haves to count (`why.musts` is left out). Broad industry
  topics ("strategy", "quality", "engineering") don't make a line checkable.
- The years line isn't one of the M must-haves: it has its own `experience` check, so it isn't counted twice.
- Lines are read a sentence at a time, and only a clause after ", ideally" / "; … is a plus" is nice
  ("5+ years in research, ideally in B2B SaaS" stays a must-have).
- The small NDCG@10 drop is the title-only lift: `fin-07` (label 3, no description) now sits above
  `fin-03` (label 4), whose description says "forecasts" and "budgets", which the topic match doesn't
  read as "forecasting" and "budgeting". Word forms are a separate fix.

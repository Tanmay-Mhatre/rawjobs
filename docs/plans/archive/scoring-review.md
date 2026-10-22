# Fit score review (2026-10-15)

Status: Shipped (PR #254, then on-device learning D in PR #255 / v0.6.14). PR 1 was built as one PR (scorer v2 + list reasons + detail checks + eval tie metrics).
Kept the 100/60 scale for profiles with no topics (dropping it would put every such job under the cut-off);
spread now comes from title focus and topic strength instead. On-device learning (D) is the next PR.

Team: code audit, competitor scan, ranking science, product design.

## What's wrong today

The score is built in `packages/core/src/score.ts` (weights `POINTS` L8-28, `scoreJob` L68-120). It adds:
- title (20, 25 or 30: title match plus a seniority bonus)
- location (15 or 20)
- topics (0-40)
- industry (0, 5 or 10)

The band comes from `ScoreBadge.tsx` (Strong at or above the threshold, Fair from 40, Weak below).

1. **The numbers cluster by construction.** Every part except topics moves in steps of 5.
   - With no topics in the profile, the raw score (max 60) is scaled by 100/60.
   - So only 58, 67, 75, 83, 92 and 100 are possible. That is exactly the 58/67/75 seen on the Radar.
   - Topic points fall into about 12 steps. Jobs with no description hit a ceiling of 80.
2. **The score reads nothing from the requirements.** No must-haves, no years, no level from the description. Two jobs with the same title and city get the same score.
3. **The number hides why.** 67 can mean "perfect title, wrong city" or "OK title, no keywords".
   - The 100/60 scaling makes 50 points show as 83.
   - Dealbreakers clamp the score to `min(score/2, min_score-1)`. The list only shows a low number, and the reason is cut off at the end of the meta line.
4. **The colours send mixed signals.** Amber means "caution" elsewhere (stale, dealbreaker, failed filter) but "medium" on Fair. "FAIR" in caps reads like a grade on the user.
5. **The defaults disagree.** The UI's `DEFAULT_THRESHOLD` is 65 and the schema's `min_score` default is 70 (`schema.ts:323`). The eval uses a third band rule ("good" means within 20 of the cut-off).
6. **The eval can't see any of this.** NDCG@10 0.919 rewards order, not resolution. 263 of 294 pairs are weak/weak, and there is no metric for ties or spread.

## What competitors do

| Product | Shows | Lesson |
|---|---|---|
| LinkedIn | High/Med/Low word + "X of Y required qualifications" + gaps | "X of Y musts" copy is checkable and trusted. Its badge and detail sometimes contradict each other (avoid). |
| Indeed | Per-requirement checklist, green when met | Only one with **inline correction**: "I have this: Yes/No/Skip" updates the profile and re-scores. |
| Jobright | Match % on cards; skills / level / industry / preference breakdown in detail | Breakdown builds trust. % still felt inflated (80-90 on fits). |
| Jobscan / Teal / Simplify / Huntr | Keyword match %, found vs missing | Publishes its weighting (Jobscan). Exact-keyword match leads to stuffing (avoid). |
| ZipRecruiter | Great / Good / Fair / Not a match | A "Not a match" tier lets people skip without guilt. Framed as hiring odds (avoid). |
| Otta / WTTJ, Hiring Cafe | No score: preference gates and filters | Hard preferences (pay, place, visa) are pass/fail, never blended into a %. |

Anti-patterns:
- implying interview odds
- paywalled or missing reasons
- hidden weights
- scores bunched high
- no way to fix a wrong inference

Sources are in the competitor report (LinkedIn help a7120158, Indeed support 32603395892109, jobright.ai/ai-job-match, help.simplify.jobs, Jobscan tutorial, ZipRecruiter press release 2021).

## Recommendation

### A. Split gates from fit
- **Must-haves** (place, level, pay, visa, residence) each get a status: met ✓, missed ✕, or unknown ?.
  - Unknown is never shown as met.
  - A miss is a flag on the job, not a clamp on its score, so jobs keep their order inside the group.
- **Fit** (title, skills, industry) is a graded score with continuous parts:
  - title similarity
  - seniority as a smooth level distance
  - skill coverage weighted by rarity (IDF over the scanned jobs), must-have skills apart from nice-to-haves
- Drop the 100/60 scaling. Show "scored on 3 of 4 parts" instead.

### B. Change what the list row shows
- Before: `[67 FAIR]`
- After:
  ```
  74  Senior Product Designer
      Wise · Dubai · 3h
      ✓ Title + level match   ? Visa unknown
  ```
- Small neutral number, no colour band.
- One best reason and one main gap or unknown. Colour only on the gap: danger for a dealbreaker, muted for unknown.
- Later, once there's enough data: "Top 10% today" (only when 30 or more jobs).

### C. Detail view becomes a "Fit checklist"
- Must-haves: one line each with status and evidence, quoting the posting next to the profile item.
- Fit: bars with earned/max and the found or missing skills.
- One line on how the score was made, and the cut-off.
- Indeed-style "I have this / I don't" on unknown items.
- Copy says "Fit to the posting, not your odds of an interview".

### D. Learn from the user, on-device
- Actions make preference pairs: save or apply versus a skipped job ranked above it. "Not for me" reasons count too.
- Fit a small pairwise logistic model over the sub-scores, regularised toward the default weights. It trains in milliseconds.
- Dealbreakers are never overridden.
- Show "Adjusted to your activity" with a Reset.

### E. Add to the eval gate
- Tie rate in the top 50: aim for under 5%.
- Score spread (IQR and histogram entropy).
- Distinct scores per 100 jobs.
- Must-have extraction recall.
- Band monotonicity: the save rate must rise from Weak to Fair to Strong.
- ECE once there is save/apply data.

## Proposed PRs

1. **Quick fixes.** Unify the 65/70 default. Show the dealbreaker reason first in the list. Copy line "fit, not odds". Add tie-rate and spread metrics to `pnpm eval:match`.
2. **Scorer v2** (matching phase 3): continuous title and level, IDF skill coverage, must-have vs nice-to-have extraction (rules first, then ConTeXT/ESCO). Gates become a status list. Remove the scaling and the 80 ceiling.
3. **List row B + detail checklist** (matching phase 4): reasons and gaps with severity, evidence quotes, inline "I have this".
4. **On-device personalisation** (matching phase 6): pairwise model, Reset, eval replay.

Open models only, with no paid LLM API (decision of 2026-10-10).

## Decisions for the user

- The list row moves from "number + band word" to "number + reason + gap". This changes decision 2 in `radar-list-detail-ux.md`.
- Keep the 0-100 number visible in the list, or show it in the detail view only?
- Run PR 1 now, separately from the rest?

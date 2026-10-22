# Matching eval set

A fixed, labelled set for measuring how well `scoreJob` ranks jobs for a person. Tests elsewhere check
hand-picked numbers; this checks the order a person would want. Run it before and after every scoring change.

Everything here is invented: the candidates, the companies and the postings. No real people, no copied postings.

## What's in it

| Path | What |
|---|---|
| `profiles/*.yaml` | Six candidates across role families. Each has a real RawJobs `profile` (what the scorer sees) and an `about` block: a short resume summary with level, work authorisation, salary floor and dealbreakers (what a labeller reads). The salary floor, work authorisation and dealbreakers are also in the `profile` as `salary_floor`, `work_authorization` and `avoid`, written from `about` the way the person would fill them in Settings, and so are their years of experience (`experience_years`). The rest of `about` (such as the domain they know) the scorer can't see. |
| `jobs/*.json` | 49 postings, grouped by family. Realistic noise on purpose: company boilerplate, requirements vs nice-to-haves, sponsorship lines, EEO footers. Includes hard cases: the same role at several levels, synonyms (k8s, Golang, ML, payment), keyword-stuffed wrong roles, right roles with a dealbreaker, title-only postings, and adjacent titles that fit. |
| `labels.yaml` | A 0..4 label, a one-line `why`, and `by` for every profile x posting pair (294). |
| `lib.ts` | Loads and checks the set, scores every pair, computes the metrics. |
| `run.ts` | The report (`pnpm eval:match`). |
| `baseline.json` | The last accepted report, with every pair's score. `test/eval.test.ts` fails if NDCG@10 drops more than 0.02 below it, or either tie rate rises more than 0.02 above it. |
| `archive/REVIEW.md` | The one-time form a person used to confirm or correct the in-field labels. Historical. |

## Rubric

The question behind every label: would this person, triaging their inbox, apply?

| Label | Meaning |
|---|---|
| 4 Strong | Would apply today: meets the must-haves, right level, no dealbreaker. |
| 3 Good | Worth applying: minor gaps only (a nice-to-have, one level below, adjacent domain, a key unknown). |
| 2 Stretch | Plausible but a real gap (a missing must-have, new domain, one level up without its must-haves). |
| 1 Poor | Same field but clearly wrong (domain-locked or wrong specialisation, far level, two real gaps). |
| 0 No | Not relevant, or a dealbreaker (different job, a stated dealbreaker, visa / location / salary blocker). |

Label by reading the profile's `about` and the full posting, never by looking at the score. The set exists to catch
where the scorer is wrong, so a label tuned to the scorer is worthless.

### Tie-break rules

Each fact about a pair gives a cap; the label is the lowest cap. Apply them in this order.

1. **Dealbreakers: 0.** Anything the candidate lists as a dealbreaker, including a specialisation (frontend,
   marketing-only design, credit risk, AP/AR, insurance sales, operations, agency, junior roles), a location or
   relocation they rule out, and "no sponsorship" for someone who needs it.
2. **Different job: 0.** The day-to-day work is another profession and the candidate's core skills aren't what it
   uses, whatever words the title or industry share (an IT business analyst for an FP&A analyst).
3. **Salary** (base, same period) against the stated floor, using the top of the posted range:

   | Top of range | Effect |
   |---|---|
   | at or above the floor (including ranges that straddle it) | no gap |
   | below the floor by up to 5% | real gap, cap 2: negotiable at a stretch |
   | below the floor by more than 5% | blocker, 0 |
   | no salary stated | no gap; judge the rest |

4. **Unknowns cap; they don't subtract and don't stack.**
   - A title-only posting (no description) caps at 3: the must-haves can't be checked. Lower it if the title itself
     shows a gap.
   - Sponsorship not stated, or only "for exceptional candidates", caps at 3 for someone who needs it.
   - A requirement the candidate's `about` doesn't mention (a language, a certificate) counts as not met.
5. **Level**, on the ladder junior < mid < senior < lead / staff < director / principal:

   | Posting's level | Effect |
   |---|---|
   | the candidate's level, or the next step they say they're ready for, with the must-haves met | no gap |
   | one level below | minor gap, cap 3 (0 if they rule out junior roles and it is one) |
   | one level up they aren't ready for, missing its level-defining must-haves (years, staff scope, managing people) | real gap, cap 2 |
   | two or more levels away, or required years at least double theirs | far, cap 1 |

   Having at least two-thirds of a stated years minimum is no gap at the right level. The requirements that define a
   level gap are that one gap, not extra ones.
6. **Function and domain.**

   | Case | Effect |
   |---|---|
   | same job, adjacent domain (the knowledge transfers; the domain is only a nice-to-have) | minor, cap 3 |
   | same job, new domain where domain knowledge is a must-have | real gap, cap 2 |
   | same job, but the domain is locked in as required years or a network in that domain | wrong specialisation, cap 1 |
   | adjacent function doing the same work under another name (DevOps / SRE for platform) | no gap |
   | adjacent function whose must-haves accept the candidate's function ("partnerships, alliances or B2B sales") | minor, cap 3 |
   | adjacent function whose must-haves need years in that function, which the candidate has done in part | real gap, cap 2 (not at all: cap 1) |

7. **Combining.** Any number of minor gaps stays 3 (three or more make it 2); two real gaps make it 1. A partly met
   must-have is a minor gap; an unmet one is a real gap. Exception: when the posting is a neighbouring function, the
   must-haves that define that function (its core years and work) are judged by rule 6, not here: done only in part is
   a real gap (cap 2).

## Running it

```
pnpm eval:match              # the report
pnpm eval:match --compare    # the same, with changes against baseline.json and the pairs whose score moved
pnpm eval:match --pairs      # also each profile's postings by score, next to their labels
pnpm eval:match --json       # write baseline.json (when a change is accepted)
```

The report shows, per profile and as a mean:

- **NDCG@5 / NDCG@10** of the score order, gain 2^label - 1. Equal scores are averaged, so ties never help or hurt.
- **P@5**: share of the top five labelled 3 or 4. Some profiles have fewer than five such postings, so 1.0 isn't always reachable; compare against the baseline, not against 1.
- **Spearman** correlation of score and label over all postings.
- **Band agreement**: the score's band from `min_score` (strong at min_score, good within 20 below, else weak) against the label's band (4-3 strong, 2 good, 1-0 weak), as a 3 x 3 table.
- **Ties** and **Ties (no topics)**: the share of pairs of matched jobs (score above 0) with the same score, with the profile as it is and with its topics taken out. Lower is better: it shows how finely the scores tell jobs apart.
- The **10 worst disagreements**: score / 25 furthest from the label, with the label's `why`.

When a scoring change makes the order better, run `--json` and commit the new `baseline.json` with it.

The current numbers are in `baseline.json` (`overall`), so they are not repeated here. Dealbreakers (0.4.0) were the first big step: they cut the label 0-1 pairs scoring in the strong band from 15 to 2. Since then the scorer also reads a posting's must-haves and the years it asks for (`packages/core/src/score.ts`: must-haves you can check, and `yearsGap` against `experience_years`).

## Adding pairs

- A **posting**: add it to a `jobs/*.json` file with a new id (`title`, `company`, `industries` if known,
  `location`, `workplace`, optional `salary`, `postedAt`, `description`). Then label it for **every** profile in
  `labels.yaml`: the test fails on any unlabelled pair.
- A **profile**: add `profiles/<id>.yaml` with `id`, `summary`, `about` and `profile`, and a block for it in
  `labels.yaml` with a label for every posting.
- Write labels before running the scorer on the new pairs, then rerun `--json` to refresh the baseline.

## Who labelled what

`by: draft` labels were written by Claude from the first, looser rubric, before the scorer was run; they are all
"different job" zeros now. `by: reconciled` labels (the in-field pairs) were re-labelled under the tie-break rules
above, after a blind second labeller who never saw the drafts labelled the same pairs: where the two disagreed, the
rules were sharpened until the case had one answer, and the pair was labelled again from the profile and posting.
When a person confirms or corrects a label (the first round used `archive/REVIEW.md`), set its `by: user` and change the label if needed. The
report counts reconciled and person-reviewed pairs.

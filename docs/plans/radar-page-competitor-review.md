# Radar page: competitor review and what to show (2026-10-15)

Status: **design approved 2026-10-15** (board "Recommended" on the mock canvas
https://claude.ai/artifact/SavyR2gnvbJEtYsQViv11T). The UX fixes in `radar-list-detail-ux.md` are
folded into the phases below.

Progress:
- Phase 1 shipped in PR #243.
- Phase 2 shipped in PR #245.
- Phase 3 shipped in PR #246.
- Phase 4 is the PR that adds this line.
- Phase 5 waits for the user's go.

## The team

| Role | Looked at |
| --- | --- |
| Competitor researcher: big boards | LinkedIn Jobs, Indeed, Glassdoor, Google Jobs, Naukri, Bayt |
| Competitor researcher: AI match | Welcome to the Jungle (Otta), Simplify, Jobright, Levels.fyi, Built In, Wellfound, Hiring Cafe, Teal |
| Competitor researcher: trackers | Teal, Huntr, Simplify tracker, Careerflow, Eztrackr, Notion/Airtable templates |
| Data engineer | What RawJobs really has per job and per connector (so we only propose feasible fields) |
| User researcher | Jobs-to-be-done for a senior product job seeker in the UAE/remote, with survey evidence |

Caveats:
- Several competitor pages blocked fetching (Teal, Hiring Cafe, Jobright). Items the team couldn't
  verify are left out or marked as such.
- No live interviews were run. The persona findings are hypotheses backed by surveys (SHRM/LinkedIn,
  Indeed, iHire, Tiger Recruitment MENA, NN/g).

## What the page has to do, in order

1. **Triage the list fast.** Which few of 534 jobs deserve a click?
2. **Decide on one job.** Is it real, senior enough, paid enough, can I legally take it, and is it
   fresh?
3. **Act.** Apply, save or dismiss, then move to the next job.
4. **Track.** Status, dates and notes over the following weeks.

Today the page puts tracking (6 status buttons) and score maths ahead of the decision facts. The
description is in the panel, but below the fold, so users think it is missing.

## Report card: what we show today

| Element | Verdict | Why |
| --- | --- | --- |
| Transparent score with points per part | **Good: our edge** | Competitors use opaque ML percentages (Jobright) or hide the explanation behind a paywall (LinkedIn Premium, Teal). Keep rule-based points, free and local. |
| "Still listed · checked 3h ago" | **Good** | Matches Simplify's "verified live", which seekers value (about a third of listings are 30+ days old). Say it once, clearly. |
| "Did you apply?" prompt on return (`ApplyPrompt.tsx`) | **Good** | Same as Simplify's prompt. Never auto-mark Applied. |
| Keyword-highlighted description, copy, reader | **Good, but hidden** | It sits below status and notes. Move it up. |
| Visa sponsor register, hiring surge, reposted flags | **Good, but buried** | These are real differentiators, but they only show inside the meta line. |
| `S` keyboard shortcut | **Good** | None of the competitors document status shortcuts. |
| Score badge | **Generic** | Three different jobs all read 83, so the number doesn't rank them. Add a band word and show misses (below). |
| Why it matched | **Needs work** | Takes about 40% of the panel to repeat the user's own filters. It shows only green checks, never misses: the 67 job that says "EU only" shows no warning. The boost/scale text is engine talk. |
| Title/meta line | **Needs work** | "Head, Director & VP" is a filter name. Remote appears twice. Freshness is said three times. Salary is shown only when an ATS gives it. |
| Source + age ("MANATAL 3h") | **Generic** | Seekers don't know ATS names. Keep the age, and put the ATS in a tooltip. |
| "Your industry" chip | **Needs work** | It is on almost every row, so it doesn't tell rows apart. Show the exception instead ("Outside your industries"). |
| 6 status buttons | **Needs work** | Tracking controls placed in the decision zone. Trackers use one pipeline control and log a date each time the stage changes. |
| Note | **Needs work** | Cut off at the fold, and a single blob of text. |
| Footer (Apply on Manatal / Save / Add company / copy) | **Generic** | Leads with the ATS name. "Add company" is a sourcing task competing with Apply. Not interested is missing (the list has it, the detail doesn't). |

## What competitors show that we don't (and whether we can)

| Signal | Who does it | Can we? |
| --- | --- | --- |
| **Salary always shown**: "Employer provided", "From description" or "Not listed" | WTTJ, Levels.fyi, Indeed, Glassdoor | **Yes.** 12 connectors give salary. `payOf()` (`posting.ts:162`) already reads pay from the description, but only the dealbreaker check uses it today. Never show estimates as if they were real figures. |
| **Eligibility up front**: visa, "EU only", must be resident in, relocation | Wellfound, Simplify, Jobright (H1B), Bayt | **Yes.** `Eligibility` (`posting.ts:172`) already reads sponsorship, authorised-in, resident-in, on-site-in and relocation. It is used only for dealbreakers. Add the remote-region check ("EU only") to the score too. |
| **Misses as well as hits** ("Potential gaps") | Jobright, Simplify, LinkedIn per-qualification | **Yes**, from the existing `why` + eligibility: "Seniority one level off", "Remote, but EU only", "No topic matched". |
| **Word verdict next to the number** (Strong / Good / Fair, or High / Medium / Low) | Jobright, LinkedIn | **Yes.** The bands already exist. |
| **Decision facts before the description** (pay, level, work mode) | WTTJ, Levels.fyi, Built In | **Yes:** salary, workplace, seniority (from the title), employment type, posted. |
| **Structured summary** (Requirements / Responsibilities / Skills) | Simplify, Hiring Cafe | **Later.** There's no AI at runtime. A rule-based "first N lines + keyword hits" preview works now. A local-model summary is a later phase. |
| **Company context**: size, funding | WTTJ, Wellfound, Levels.fyi | **Partly.** No headcount or funding data. We do have open roles, 30-day hiring pace and surge (`activity.ts`), which competitors lack. Show that. |
| **Status timeline with dates, follow-up reminder, close reason** | Huntr, Teal, Careerflow | **Needs storage.** `Entry` keeps only `updatedAt`. Add a status history. Reminders can go through the existing Telegram/email alerts. |
| **Stage-specific fields**: interview date, offer amount | Huntr | Later, when status is Interviewing or Offer. |
| **Excitement rating 1–3** | Teal, Huntr | Cheap. Doubles as a sort. |
| Applicant counts, "Top applicant" | LinkedIn, Jobright | **No, never.** We read career pages, so we can't know. Faking it is an anti-pattern. |

Gulf-specific (user research):
- Salary ranks first for about 4 in 5 UAE/KSA professionals. A Gulf package is more than the base:
  housing allowance, flights and so on. Where the description mentions them, show them.
- Emiratisation roles (UAE nationals only) are a hard knock-out for expats. Detect the wording and
  flag it.
- Notice period belongs in the profile, not on the job.

## Approved page (B's facts-first, plus C's scorecard ideas)

**List row (2 lines)**
- Line 1: score with band word (83 Strong / 67 Fair; the square glyph goes, the word is the
  non-colour cue), title, NEW marker and age on the right.
- Line 2: company · place · work mode (deduped; no ATS name).
- At most one flag, in this priority:
  1. a knock-out in amber ("Remote, EU only", "Nationals only", "No sponsorship")
  2. salary
  3. "Sponsors visas"
  4. "Reposted"
  5. "Outside your industries"
- The "Your industry" chip goes.

**Detail, top to bottom**
1. **Header:** company, then title, then "Dubai, United Arab Emirates · Full-time · Head level",
   then "Posted 3h ago · still live on their careers page" with a green dot. Prev/next and
   full-page icons on the right.
2. **Decision facts:** a 3 × 2 grid. Each box has a label, a value and a small source line:
   - Salary ("Not listed" when missing; source: posting / description)
   - Work mode
   - Seniority (read from the title)
   - Who can apply (visa, residency, relocation, or "No limits stated")
   - Company hiring (N open roles · N new in 30 days)
   - Type (with "Via <ATS>")
3. **Fit card:**
   - "83 Strong match, above your 70 cut-off" (70 links to Settings › Matching).
   - Pills: ✓ Title 20/30 · ✓ Place 20/20 UAE · ✓ Industry 10/10 Banking, plus amber pills for
     misses or unchecked parts ("No topics set, so not checked").
   - Line: "50 of 60 points, shown out of 100. Add topics to score skills too."
   - "Show breakdown" expands to the bars with earned/max.
4. **About the role:** first lines of the description with profile keywords highlighted, then
   "Read full description" and "Copy".
5. **Your progress (one compact row):**
   - A status dropdown: Not tracked / Saved / Applied / Interviewing / Offer / Closed: rejected /
     Closed: withdrew / Closed: no response.
   - A muted hint that becomes the dated timeline once tracked (Saved Oct 15 › Applied Oct 16 ·
     follow up Oct 23).
   - "+ Note" and "+ CV used" links that open a field only when clicked.
6. **More at <company>:** other roles there, then other postings of the same job and hiring
   activity.

**Footer (sticky)**
- "Apply at Leading Edge" (primary; the ATS name goes in the tooltip).
- Save `S`.
- Not interested `X` (with undo).
- A ⋯ menu: Add company, Copy link.

## Phases (each is its own PR; build only after go)

1. **Data right + show what we have**
   - Breakdown earned/max and the total line.
   - Dedupe places (Factorial join, workplace label).
   - `displayName` and title-case in the detail.
   - Split the meta line.
   - Salary from `payOf` with a source label.
   - `Eligibility` flags in the row and the detail.
   - Band word instead of the glyph.
   - Misses in the fit card.
   - "Apply at <company>".
2. **Approved layout**
   - 2-line rows with one smart flag.
   - Header, facts grid, fit card, description moved up, compact progress row, sticky footer
     with Not interested.
   - A11y: details `<section>` + live region, `aria` on the status control, bottom fade.
3. **Tracking**
   - Status history with dates (`Entry` gains a history).
   - Close reasons.
   - Follow-up reminder through the existing Telegram/email alerts.
   - "CV used" field.
4. **Scoring:** remote-region ("EU only") and Emiratisation detection feed the score, the gates
   and the knock-out flag. This is a scoring change, so it gets its own review.
5. **Later:** local-model job summary, interview and offer fields, contacts linked to the referral
   finder, excitement rating.

Screenshots of every changed screen (light, dark, phone) go with each PR, per CLAUDE.md.

## Sources (selected)

- LinkedIn "How you match": https://www.linkedin.com/help/linkedin/answer/a7120158
- Indeed preferences and insights: https://uk.indeed.com/help/job-seekers/articles/32603395892109-adding-or-editing-job-search-preferences
- Welcome to the Jungle job page: https://app.welcometothejungle.com/jobs/BeRTVMSC
- Simplify job board: https://help.simplify.jobs/articles/2830264-viewing-jobs-on-simplifys-job-board
- Jobright match: https://jobright.ai/ai-job-match
- Levels.fyi jobs: https://www.levels.fyi/jobs
- Huntr job card: https://help.huntr.co/en/articles/12640406-understanding-the-job-card
- Careerflow tracker: https://help.careerflow.ai/en/articles/8936729-getting-started-job-tracker
- SHRM, salary is the top job-ad element: https://www.shrm.org/in/topics-tools/news/talent-acquisition/salary-important-part-job-ad
- HR Dive, seekers distrust jobs with no pay: https://www.hrdive.com/news/job-seekers-dont-trust-employers-that-exclude-pay-info-from-job-postings/633890/
- Emiratisation 2026: https://www.thenationalnews.com/news/uae/2026/07/20/emiratisation-on-track-with-190000-employed-in-private-sector/

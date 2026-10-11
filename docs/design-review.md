# Design Review: RawJobs web app

> **Status:** a record of the app as it was on 2026-10-09. The app has changed since, so line numbers and some screens below may be out of date.

**Date:** 2026-10-09 · **Method:** Anthropic `design` plugin (`design-critique` + `accessibility-review` + `ux-copy`)
**How it was tested:**
- Ran the live app on a fresh profile (a new user). Went through setup (sample resume → roles → Berlin → topics → 5 companies → first scan), then Radar, Pipeline, Companies and Settings.
- Checked at desktop width and on a 375px phone.
- Did a code-level WCAG 2.1 AA pass of `apps/web/src`. Light-mode contrast is calculated from the tokens in `index.css`.
- Not covered: a real screen reader (NVDA/VoiceOver).

IDs (C1, H3, …) are for picking fixes. Severity: **Critical** = loses users' trust or blocks a task · **High** = clear friction or a WCAG failure · **Medium** = confusing or inconsistent · **Low** = polish.

---

## Overall impression

The first run is strong. The welcome screen states the value, says how long setup takes, and offers a skip. The privacy reassurance is good, and the first scan took 6 seconds. The biggest opportunities:

1. **Data trust.** Test and sandbox job boards appear as the top "Good fit" suggestions.
2. **The first result is underwhelming.** Strong matches show 0, and resume suggestions are quietly dropped.
3. **Vocabulary sprawl.** Scan/update/check, my/your/watch/track and internal jargon all leak into the UI.
4. **Keyboard and focus handling.** Job cards can't be opened with Tab, and dialogs don't manage focus.

---

## Critical

| ID | Finding | Where | Recommendation |
|---|---|---|---|
| C1 | **Test and sandbox boards are suggested as top picks.** "Lever Implementation Training Environment" is the #1 "Quick start" pick and the #1 job (a UI/UX Designer post from **6 years ago**). "Rhaegal - Arago Sandbox" is also suggested as a "Good fit". | Setup step 6, Companies › Picked for you, Radar | Exclude boards whose names match `sandbox\|training environment\|test\|demo\|staging` in the catalog build and in `suggest`. Hide or flag postings older than about 6 months by default. |
| C2 | **Job cards can't be opened with the keyboard.** Each row is an `<li onClick>` with `aria-selected` and no role, so Tab skips it and screen readers can't open a job. Only the j/k shortcuts work. Pipeline cards have the same problem. | `components/radar/JobCard.tsx:58`, `components/Pipeline.tsx:82` | Make the title area a real `<button>`, or implement a proper listbox. |
| C3 | **Resume suggestions are silently lost.** After saving the resume, "Continue" moves on without applying the suggestions unless the user first clicks the separate "Use these to prefill the next steps" button. The result: Roles start empty, past employers (N26, Zalando) aren't prefilled, and "Like your past employers" shows **0**. | Setup step 1 → 2, 6 | Apply suggestions to empty steps automatically on Continue (the copy already promises "only fills what's still empty"). Prefill "You've worked at" from the resume. |

## High

| ID | Finding | Where | Recommendation |
|---|---|---|---|
| H1 | **First Radar shows "Strong matches 0".** Every job scored 42–50. Topics are worth 40 of 100 points, so a strong match (70+) is almost impossible unless descriptions repeat your keywords. The best-fitting job shows "Topics 0/40". | Radar, scoring | Rebalance the weights, or rescale when the user has few topics. At minimum, choose a default threshold the first scan can reach, and explain an empty "Strong" tab ("Add topics to find strong matches"). |
| H2 | **Stale copy:** "Setup complete. Next: daily scan + telegram alerts (coming soon)". Both features already exist in Settings. | `components/Guidance.tsx:45,122`, `setup/Wizard.tsx:410` | Replace with "Set up daily scans and Telegram alerts →" linking to Settings. |
| H3 | **"Star" means two different things.** Settings and setup say strong matches "get a star", but on the Radar the star means "Your company". | `Settings.tsx:86`, `Wizard.tsx:410`, `JobCard.tsx:80` | Say "get a highlighted score", or give strong matches a distinct icon. |
| H4 | **Light-mode contrast fails:** `--accent #0d9488` is 3.74:1 (primary buttons, NEW badge, chips). Accent on accent-soft is 3.32:1. Input borders (`--line`) are 1.26:1, which fails the 3:1 non-text rule. Dark mode passes. | `index.css:9,12`, `ui.tsx` Chip | Light `--accent` → `#0f766e` (5.47:1). Form-control border → slate-400. `text-bad` → `#b91c1c`. |
| H5 | **Card actions are hover-only on desktop** (Save / Applied / Not interested). They stay invisible when reached by keyboard and on large touch screens. | `JobCard.tsx:102` | Add `group-focus-within:opacity-100`, or keep them visible at reduced emphasis. |
| H6 | **Dialogs and overlays don't manage focus.** The job drawer, shortcut help, scan chooser, notify popover and filter sheet have no focus trap and no focus return. Some lack Escape. Escape is also ignored while typing in notes. | `JobDrawer.tsx:20`, `App.tsx:235,547`, `ScanButton.tsx:63`, `NotifyWhenDone.tsx:71`, `RadarPage.tsx:681` | One shared `<Dialog>` (native `<dialog>.showModal()`) used everywhere. |
| H7 | **Wizard bug:** "Back" on Review jumps to Topics and skips Companies. | `setup/Wizard.tsx:434` | `goStep(step - 1)`. |
| H8 | **The resume step's main button says "Skip for now" even after you paste a resume.** The real action is a smaller secondary "Save resume" button. | Setup step 1 | When the textarea has text, the main button becomes "Save & continue". |
| H9 | **Five different company counts:** 24,687 (search placeholder), 21,485 (directory bar), 20,449 (pagination), 19,866 (scheduled scans), ~21,000 (Settings). | Companies, Settings | One source of truth. Round consistently ("~21,000 companies"). |
| H10 | **Review promises more than it does.** It says "We'll find matching jobs across thousands of companies right away", then scans 5 companies, labelled "My companies + my industries" when no industries were picked. | Setup step 7 | "Checking your 5 companies now (about a minute). Scan all companies anytime from Scan now." |
| H11 | **Destructive actions with no undo:** bulk "Remove {n}" companies, row remove, delete saved view, Telegram "Disconnect", schedule "Turn off". Import uses native `confirm()` (OK/Cancel). | `Companies.tsx:128,186`, `RadarPage.tsx:572`, `TelegramAlerts.tsx:93,135`, `ScheduledScans.tsx:139`, `Settings.tsx:177` | Reuse the existing hide-company undo toast. Replace `confirm()` with a dialog that names the action ("Replace 12 jobs" / "Keep mine"). |

## Medium

| ID | Finding | Recommendation |
|---|---|---|
| M1 | **Same concept, many words.** Scan now / Run it now / Save & rescan / Check this company now / Update now. Your companies / My companies / Watch / Track / Trackable. Not interested → "Hidden" (and on a suggestion card it hides the whole company). Strong match / alert score / Match score / Fit score / Good fit. | Glossary: **Scan** = fetch jobs, **Update directory** = refresh the company list, **My companies**, **Hide** (job) vs **Hide company**, **Match score**. |
| M2 | **Internal jargon in the UI:** "board", "other boards", "Source: greenhouse", "Copy JD", "Company directory: Already up to date", "LAST 1 SCANS", "ok · 1m ago", "Trackable now / Coming soon", "+10 points", "pnpm dev", "profile/resume.md … never committed to git". | Use plain language: "careers page", "Hiring system: Greenhouse", "Copy job description", "Last scan: OK". Move CLI hints to the README. |
| M3 | **Misleading flash on load:** "Company suggestions need the local app (pnpm dev)" appears for a moment, then suggestions load. | Show the skeleton or loading state until the fetch has actually failed. |
| M4 | **Industries vs Topics overlap and skew to finance.** Crypto, Fintech and Payments appear in both steps, and 17 of 29 industries are finance or crypto. A designer or nurse sees mostly irrelevant options. | Merge into one step, or explain the difference in one line ("Industries filter companies · Topics rank jobs"). Rebalance the list, or sort it by the resume. |
| M5 | **"NEW" appears on 4–7-month-old postings,** and New = All (11) on first run. | Base it on posting date, or rename it "New to you" and hide the badge on the first scan. |
| M6 | **Job detail has duplicate controls:** a "Save" button plus a "Saved" status chip, and "Not interested" twice. | Keep the status row as the single control. The header gets Apply plus one primary action. |
| M7 | **The Companies page is overloaded:** 5 stacked sections, two search boxes, two "Paste a link" buttons, and 818-page pagination. | Tabs: **My companies · Suggestions · Browse directory**. One search and one paste-link button. |
| M8 | **Settings is one very long page** that repeats the whole wizard. | Add a sticky section nav (Profile, Companies, Scans & alerts, Data), or collapse each section into a summary with Edit. |
| M9 | **The Radar adds a "Germany" filter automatically,** even though the user picked Berlin. The profile summary also says "Germany", and the filter comes back on every visit. | Show the user's actual places. Make the auto-filter visible ("Filtered to your places · Show all"). |
| M10 | **Screen-reader gaps:** no `aria-live` on scan progress, save status or results (and no `role="progressbar"`). Status chips lack `aria-pressed`. The notes field has no label. Main tabs have no `<h1>`. Focus isn't moved on tab or step change. The page title is always "Job Hunter". | Add `role="status"` on progress and results, `aria-pressed`, `aria-label="Notes"`, a per-view `<h1>` and `document.title`, and move focus to the heading on navigation. |
| M11 | **Tiny touch targets:** keyword weight dots are 10×20px; remove-X buttons are 16px (saved view, past employer). | At least 24px, and 44px on touch. Use a 1–5 segmented control for weight. |
| M12 | **Errors don't say how to fix them:** "Something went wrong.", "Couldn't save." (reason only in a tooltip), "Not recognised" / "Couldn't open this board", "Couldn't load the radar data" with no Retry. | What happened + why + how to fix, with an inline Retry. Show accepted link formats. |

## Low / polish

| ID | Finding | Recommendation |
|---|---|---|
| L1 | Lowercase proper nouns: "berlin", "germany", "In berlin.", "telegram". | Title-case places and brand names in display. |
| L2 | Truncation: placeholder "Add a company you've worke…", job families "Quality Assurance & Te…", "Customer Success & Su…". | Shorter placeholder ("Past employer"), and let family names wrap to two lines. |
| L3 | The "Good fit" badge is amber (a warning colour) for a positive state. | Use accent or green. Reserve amber for warnings. |
| L4 | The score is a bare number ("50") with no label or scale on the card. | "50 match" plus an accessible tooltip linking to "Why it matches". |
| L5 | Location overflow is formatted inconsistently: "Berlin · +3 more locations" vs "Amsterdam · Belgrade +8". | One format: "Berlin +3". |
| L6 | Mobile: Pipeline scrolls sideways (`min-w-[900px]`); the Companies table is `min-w-[720px]`, so remove buttons sit off-screen; the saved-views bar hides its scrollbar. | Show one column at a time or stack columns below `md`. Use cards for the table on mobile. Add an edge fade to the views bar. |
| L7 | Empty states without a button: "Try clearing the filters.", "Try Paste a link." | Make them real buttons. |
| L8 | The six "Edit" buttons on Review, and "Move to" in Pipeline, have no context for screen readers. | `aria-label="Edit roles"`, `"Move Senior Product Designer to…"`. |
| L9 | "Save resume" is disabled under 30 words with no explanation. | Helper text: "Add a bit more. We need at least 30 words." |
| L10 | Long raw location strings on suggestion cards ("Germany (remote); Portugal (remote); Italy; …"). | Clamp to one line plus "+N". |

---

## What works well

- **Welcome screen:** clear promise, 3-step preview, "about 3 minutes", and an honest skip.
- **Privacy reassurance** on every step that touches personal data.
- **Resume-aware hints,** e.g. "Design & UX · matches your resume" and the "From your resume" chips.
- **"Why it matches"** explains the score per part (title, location, topics, freshness). Excellent for trust.
- **Pipeline empty state:** what it is, how to fill it, and a CTA. The status dropdown on cards is an alternative to drag-and-drop.
- **Icon buttons are labelled** (`aria-label` + title with the shortcut). Title chips use `aria-pressed`. The global focus ring is visible.
- **Mobile Radar:** bottom tab bar, a Filters sheet, no horizontal page scroll.
- **Dark mode passes contrast,** and the first scan is fast (917 jobs in 6s).

---

## Suggested fix batches

1. **Quick wins (small, high impact):** C1, H2, H3, H4, H5, H7, L1, L2, L3, M3
2. **Onboarding and first result:** C3, H8, H10, H1, M9
3. **Accessibility:** C2, H6, M10, M11, L8
4. **Copy and terminology:** M1, M2, M12, H11, L7, L9
5. **Information architecture:** M7, M8, M4, M5, M6, H9, L6

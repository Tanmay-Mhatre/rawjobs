# Pipeline v2: activity, people, next steps, To review, weekly plan

Status: approved by the owner (2026-10-20) from the 6-flow mockup. This doc is the build spec. Review notes are in section 9.

## 1. Why

The v1 Pipeline (PRs #268 to #273) tracks stages, follow-up dates, interviews, people and offers, but:

- Cards show the fit score (noise once you've applied) and not what to do next.
- Nothing records what happened: messages, calls and notes are a single free-text field.
- People are a name, a role and one link: no email, phone, WhatsApp or LinkedIn.
- The Follow up list only knows "follow-up date reached" and "quiet for 21 days".
- "This week" is a strip of outcome numbers (a reply rate of 20% reads as failure).
- There is no place for jobs you haven't decided on yet.

## 2. What the research said (3-agent team, 2026-10-19)

- **Cards** (Pipedrive, Huntr, Teal): no tracker shows a fit score on the card. The best show one status dot (overdue, due today, later, nothing scheduled), the last activity, and the next step with its date. Columns sort by what's due first.
- **History** (Huntr, HubSpot, Attio): one reverse-chronological timeline per job. Stage changes are logged automatically as small grey rows; touches and notes are full rows with a channel icon and a sent/received marker. Filters: All, Messages, Stages, Notes. The next step is pinned on top.
- **Logging a touch** (HubSpot "Log activity"): pick a channel, sent or received, date (defaults to today), a person, one line of text, and "follow up in N days" ticked by default for sent touches. Logging a received touch clears the pending follow-up.
- **Channels by region**: Gulf and India recruiters lean on WhatsApp and phone; Europe and US on email and LinkedIn; referrals are the highest-yield channel. So the channels are Email, LinkedIn, WhatsApp, Call, In person, Referral, Note.
- **People**: name, role (recruiter, agency recruiter, hiring manager, referrer, interviewer, other), company or agency, email, phone with a WhatsApp switch, LinkedIn URL, how you met, referral status (asked, referred, thanked). One-click actions open your own mail, WhatsApp or LinkedIn (`mailto:`, `https://wa.me/<digits>`, the profile URL). RawJobs never sends anything.
- **Follow-up timing**: first follow-up 5 to 7 business days after applying; thank-you within 24 hours of an interview; check in a week after; stop after 2 unanswered follow-ups. About half of job seekers report being ghosted, so closing a job as "No response" is framed as normal, never as failure.
- **Weekly dashboard**: lead with activity you control (applications, follow-ups, outreach) against your own weekly plan. Outcomes (replies, interviews) are context. Weekly streak only, never daily. Learning-style goals beat outcome goals (Noordzij et al. 2013).

## 3. Decisions

| Question | Decision | Why |
|---|---|---|
| What is "To review"? | New strong matches from the Radar that you haven't tracked or skipped, newest first, up to 12. Leaves room for apply-kit drafts later. | It's the triage step before Saved; research says keep it out of the funnel. |
| Does To review count in stats? | No. | Pipedrive: idle first-stage items skew reports. |
| Where do contacts live? | Inside each job's entry, each with a stable `id`. "Add someone you already know" picks from people on your other jobs and copies them with the same `id`; editing a person updates every copy with that `id`. | No new tracking part, so the server, export and import don't change. Agency recruiters on several jobs still work. |
| Next step model | Derived, not stored, from the entry: follow-up date, interview dates, offer deadline, quiet time and touches. Only the follow-up date and skipped tasks are stored. | One source of truth; nothing to keep in sync. |
| Follow-up date | Allowed in every active stage (Saved, Applied, Interviewing, Offer), not only Applied. Set to +7 days when you apply, and from the composer when you log a sent touch. Cleared by logging a received touch. | Research: every stage has a next step. |
| Close suggestion | Applied, and either 2 sent follow-ups with no received touch since, or 21 days with no received touch. | Research consensus: stop after 2. |
| Weekly plan | `prefs.weeklyPlan = { applications, followUps, outreach }`, each optional 1 to 50. The v1 `weeklyGoal` becomes `applications`. | Activity goals the user controls. |
| The legacy single note | Kept as is and shown as a note row dated when it was last saved; new notes are activities. | No data loss, no migration step. |

## 4. Data model (apps/web/src/lib/userState.ts)

```ts
type Channel = "email" | "linkedin" | "whatsapp" | "call" | "meeting" | "referral" | "note";
type Activity = {
  id: string;             // random, for keys and edits
  at: string;             // ISO time it happened (editable date, defaults to now)
  channel: Channel;
  dir?: "sent" | "received"; // not for "note"
  contactId?: string;
  text?: string;          // up to 2,000 characters
};
type ContactRole = "recruiter" | "agency" | "hiring-manager" | "referrer" | "interviewer" | "other";
type Contact = {
  id: string;
  name: string;
  role?: ContactRole;
  company?: string;
  email?: string;
  phone?: string;
  whatsapp?: boolean;
  linkedin?: string;      // full https URL
  howMet?: string;
  referral?: "asked" | "referred" | "thanked";
};
Entry += { activities?: Activity[]; skipped?: string[] /* next-step keys */ };
```

- `activities` is capped at 200 per job, oldest dropped. `history` stays as is (stage changes).
- v1 contacts `{ name, role?: string, link? }` are read as v2: a missing `id` is made from the name; a free-text role is mapped (contains "recruit" → recruiter, "agency" → agency, "hiring" or "manager" → hiring-manager, "refer" → referrer, "interview" → interviewer, else other, with the text kept in `howMet` if it doesn't map); a `link` on linkedin.com becomes `linkedin`.
- `followUp` is kept for Saved, Applied, Interviewing and Offer (v1 dropped it outside Applied).
- `EntryPatch` gains `activities`, `skipped`, `contacts` (v2 shape). Helpers: `addActivity(entry, a, { followUpDays? })` returns the patch: append, then set `followUp` (sent) or clear it (received).
- Import (`entryFrom`) validates every new field and drops bad items, as it does today.
- `prefs.weeklyPlan` and `prefs.reviewSkipped` (job ids, capped at 500) in apps/web/src/lib/prefs.ts; `weeklyGoal` read as `weeklyPlan.applications` and then dropped.

## 5. Next steps (new apps/web/src/lib/nextSteps.ts)

`nextSteps(state, now)` returns tasks sorted by due date, each `{ key, id, kind, due, label, why, contactId? }`:

| kind | When | Due | Main action |
|---|---|---|---|
| `follow-up` | `followUp` set, active stage | the date | Log follow-up (composer, channel defaults to the last sent one) |
| `thank-you` | an interview date has passed and no sent touch since | interview day + 1 | Log thank-you |
| `interview` | interview today to +7 days | the day | Open |
| `deadline` | offer with an answer-by date today to +7 days | the date | Compare offers |
| `close` | the close suggestion in section 3 | today | Close as no response |

- A task whose `key` is in `entry.skipped` is hidden. Keys: `follow-up:<date>`, `thank-you:<interview date>`, and so on, so a new date brings the task back.
- Groups: Overdue (due before today), Today, This week (to +7 days).
- Snooze on a follow-up moves `followUp` (Tomorrow, In 3 days, Next week, Pick a date). Skip adds the key to `skipped`.
- `cardState(entry, now)`: `overdue` | `today` | `later` | `none` | `closed`, for the card dot and chip.
- `lastActivity(entry)`: the newest of activities and history, as `{ at, channel?, text }` ("Messaged Priya on LinkedIn", "Moved to Interviewing").

## 6. Screens

### 6.1 Board (Pipeline.tsx)
- Columns: **To review** (dashed border, hint "New strong matches waiting for you"), Saved, Applied, Interviewing, Offer, Closed (shows counts per outcome; first 3 cards, then "Show N more").
- To review cards: title, company and place, "Strong match · found <when>", buttons Save and Skip. Skip adds to `prefs.reviewSkipped` (the job stays on the Radar).
- Tracked cards: status dot, title, company, last activity line (channel icon), next-step chip (overdue: danger chip with "· Nd overdue"; today: warning; later: neutral with the date; none: dashed "No next step"), next interview chip, stage age at bottom right. **No score.**
- Sort inside a column: overdue first, then by due date, then by stage age.
- Above the board: the "This week" strip (folded summary, opens the dashboard), then **Next steps** (Overdue and Today shown, This week folded), then the board. "Track a job" and "Compare N offers" stay in the toolbar.
- Every dot has a word on its chip; colour never stands alone.

### 6.2 Job detail (JobDetail.tsx progress section and TrackedJobDialog)
- Tabs: **Activity**, **People N**, **Interviews**, and for tracked-by-hand jobs **Job** (title, company, link, CV used, offer). Radar jobs keep their existing description; the tabs live in the progress section.
- Activity: pinned next step (with Log and Snooze), the composer (section 6.3), filter chips (All, Messages, Stages, Notes), the timeline (newest first; stage rows small and grey; "Found on your Radar" as the first event when known).
- People: one card per person with role chip, company, email, phone (WhatsApp when switched on), LinkedIn, and buttons Email, WhatsApp (only with a phone and the switch), Call, LinkedIn, Copy; "Last: <channel>, <when> · N touches"; edit and remove. "Add a person" form with all fields, "Add someone you already know" picker, and paste-to-fill (a pasted LinkedIn URL fills LinkedIn; an email address fills email; a phone number fills phone).
- Interviews: the v1 list (date and round), plus the person.

### 6.3 Composer
- Channel buttons: Email, LinkedIn, WhatsApp, Call, In person, Referral, Note.
- Sent / Received toggle (hidden for Note), person picker (the job's people plus "Add a person"), date (defaults to today, can't be in the future), one textarea.
- For Sent: "Next follow-up in [3 / 5 / 7 / 14 days]" ticked by default (7). For Received: the pending follow-up is cleared and the hint says so.
- Button: "Log <channel>" (Log email, Log call, Add note). Enter with Ctrl/Cmd logs.
- The Log follow-up and Log thank-you actions open the same composer as a pop-over, with channel, person and a short template filled in. "Copy and open email/WhatsApp/LinkedIn" copies the text and opens the person's link; it logs only when you press Log.

### 6.4 Dashboard (PipelineInsights.tsx)
- Folded strip: "This week · 3 of 5 applications · 4 follow-ups · 2 interviews coming up", with a progress bar for applications. Opens in place.
- Open: header with the week's dates and "N weeks in a row you hit your plan" (weekly, applications goal only, partial weeks don't break it until they end).
- Four tiles: Applications (x of plan), Follow-ups sent (x of plan), Outreach and referrals (sent LinkedIn, WhatsApp, email, call or referral touches that aren't follow-ups, x of plan), Interviews (count this week and the next one).
- Applications per week, last 8 weeks, with the plan as a dashed line.
- Where applications go, last 30 days: Applied, Heard back (with %), Interviewed, Offer, and No response (closed) shown separately. One line of insight when there's enough data (at least 10 applications): reply rate of strong matches vs others, and referrals.
- Coming up, next 7 days: interviews, deadlines, follow-ups (from `nextSteps`).
- Your plan for next week: edit the three goals.
- Telegram weekly summary: "<b>N</b> applications (plan P), <b>F</b> follow-ups, <b>R</b> replies." Same rules as every alert: no company names.

### 6.5 Phones and dark mode
- Phones: Next steps folded to one line with counts; column chips; cards unchanged; the detail opens full screen with the same tabs.
- Dark mode uses the existing tokens only. No new colours.

## 7. Build phases and owners

| PR | Scope | Files |
|---|---|---|
| A. Foundation | Data model, migration, `nextSteps.ts`, `lastActivity`, `cardState`, prefs (`weeklyPlan`, `reviewSkipped`), import validation, tests | lib/userState.ts, lib/nextSteps.ts, lib/prefs.ts, tests |
| B. Job detail | Tabs, Activity timeline, composer, People cards and form, Interviews tab, TrackedJobDialog using the same tabs | components/JobDetail.tsx (progress section), components/TrackedJob.tsx, new components/pipeline/*.tsx |
| C. Board | Cards, To review column, Next steps list with Log, Snooze, Skip and Close, the composer pop-over | components/Pipeline.tsx, App.tsx wiring |
| D. Dashboard | Strip, open dashboard, plan editor, 8-week chart, funnel, coming up, Telegram summary text | components/PipelineInsights.tsx, lib/pipelineStats.ts, packages/core/src/followups.ts |

A merges first. B, C and D are then built in parallel, each in its own worktree and PR. C uses the composer from B: C builds against the composer's props as specified here and imports it once B merges (C merges last).

## 8. Done means

- `pnpm check` passes; unit tests for every helper in sections 4 and 5, and for v1 data read as v2.
- Each PR: screenshots of the changed screens, light and dark, and the board on a phone, from a scratch `RAWJOBS_HOME`. Every test write checks the page's port first (the 2026-10-19 incident).
- Copy follows design/README.md: sentence case, verbs on buttons, no em dashes, no colour-only states.
- Nothing is sent by RawJobs; WhatsApp, email and LinkedIn are links the user clicks.

## 9. Review (2026-10-20): accepted changes

Three reviewers read sections 1 to 8: UX and design, frontend and data, production readiness and privacy. Every change below is accepted and **overrides the sections above** where they disagree.

### 9.1 Data model and safety (PR A)
1. **Keep entries with history.** An entry is kept while it has `status`, `note`, `cv`, `activities` or `contacts` (v1 kept it only for status, note or CV, so clearing Saved deleted everything). Clearing the status of a job that has activities or people asks first.
2. **Follow-up date in every active stage.** `followUp` is kept for Saved, Applied, Interviewing and Offer. A status change clears it unless the patch sets it; entering Applied still defaults it to +7 days. `entryFrom` and `followUpDue` follow the same rule. Older versions still drop it outside Applied; the only loss is a date, and this release is marked `Update: mandatory`.
3. **Follow-ups are marked.** `Activity.followUp?: true` is set when a touch is logged from a follow-up or thank-you task. The close rule and the dashboard's "Follow-ups sent" count only these; "Outreach" counts the other sent touches.
4. **Ids.** v1 contacts without an id get `v1:<jobId>:<index>` (stable on every read, never derived from the name). New ids use `Date.now().toString(36) + random`, as prefs.ts does (`crypto.randomUUID` isn't available on plain http).
5. **One place to read v1 data.** `normalizeState()` runs on every read: localStorage load, disk sync, the storage event, and import. It converts on read only; the v2 shape is written when a contact is next edited, and `link` is kept beside `linkedin` so older versions still show it.
6. **Editing a person everywhere.** `useUserState().updateContact(c)` maps over all entries and changes only `contacts` (no `updatedAt` bump, so stage ages and applied dates don't move). Removing a person removes them from this job only.
7. **Size caps.** Activity text ≤ 1,000 characters; ≤ 100 activities per job (oldest dropped); ≤ 30 people per job; `skipped` ≤ 50 keys (keys older than 30 days pruned); name 120, company 120, email 254, phone 32, LinkedIn 300, how met 500. Import enforces the same caps. When saving to the browser or to disk fails, a toast says "Couldn't save your tracking" instead of failing silently.
8. **Safe links.** One `contactLinks(c)` helper builds every link:
   - LinkedIn: `new URL`, `https:` only, host `linkedin.com` or a subdomain.
   - Email: `^[^\s@?&#]+@[^\s@?&#]+\.[^\s@?&#]+$`, built as `mailto:` + `encodeURIComponent`.
   - Phone: digits only, 8 to 15 of them. A number without `+` and a country code gets no WhatsApp button, and the form says "Add the country code to use WhatsApp".
   - Call: `tel:+<digits>`. WhatsApp: `https://wa.me/<digits>`.
   - Every link opens with `rel="noopener noreferrer"`.
9. **Backups.** On the first v2 save, and then once a day, the server copies `profile/tracking.json` to `profile/backups/tracking-YYYY-MM-DD.json` and keeps the last 7.
10. **Import merges deeper.** `mergeStates` unions `activities` and `contacts` by id (for a person in both, the newer entry's fields win) and `skipped`; other fields go to the newer entry. Exports say `version: 2`. Import also checks channel and direction values, a parseable `at` that isn't in the future, and clears a `contactId` that points to no one (shown as "Removed person").
11. **Weekly plan stays readable by older code.** Keep writing `weeklyGoal` = `weeklyPlan.applications` for one minor version. `followups.ts` reads `weeklyPlan` first.
12. **Telegram stays counts only.** No names of people or companies, no email, phone, LinkedIn or activity text. A test checks the weekly message contains no field values from tracking. `dueFollowUps` widens to every active stage.
13. **Interviews** gain `time?` (HH:MM) and `contactId?`.
14. **Timezones.** Day maths uses `dayAfter(\`${day}T12:00:00\`, n)`. "Passed" means `on < today(now)`. "A sent touch since" compares the touch's local day. A touch logged for a past date is stored at noon local. `offer.deadline` is checked against `YYYY-MM-DD` before use.
15. **Known limit, not fixed here.** Two tabs or two app versions open at once still overwrite each other's `state` (last write wins). The backups cover it. A server-side merge by entry is a later PR.
16. **Logs.** Never log `/api/tracking` bodies or people's details in errors.

### 9.2 Next steps and To review
17. **Superseded (2026-10-20).** The owner decided To review is for jobs whose auto-apply answers wait for review, so the column is hidden until the apply kit is built; the strong-match version below was removed. Was: **To review** = Radar jobs with `score >= min_score`, first seen in the last 7 days, not tracked, not hidden (`hiddenCompanies`, hide rules, `why.gate`), one per role (`roleOf`), newest first, at most 12. It has a "See all N on the Radar" link when there are more. Its buttons are **Save** and **Not interested** (the existing status with its reason picker, which also hides it on the Radar). `prefs.reviewSkipped` is dropped. Saving writes a history row. The column is hidden while the Radar isn't set up. Drag from To review works onto Saved only. Apply-kit drafts are out of scope.
18. **Task actions.** Follow-up: Log follow-up and Snooze (Tomorrow, In 3 days, Next week, Pick a date). Thank-you: Log thank-you and Mark done. Interview and deadline: Open. Close suggestion: **Close as no response** and **Follow up once more** (sets `followUp` to +7 days and skips `close:<count>`). "Mark done" is the one word for "hide this task", stored in `skipped`.
19. **`cardState`** adds `quiet` (warning tone, chip "No reply · Nd"). Tones: overdue = danger, today = warning, quiet = warning, later = neutral, none = dashed.
20. **Performance.** `nextSteps` runs once per state change or hour (`useMemo` with `useHourlyNow`) and returns a `Map<id, Task[]>` that cards and sorting read from.
21. **One "new" context.** `newSinceLastVisit` setup moves from RadarPage and App into `lib/newSince.ts` as `newCtx(runs)`.

### 9.3 Screens, states and accessibility
22. **Cards keep** drag and drop, `[` / `]`, and the "Move to" menu. The title opens the detail. Dropping on Closed asks how it ended. Card title is clamped to 2 lines; company and last activity to 1 line with an ellipsis.
23. **Accessibility.**
    - Dots are `aria-hidden`; the chip carries the word.
    - The timeline is an `ol` with `<time datetime>`, and "Sent" and "Received" are visible text.
    - Filter chips are buttons with `aria-pressed`. The channel picker and Sent/Received are radio groups with arrow keys.
    - The textarea has a visible label, and global shortcuts are paused while it has focus.
    - A live region announces "Logged email. Next follow-up Oct 28."
    - Pop-overs trap focus, close on Esc and return focus.
    - Charts and bars have text equivalents: a visually hidden table, and `role="progressbar"` with values.
24. **Empty and edge states.**
    - To review empty: "No new strong matches. Next scan <time>."
    - Next steps empty: one line, "Nothing due."
    - No weekly plan: tiles show counts and a "Set a plan" button.
    - Streak hidden under 2 weeks; funnel hidden under 5 applications in 30 days.
    - No people: a sentence and "Add a person". A person with no contact details shows no action buttons, and Copy copies the name.
    - Long timeline text folds after 6 lines with "Show more".
25. **Copy.**
    - Buttons: Log email, Log LinkedIn message, Log WhatsApp, Log call, Log meeting, Log referral, Add note.
    - "Strong match" uses the `radar` icon, not sparkles.
    - The week is Monday to Sunday, local time. Date ranges use "to", not a dash.
26. **Cut from v2.**
    - Next steps filter chips.
    - Dashboard "Coming up" (it repeats Next steps on the same page).
    - The strong-vs-others insight line.
    - Paste-to-fill from an email signature; pasting a URL, email or phone stays.
    - Referral status chips (role = referrer plus a note instead).
    - Call duration.
    - The "Templates" link. Instead, three built-in texts: follow-up, thank-you, check-in.
    - The mockup's "Apply by" chip. On Saved jobs the follow-up date is labelled "Apply by" instead.
27. **Export.** The export dialog says it includes people's names, emails and phone numbers, with a ticked "Include people's contact details" option.

### 9.4 Build order (replaces section 7's parallel plan)
- **A. Foundation.**
  - Everything in 9.1 and 9.2's logic: data model, `normalizeState`, `nextSteps`, `cardState`, `lastActivity`, `contactLinks`, `updateContact`, prefs, `newCtx`, `followups.ts` and server backups.
  - The bare `Composer` component and its props type.
  - All prop and type ripples into App, Pipeline and PipelineInsights, so the later PRs don't fight over App.tsx.
- **B. Job detail** and **D. Dashboard** in parallel after A, each in its own worktree.
- **C. Board** after B merges, because it reuses B's pop-over pieces.

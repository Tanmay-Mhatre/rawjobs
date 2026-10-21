# Job detail pane: review (2026-10-21)

Research only, no code changed. Read from `origin/main` (v0.6.20+): `apps/web/src/components/JobDetail.tsx`,
`components/referral/*`, `components/settings/NetworkSection.tsx`, `design/tokens.css`, `index.css`,
`packages/core/src/schema.ts`. Earlier decisions: `docs/plans/radar-list-detail-ux.md`,
`docs/plans/radar-page-competitor-review.md`.

Reviewed as three roles: **job seeker** (what helps me decide and act), **designer** (hierarchy,
repetition, rhythm), **front-end** (what the data carries, what's cheap).

> Check first: the user's screen shows no Key facts grid, no "Why it matched" and no "Talk to someone".
> On `main` all three always render for a scanned job (Key facts since Radar Phase 2, referral since
> v0.6.19). Either the installed build is older than `main` (0.6.19 was rolled back twice) or the
> screen was summarised. Take the mock-up baseline from `main`, not from that screen.

## 1. Inventory (render order on `main`, beside the list)

| # | Element | When it shows | Data behind it |
|---|---|---|---|
| H1 | New dot + company name | always (dot when new this scan) | `isNew`, `job.company` |
| H2 | Back / Prev (K) / Next (J) / Expand (F) / Close | Back phones; Prev/Next when the list passes them; Expand not on phones | props |
| H3 | Star + title | star when "My company" | `yours`, `job.title` |
| H4 | Facts line: places · workplace · type · seniority | always | `cities`/`location`, `workplace`, `employmentType`, `seniority` |
| H5 | Fresh line: Posted/First seen Nh ago · "still listed, checked Nm ago" / Closed · Talent pool · Reposted · "may be filled" | always | `postedAt`, `firstSeen`, `lastSeen`, `status`, `evergreen`, `repostedAt` |
| B1 | "May be stale" callout (reasons + advice) | role judged stale | `isRoleStale(postings)`, `descriptionLength` |
| B2 | Key facts grid (6 boxes): Salary, Work mode, Seniority, Who can apply, Company hiring, Type (+ "Via ATS") | not estimated | `salary`, `salaryFrom`, `workplace`, `seniority`, `eligibility`, `visa`, `surge` / `useHiring`, `employmentType`, `ats` |
| B3 | Why it matched: ScoreBadge + band + cut-off, fold with checks, misses, unknowns, fix pills | always | `score`, `why.*`, `profile.min_score`, `why.checks`, `fitFixes` |
| B4 | Talk to someone who works here: See people at X (PiP card), Find friends (paste), Connect LinkedIn / people list / stale-import note, Known from other jobs, "More ways in" (search links, book a call) | hidden when Not interested | `useNetwork().status`, `usePeopleAt`, `entry.contacts/outreach`, `me`, `past_employers` |
| B5 | Not scanned yet + Scan this company | estimated only | `estimated`, `indexGeneratedAt` |
| B6 | About the role: preview 900 chars + Read full / empty-state sentence | always (side column when expanded) | `useDescription`, `why.keywords` highlight |
| B7 | Your progress: status select, Add a note (untracked), CV used, timeline + date fields, offer fields, Activity/People/Interviews tabs, "Why not?" | always; parts by status | `entry.*` |
| B8 | Sponsors visas | company on a register | `visa` via `sponsorOf` |
| B9 | Posted in N locations / Posted N times (list, stale tag, score, open link) | grouped duplicates | `postings`, `group` |
| B10 | Details: Posted, First seen, Last seen, Closed, Department, Industry, Hiring system | always | `postedAt`, `firstSeen`, `lastSeen`, `closedAt`, `department`, `industries`, `ats` |
| B11 | Hiring activity | `useHiring` returns data | hiring summary |
| B12 | More from X + Hide this company / empty sentence | `onHideCompany` or other jobs | `moreFromCompany`, `companyHidden` |
| F1 | Apply at X (primary, external) / Open careers page | always | `url` |
| F2 | Save (S), icon-only on desktop | always | `entry.status` |
| F3 | Not interested (X), icon-only on desktop | always | `entry.status` |
| F4 | More menu: Add/Remove My companies, Copy description (C) | `onTrack` or description | |

Phones: full-screen sheet, footer wraps (Apply full row, Save + Not interested labelled, More icon).

## 2. Verdicts

| Element | Verdict | Reason |
|---|---|---|
| H1 company + dot | Keep | Anchor. Add the company's hiring signal next to it (see B11 merge). |
| H2 nav icons | Keep | Fine; Expand already has tooltip + F. |
| H3 title + star | Keep | |
| H4 facts line | Change | Seniority/type repeat Key facts. Keep only place + workplace here. |
| H5 fresh line | Change | One phrase: "Posted 2h ago · live on Ashby 6m ago". Single source of freshness; warnings (pool, reposted, may be filled, closed) as one amber/red tag. |
| B1 stale callout | Keep, Move | It's a decision blocker: belongs directly under the header, compact (1 line + "why" toggle). |
| B2 Key facts | Change | Six boxes, often 3 say "Not listed/Not stated". Show known facts as chips; fold unknowns into one muted line "Not stated: salary, work mode". Drop Seniority + Type boxes (in header). |
| B3 Why it matched | Change, Move | Most useful thing we have, buried 3rd. Promote score + one-line verdict ("Strong: title, place, topics fit; salary unknown") into the header; checks stay one click away. |
| B4 Talk to someone | Change | Unconnected state is a paragraph + button competing with content: replace by the top banner (section 4). Keep See people / people list; "More ways in" stays folded. |
| B5 Not scanned yet | Keep | Only for estimated jobs; fine. |
| B6 About the role | Change | Empty state is a full section for one sentence. Collapse to a one-line row with "Open job page" link. When present, keep preview + highlights. |
| B7 Your progress | Change, Move | Pinned into the footer as a status pill (Save → Applied → …). Note and CV become one "Notes" disclosure; "CV used" renamed "CV version sent" and shown only once status ≥ Applied. |
| B8 Sponsors visas | Merge | Into Key facts "Who can apply" (it already says "Sponsors visas"); the sentence goes in that box's tooltip/note. Today it says it twice. |
| B9 Other postings | Keep, Merge | Into a "This role" block with posted/first seen; header gets "+2 locations" link that scrolls here. |
| B10 Details | Merge / Drop rows | Posted, Last seen = header (3rd and 2nd repeat). First seen only when ≠ posted. Department + Industry → chips under title. Hiring system → apply tooltip + footer note. Table goes. |
| B11 Hiring activity | Merge | With Key facts "Company hiring" (same numbers twice) into a "About {company}" block. |
| B12 More from X | Change | Hide the section when empty (no empty sentence). Hide this company → More menu. |
| F1 Apply | Keep | Primary, right. Tooltip names the ATS. |
| F2 Save icon | Change | Icon-only bookmark is ambiguous beside X; label it ("Save") on all widths — the footer has room once Not interested shrinks. Becomes the status pill once tracked. |
| F3 Not interested X icon | Change, Move | An X next to Apply reads as "close". Move to More menu + keep the X shortcut, or a labelled quiet "Not for me" button. |
| F4 More menu | Change | Add: Hide company, Not for me, Copy link, Open in new tab. |

## 3. Top 8 problems (ranked)

1. **The decision is buried.** Score and "why" sit under a 6-box grid; for this job the pane opens with
   nothing that says whether it's worth my time.
2. **Same fact, three places.** Posted (header, Details, Why's freshness line); last checked (header +
   "Last seen"); seniority/type (header + Key facts); visa (Key facts + Sponsors visas); hiring (Key
   facts + Hiring activity).
3. **Empty states eat the pane.** No description, no other jobs, salary/work mode "Not listed" each take
   a full block. On a thin job, 60% of the pane is "we don't know".
4. **Ambiguous footer icons.** Bookmark and X are icon-only on desktop; X beside Apply looks like close.
5. **"CV used" and "Add a note" read as unlabeled jargon** before you've applied; progress row mixes a
   select, two fold buttons and dates.
6. **Weak hierarchy.** Every section uses the same `rj-h` heading, same spacing, no grouping into "decide /
   act / reference". Low-value Details table looks as important as the role.
7. **Networking is the strongest lever but is hidden mid-pane** and, unconnected, shows a paragraph
   instead of a clear one-time ask.
8. **Company actions scattered.** Hide company (body), Add to My companies (More menu), More from X
   (body bottom), Company hiring (grid), Hiring activity (body): no single "company" place.

## 4. LinkedIn banner spec

**Show when:** `canRunLocally` and `useNetwork()` is ready and `status.connected === false` and not
`status.newer`, the job is not estimated, not an agency posting, not Not interested, and the banner
isn't dismissed. Top of the body (under header, above stale callout), full width, not sticky.

**Copy**
- Title: "See who you know at {Company}"
- Body: "Import your LinkedIn connections and we'll show friends who work here. RawJobs reads LinkedIn's
  own export on this computer. No LinkedIn login, nothing is sent anywhere."
- Buttons: primary small "Import connections" (lucide `Users`), quiet "Not now". Close `X` icon top right.
- While a Downloads watch runs: replace body with the existing `WatchLine` ("Watching Downloads until 14:30. Stop").

**CTA target:** opens the existing `ConnectLinkedIn` dialog (`components/referral/ConnectLinkedIn.tsx`):
step 1 opens LinkedIn's "Get a copy of your data" page (`LINKEDIN_DATA_URL`) and can watch Downloads;
step 2 pick/drop the ZIP or `Connections.csv`; done shows counts. Same component Settings uses.

**Dismiss:** X / Not now hide it everywhere (not per job). Save server-side with the other app prefs
(the theme incident showed localStorage is lost when the port changes), fallback localStorage key
`rawjobs.linkedinBannerDismissed`. Re-show once after 30 days only if still unconnected (optional; or
never). Re-find it: Settings → Data & privacy → LinkedIn connections (`NetworkSection`, `#settings-network`),
plus a small "Connect LinkedIn" link kept inside the "People" block. Dismiss toast: "Hidden. Connect any
time in Settings › LinkedIn connections." with Undo.

**Connected state (banner gone):** a "People at {Company}" block near the top:
- N known: avatars/initials + "You know 3 people here" with the top 1–2 named (degree, title), "Show all";
  actions per person as today (Add to job, Draft message).
- 0 known: one line "No connections at {Company} yet" + "See people at {Company}" + "More ways in".
- Import ≥ `REFRESH_AFTER_DAYS` old: muted line "Imported 45 days ago · Get a fresh copy" (amber at 60).
- Header gets a small people count chip ("3 you know") that scrolls to the block.

## 5. Design tokens to reuse (`apps/web/src/design/tokens.css`, generated from `tokens.json`)

- **Fonts:** `--font-sans` Geist (400/500/600), `--font-mono` Geist Mono (400/500).
- **Type:** `--text-title` 600 24/30 · `--text-heading` 600 20/24 · `--text-subheading` 500 18/24 ·
  `--text-body` 400 16/24 · `--text-small` 400 14/21 · `--text-label` 500 14/20 · `--text-meta` 400 12/16 ·
  `--text-score` 600 16/20 · `--text-score-lg` 600 32/36 · `--text-source`/`--text-kbd` 500 12/16 mono.
- **Colour (light / dark):**
  - canvas `--bg-canvas` sand-2 #f5f1e8 / sand-1 #120f0b
  - raised/drawer `--bg-raised` sand-1 #fffbf5 / sand-2 #181611; `--bg-overlay` #fffbf5 / sand-3 #201d18
  - hover `--bg-hover` sand-3 #ede9e2 / #201d18; active `--bg-active` sand-4 #e5e1db / #27241f; inset sand-3 / sand-1
  - border `--border-subtle` sand-6 #d4d0c9 / #37342e; `--border-default` sand-7 #c4c0ba; `--border-control` sand-9 #888681
  - text `--text-primary` sand-12 #151412 / #ecebe8; `--text-secondary` sand-11 #605d59 / #cac7c2
  - accent `--accent-solid` orange-9 #ff5a1f (button text `--on-accent` = sand-12); `--accent-text` orange-11 #a33100 / #ff9d7f; `--accent-subtle` orange-3 #ffe2da; `--accent-mark` orange-10 #dd4400 (star, new dot)
  - success text green-11 #007137 / #89dea1, solid green-9 #007d3e, subtle green-3 #d3f3da
  - warning text amber-11 #7f5300 / #f6bb6a, solid amber-9 #f3aa36, subtle amber-3 #fde5c7
  - danger text red-11 #a12b46 / #ffaeb7, solid red-9 #b11f47, subtle red-3 #ffe1e4
  - high-contrast themes exist (`[data-theme]` variants): don't hard-code hexes, use the variables.
- **Radius:** `--radius-sm` 2px, `--radius-md` 4px (cards, inputs), `--radius-dot` 999px. Square-ish brand: no 12px+ rounding.
- **Spacing:** 4 / 8 / 12 / 16 / 24 / 32 / 48 / 64 (`--space-1..16`). Drawer sections gap 24px.
- **Elevation:** `--shadow-l2`, `--shadow-l3` (none in light-contrast); borders first.
- **Primitives:** `Button` (primary/secondary/quiet/danger, sm/md), `IconButton` + `Tooltip` + `Kbd`, `Chip`,
  `Menu`, `ScoreBadge`, `ScoreBreakdown`, `Status`, `Tabs`, `SourceTag`, `Card`, `Dialog`; CSS `rj-h`,
  `rj-sep` (" · "), `rj-facts`, `rj-fit`, `rj-dot`, `rj-star`, `rj-icon`. Specs in `design/components/*/README.md`.
- **Icons:** lucide-react, 16px (`rj-icon` / `size-4`). Already used here: ArrowLeft, ChevronUp/Down/Right,
  Maximize2, X, Star, ExternalLink, Bookmark, BookmarkCheck, Ellipsis, Check, Plus, Copy, FileText,
  CircleHelp, LoaderCircle, Users, RefreshCw, Trash2. Banner can use Users + X.

## 6. Three directions to mock up

**A. Decision-first compact.** The pane answers "should I bother?" in the first 200px. Header: company,
title, one meta line (place · work mode · posted 2h · live), then a verdict strip: ScoreBadge + one
sentence ("Strong match: title, place, topics fit · salary not listed") + chips for the known facts only
(Sponsors visas, 12 roles in 30 days, +2 locations, 3 people you know). LinkedIn banner sits just below.
Everything else stacks as quiet, collapsed rows ("Why it matched", "About the role", "Notes", "More at
SplitMetrics") with counts on the right, so a thin job is a short pane, not a page of empty states.
Footer: Apply · Save (labelled) · status pill · ⋯ (Not for me, Hide company, Add company, Copy).

**B. Tabs: Overview / Role / People / My progress.** Header + verdict stays fixed; below it four tabs
(the `Tabs` primitive Pipeline already uses). Overview = verdict, key facts, stale warning, LinkedIn
banner. Role = full description with highlighted topics, other locations, department/industry. People
= who you know, See people, More ways in, contacts on this job (the existing People tab merged in).
My progress = status, timeline, follow-up date, notes, CV version, interviews. Tab badges carry counts
("People 3", "Progress · Applied"). Strong for tracked jobs and keyboard users; risk is hiding the
description one click away, so Role could be default when a description exists.

**C. Two-column dossier with timeline.** Use the width the pane often has (and always has in Expand).
Left column (wide) is reading: title, description or its empty row, highlighted topics. Right rail
(~280px) is a stack of compact cards in decision order: Match (score + 3 check icons), Facts (only
known ones), People (banner or people list), Company (hiring trend sparkline, sponsor, other roles,
hide), and a vertical **timeline** that merges posted → first seen → last checked → saved → applied →
follow-up due into one chronological line, killing the Details table and the progress row. Below
~720px the rail drops under the header as a horizontal scroll of cards. Footer unchanged but labelled.

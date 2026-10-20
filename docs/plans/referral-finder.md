# Referral finder: implementation plan

Ready to save as `docs/plans/referral-finder.md`. Status: draft for the specialist audit. Nothing has been built yet.

**Baseline.** Written against `origin/main` @ `6c49687` (2026-10-20, "Site: refresh the offline fallback numbers and wall"). The local `main` checkout is **144 commits behind origin**, so every anchor below comes from `git show origin/main:<path>`. Run `git pull` before building, and re-check line numbers after any PR that lands in between.

---

## 0. Corrections to the brief, from the current code

Read these first. Each one changes the design.

1. **The contact log should live in the per-job `Entry`, not in a new tracking part.** The brief's premise no longer holds.
   - `keep()` at `apps/web/src/lib/userState.ts:281` already keeps an entry that has `contacts` or `activities`, even with no status or note.
   - Pipeline v2 already stores people per job: `Entry.contacts` (`:119`) and `Entry.activities` (`:121`), with a stable `Contact.id` shared across jobs.
   - `docs/plans/pipeline-v2.md` §3 records the owner's decision: "Where do contacts live? Inside each job's entry … No new tracking part, so the server, export and import don't change."
   - A new tracking part would mean changing `PARTS` in `packages/core/src/tracking.ts:20-26`, the `TrackingPart` type in `apps/web/src/lib/tracking.ts:13`, and the export/import code.
   - **Recommendation:** add one optional field, `Entry.outreach`, keyed by `contactId`. If the auditors insist on a separate part, see §11 Q1.
2. **The Settings page is "Data & privacy" (`id: "data"`), not "Your data"** (`apps/web/src/components/settings/registry.ts:18`).
   - `PRIVACY.md` still says "Settings → Your data → Sharing", which is stale. PR 2 fixes it.
3. **Staffing-agency detection doesn't exist yet.** Usable signals:
   - `job.ats === "bullhorn"`: Bullhorn is the agencies' system (`packages/core/src/connectors/bullhorn.ts:10`).
   - The company name itself.
   - The `hrtech` industry id (`catalog/industries.ts:154`) is **not** enough on its own, because it includes HR software companies.
4. **Our app sends no CSP**, only `x-frame-options: DENY` on HTML (`packages/server/src/static.ts:60,91`). XFO controls who may frame *us*, not what we frame.
   - So `frame-src adplist.org` needs no change today.
   - Checked live on 2026-10-20: `adplist.org/mentors/company/google` returns 200 with no `X-Frame-Options` and no `Content-Security-Policy`, so framing it is allowed.
   - If we ever add a CSP, it must list `frame-src https://adplist.org`. PR 10 adds a test that fails if a CSP appears without it.
5. **Pasting a LinkedIn link into a `PersonForm` already fills the right field** (`apps/web/src/components/pipeline/detail.ts:69` `pasteField`), and `linkedInUrl()` (`apps/web/src/lib/contactLinks.ts:22`) checks profile URLs.
   - Reuse both. Don't write a new URL check.
6. **`copyText()` will fail inside a Document Picture-in-Picture window.** `apps/web/src/lib/clipboard.ts:6` uses the opener's `navigator` and `document`; when focus is in the PiP window, the opener's document isn't focused, so both the Clipboard API and `execCommand` fail.
   - PR 8 adds an optional `win` parameter: `copyText(text, win = window)`.
7. **`readBody()` only reads UTF-8 text** (`packages/server/src/api.ts:524`), so a raw ZIP can't be uploaded today.
   - **Design:** the browser opens the ZIP itself (`Blob.slice` + `DecompressionStream("deflate-raw")`) and sends only the three CSV texts.
   - Message files are never even read off disk, which is also the stronger privacy story.
   - The Downloads watcher reads the ZIP in Node with the **same** pure ZIP reader.
8. **The job ID is already in `job.id`**, as `"{ats}:{slug}:{atsJobId}"` (`packages/core/src/schema.ts:152`). Use it first; parse the URL only as a fallback.
9. **Two company normalizers already exist.** Reuse both:
   - `companyNameKey()` (`packages/core/src/dashboard.ts:101-116`, exported at `:116`, reachable as `@rawjobs/core/dashboard`): display name, then words with no accents, legal suffixes dropped, leading "the" dropped, joined with no spaces.
   - `companyWords()` (`packages/core/src/employers.ts:9-20`): word lists.

---

## 1. Goals and non-goals

**Goals (Release 1, A–K)**
- On every job, show who you know at that company, ranked by how likely they are to help. Explain each score in plain words.
- Import your network from LinkedIn's own data export, with no LinkedIn login or scraping. Optionally pick it up from your Downloads folder automatically.
- Help you go from finding a person to sending a message:
  - search links;
  - a paste box for LinkedIn search results;
  - a floating card next to LinkedIn;
  - message drafts;
  - a contact log per job, with stages.
- Show a "who you know" count on the Radar, with a filter and a sort.
- Point to paid advice (ADPList, Topmate) with an ethics line.

**Non-goals**
- Sending any message, or automating LinkedIn in any way (no fetch, no headless browser, no extension).
- Mixing network points into the match score. Person scores stay separate.
- Storing the people you paste from LinkedIn search beyond the session, unless you add them as contacts.
- Reading LinkedIn messages, invitations or email addresses.
- Cloud sync, or sharing anything with the directory.

---

## 2. Architecture and data flow

```
LinkedIn (user's own browser)              RawJobs browser (127.0.0.1)                 RawJobs server (same machine)
 Settings → Get a copy of your data  ─ZIP→  [Choose / drop file]                       
                                            core/network/zip.ts (Blob reader)           
                                            → 3 CSV texts only ───POST /api/network/import──→ core/network/linkedin-export.ts
                                                                                          parse, drop Email, cap
 ~/Downloads/Basic_LinkedInDataExport_*.zip ←── poll every 10 s (only while watching) ── core/network/watch.ts
                                                                                          core/network/zip.ts (fs reader)
                                                                                          → same parser
                                                                                          core/network/store.ts
                                                                                          profile/network.json (atomic)
                                                                                          in-memory index: key → ids
 Radar ─GET /api/network/summary {key→count}──────────────────────────────────────────────┘
 Job panel ─GET /api/network/people?company=<name>  → people rows (no score)
           core/network/score.ts (pure, in browser): person × job × your positions → points, band, why
 "Find friends"  → window.open(LinkedIn search)  → user Ctrl+A/C → paste box → lib/peoplePaste.ts (memory only)
 "See people"    → window.open(left half) + documentPictureInPicture card (or popup #card/<jobId>)
 Contact log     → Entry.contacts + Entry.outreach + Entry.activities (profile/tracking.json via useSavedOnDisk)
```

**Where the shared code lives**
- Pure code goes in `packages/core/src/network/*`. It has no Node imports, except `watch.ts` and `store.ts`.
- The browser imports the pure parts through new `package.json` exports.

**Company key everywhere:** `networkKey(name)` (§3.3). The browser computes `networkKey(job.company)` itself and looks it up in the summary.

---

## 3. Data model

### 3.1 `profile/network.json` (new; `profile/` is gitignored)

```ts
// packages/core/src/network/types.ts
export type NetworkConnection = {
  /** Stable across re-imports: "u:" + the /in/<slug> from the profile URL; else "n:" + sha1(first|last|company).slice(0,12). */
  id: string;
  first: string;            // ≤ 80 chars
  last: string;             // ≤ 80
  /** https://www.linkedin.com/in/... only (linkedInUrl-style check), else omitted. */
  url?: string;
  company?: string;         // ≤ 120, as LinkedIn wrote it
  position?: string;        // ≤ 160
  /** YYYY-MM-DD from "Connected On" ("15 Oct 2024" / "10/15/24" / ISO tolerated). */
  connectedOn?: string;
};
export type NetworkPosition = { company: string; title?: string; from?: string /* YYYY-MM */; to?: string /* YYYY-MM; missing = current */ };
export type NetworkSchool = { name: string; from?: string /* YYYY */; to?: string; degree?: string };

export type NetworkFile = {
  app: "rawjobs"; kind: "network"; version: 1;
  importedAt: string;                     // ISO
  source: "downloads" | "file";
  /** The ZIP's name, for "Imported Basic_LinkedInDataExport_10-20-2026.zip". Name only, never the path. */
  fileName?: string;
  connections: NetworkConnection[];       // cap 30_000 (LinkedIn's own connection limit)
  positions: NetworkPosition[];           // cap 100. Description and Location columns are dropped.
  education: NetworkSchool[];             // cap 30. Notes and Activities are dropped.
  /** Connection ids you marked "Friend"; kept across re-imports by id. */
  friends: string[];                      // cap 2_000
};

/** What the browser and the API exchange. Never the Email column. */
export type NetworkStatus =
  | { connected: false; watch: WatchState | null }
  | { connected: true; importedAt: string; fileName?: string; source: "downloads" | "file";
      counts: { connections: number; positions: number; education: number; companies: number };
      /** Days since import; the browser words it (30-day reminder, 60-day stale notice). */
      ageDays: number; watch: WatchState | null };

export type WatchState = { since: string; until: string; folder: string; lastError?: string; found?: string };

/** One person for the panel: a connection row plus whether you tagged them. */
export type NetworkPerson = NetworkConnection & { friend: boolean };
```

**`profile/network-watch.json`** holds `{ since, until }`, so a server restart carries on watching. It is deleted when the ZIP is found, when the watch window ends, or on Stop or Delete.

### 3.2 The per-job contact log, added to `Entry` (`apps/web/src/lib/userState.ts`)

```ts
export const OUTREACH_STAGES = ["to-contact", "warming", "messaged", "replied", "referred"] as const;
export type OutreachStage = (typeof OUTREACH_STAGES)[number];
export const OUTREACH_LABEL: Record<OutreachStage, string> = {
  "to-contact": "To contact", warming: "Warming up", messaged: "Messaged", replied: "Replied", referred: "Referred",
};
export const OUTREACH_VIA = ["linkedin", "email", "topmate", "adplist", "other"] as const;
export type OutreachVia = (typeof OUTREACH_VIA)[number];
export const VIA_LABEL: Record<OutreachVia, string> = { linkedin: "LinkedIn", email: "Email", topmate: "Topmate", adplist: "ADPList", other: "Other" };

/** Where asking one person about this job stands. */
export type Outreach = {
  stage: OutreachStage;
  via?: OutreachVia;
  /** When the stage last changed (ISO). */
  at: string;
  /** The NetworkConnection id this contact came from, for "Friend" and the score. */
  networkId?: string;
  /** From a pasted search: 1 or 2, and the shared connection to ask for an introduction. */
  degree?: 1 | 2;
  mutual?: string;          // ≤ 120
};

// Entry gains:  outreach?: Record<string /* contactId */, Outreach>;
// EntryPatch gains "outreach".
```

**Rules**

| Where | Change |
|---|---|
| `applyPatch` (`:284-321`) | Drop `outreach` keys whose `contactId` is no longer in `next.contacts`. Delete `outreach` when it's empty, in the cleanup block at `:317-319`. `keep()` needs no change: outreach without contacts is dropped. |
| `entryFrom` (import, `:496-560`) | Accept only a known stage or via, a parseable `at` no later than now plus the clock skew, `degree` of 1 or 2, a clipped `mutual`, and a `contactId` present in `contacts`. |
| `mergeStates` (`:369-389`) | Union by `contactId`. The newer `at` wins. |
| Stage words for the Radar (`referralWord(entry)`) | Highest stage across contacts: `referred` → "Referred", `replied` → "Replied", `messaged` → "Referral asked". Nothing for `to-contact` or `warming`. |
| Adding the first contact from the referral section | Also patches `status: "saved"` when `entry?.status` is undefined or `"dismissed"` (§11 Q4). `history` records it as usual. |
| "Mark as messaged" | Sets `outreach[cid] = { stage: "messaged", via, at }`, and logs an `Activity { channel: via === "email" ? "email" : "linkedin", dir: "sent", contactId, text: "Asked for a referral" }` through `addActivity` (`:271`), so the Activity timeline shows it. On a Saved job, `addActivity` already leaves the follow-up date alone (`:274`). |
| `Contact` | Gets `role: "referrer"` (an existing role, `:53`) when added from the referral section. Recruiters get `"recruiter"`. |

The CAPS stay as they are (`contacts: 30` per job, `:88`).

### 3.3 Company matching (`packages/core/src/network/company.ts`)

```ts
export const COMPANY_STOPLIST: ReadonlySet<string>;   // keys: selfemployed, freelance, freelancer, stealth, stealthstartup,
                                                      // stealthmodestartup, confidential, independent, independentconsultant,
                                                      // consultant, retired, unemployed, opentowork, various, na, none, student
export const COMPANY_ALIASES: Readonly<Record<string, string>>; // key → canonical key
//   facebook→meta, metaplatforms→meta, instagram→meta, whatsapp→meta,
//   alphabet→google, googlecloud→google, youtube→google (opt?), 
//   twitter→x, xcorp→x,
//   square→block, cashapp→block,
//   aws→amazon, amazonwebservices→amazon, amazoncom→amazon
export const EXACT_ONLY: ReadonlySet<string>;   // apple, notion, ramp, block, stripe, square, target, oracle, shell, mercury,
                                                // canva? (no), plaid, figma? (no) – common English words only
/** The key a company is indexed and looked up by; null for the stoplist and empties. */
export function networkKey(name: string | undefined): string | null; // = alias(companyNameKey(name)) unless stoplisted
/** Keys in `index` that count as `jobKey`: itself, plus word-prefix matches ("kraken" ~ "krakendigitalassetexchange")
 *  only when jobKey.length > 4 and !EXACT_ONLY.has(jobKey). Uses companyWords() for the word check. */
export function matchingKeys(jobName: string, index: NetworkIndex): { keys: string[]; how: "exact" | "alias" | "prefix" | "none" };
```

**How `networkKey` uses the existing code:** call `companyNameKey()` from `dashboard.ts:116`, then the alias map. Don't re-implement suffix stripping.

**Prefix matching**
- Uses a second index: first word → keys.
- A match needs the connection's word list to *start with* every word of the job company (`companyWords`).
- Prefix matches are capped at 3 extra keys.
- The UI says when a person matched loosely, e.g. "Works at Kraken Digital Asset Exchange".

### 3.4 Person score (`packages/core/src/network/score.ts`, pure)

```ts
export type PersonPoint = { id: "first" | "friend" | "colleague" | "function" | "seniority" | "recruiter" | "years"; points: number; text: string };
export type PersonScore = { total: number; band: "high" | "medium" | "low"; points: PersonPoint[]; why: string };
export function scorePerson(
  p: { degree: 1 | 2; position?: string; connectedOn?: string; friend?: boolean },
  job: { title: string; seniority: Seniority },
  me: { positions: NetworkPosition[] },
  now?: Date,
): PersonScore;
```

| id | Points | Rule | Text (copy) |
|---|---|---|---|
| first | +40 | `degree === 1` (every imported connection) | "You're connected on LinkedIn" |
| friend | +20 | You tagged them Friend | "You marked them as a friend" |
| colleague | +15 | `connectedOn` falls inside one of your `positions` [from, to or now] | "You connected while you were at {company}: likely a past colleague" |
| function | +15 | The role family of their position equals the job's (`ROLE_FAMILIES` titles via `matchesTitle`, `catalog/roles.ts:21`, `text.ts:356`) | "Works in {family label}, like this job" |
| seniority | +10 | `seniorityOf(position)` at or above `job.seniority` (`catalog/seniority.ts`, `SENIORITY_LEVELS` order) | "At or above this job's level" |
| recruiter | +10 | Position matches `recruiter`, `talent acquisition`, `sourcer`, `talent partner` or `people partner` | "A recruiter: can route your application, can't vouch for you" |
| years | +5 | `connectedOn` is at least 2 years ago | "Connected for {n} years" |

- **Bands:** high ≥ 60, medium 35–59, low < 35.
- **`why`:** the top two point texts joined with ". ".
- A pasted 2nd-degree person gets no `first` points. A mutual connection shows as text only, with no points.
- **Tests:** a table-driven test for each rule and for each band edge (34, 35, 59, 60).

---

## 4. API routes

All new routes go in `packages/server/src/api.ts`.
- **Placement:** after the tracking routes at `:361-371`, following the same style.
- **Documentation:** add each to the doc comment at `:50-87`.
- **Guard:** `guard.ts` `refuse()` already rejects writes without an Origin.

| Method and path | Body / query | Answer |
|---|---|---|
| `GET /api/network` | none | `NetworkStatus` |
| `POST /api/network/import` | `{ source: "file", fileName?: string, files: { connections?: string; positions?: string; education?: string } }`, read with `readBody(req, 40_000_000)` | `{ ok: true, status }` or `400 { ok:false, errors }` (copy in §7) |
| `DELETE /api/network` | none | Removes `network.json` and `network-watch.json`, stops the watcher, clears the index. `{ ok: true }` |
| `GET /api/network/summary` | none | `{ importedAt, counts: Record<networkKey, number> }`, or `{ importedAt: null, counts: {} }` |
| `GET /api/network/people?company=<name>` | Query read with `new URL(req.url!, "http://x").searchParams`. `route()` only gets the path (`:322`), so pass `req` through. | `{ how, people: NetworkPerson[] }`, at most 200, sorted by `connectedOn` (oldest first); the browser re-ranks. Adds `me: { positions, schools }` so the browser can score and build alumni links. |
| `PUT /api/network/friends` | `{ id: string, friend: boolean }` | `{ ok: true }` (atomic rewrite) |
| `POST /api/network/watch` | `{ hours?: number }` (1–48, default 24) | `{ watch: WatchState }` |
| `DELETE /api/network/watch` | none | `{ watch: null }` |

- **Hosted copy:** all of these are local-only. The web code guards on `canRunLocally` (`apps/web/src/lib/data.ts:190`).
- **Dev server:** Vite's dev server serves the same API through `createApi` (`apps/web/vite.config.ts:28`), so dev works with no extra wiring.
- **Index:** `packages/core/src/network/store.ts` caches `{ mtimeMs, index: Map<key, ids[]>, firstWord: Map<word, keys[]> }`. It rebuilds when the file's mtime changes.

---

## 5. Files to add and change

### Core (`packages/core`)

| File | Change |
|---|---|
| `src/network/types.ts` | **New.** §3.1 types. |
| `src/network/zip.ts` | **New, pure.** `readZipEntries(io: { size: number; read(offset, len): Promise<Uint8Array> }, inflateRaw: (b: Uint8Array) => Promise<Uint8Array>, want: (name: string) => boolean, maxEntryBytes = 25_000_000)`. Details below. |
| `src/network/csv.ts` | **New, pure.** RFC 4180 parser (quotes, `""` escapes, commas and newlines inside quotes, CRLF/LF, BOM). `findHeader(rows, required: string[])` scans for the first row that has every required column, case-insensitive and trimmed. That skips the "Notes:" preamble lines and the comma-only blank rows. |
| `src/network/linkedin-export.ts` | **New, pure.** Details below. |
| `src/network/company.ts` | **New, pure.** §3.3. |
| `src/network/score.ts` | **New, pure.** §3.4. |
| `src/network/store.ts` | **New, Node.** `NETWORK_PATH = "profile/network.json"`. `readNetwork(home)`, `saveNetwork(home, file)` via `writeFileAtomic` (`atomic.ts`; same pattern as `tracking.ts:65-68`), `deleteNetwork(home)`, `networkStatus(home, now)`, `summary(home)`, `peopleAt(home, company)`, `setFriend(home, id, on)`, plus the index cache. |
| `src/network/watch.ts` | **New, Node.** Details below. |
| `src/index.ts` | Export `./network/store`, `./network/watch` and `./network/types` for the server. |
| `package.json` exports | Add `"./network/zip"`, `"./network/linkedin-export"`, `"./network/company"`, `"./network/score"` (pure, for the web). |

**`zip.ts` details**
- Reads only the End of Central Directory and the central directory, then the local header and data of the entries `want()` accepts.
- Handles method 0 (stored) and 8 (deflate).
- Rejects encrypted entries (flag bit 0), ZIP64 and a size over the cap, each with an error code.
- Never inflates any other entry.

**`linkedin-export.ts` details**
- `export const ALLOWED = ["connections.csv", "positions.csv", "education.csv"]`, matched on the entry's **basename**, lower case, so a subfolder still works.
- `isAllowedEntry(name)`.
- `parseConnections(text)`: needs `First Name` and `Last Name`; reads `URL`, `Company`, `Position` and `Connected On`. **It never reads `Email Address`.** The column isn't even looked up: columns are selected by allowlist.
- `parsePositions(text)`: `Company Name`, `Title`, `Started On`, `Finished On`.
- `parseEducation(text)`: `School Name`, `Start Date`, `End Date`, `Degree Name`.
- `buildNetwork(files, { source, fileName, now, keepFriends })` returns `NetworkFile | { error }`.
- Dates are tolerant: "15 Oct 2024", "Oct 2024", "2024", "10/15/24" and ISO.
- Rows without a name are dropped. "LinkedIn Member" rows are dropped.

**`watch.ts` details**
- `downloadsFolder()`:
  - Windows: read the `User Shell Folders` value `{374DE290-123F-4565-9164-39C4925E467B}` with `reg query`, expand `%USERPROFILE%`; fall back to `homedir()/Downloads`.
  - macOS: `~/Downloads`.
  - Linux: `XDG_DOWNLOAD_DIR` from `~/.config/user-dirs.dirs`; else `~/Downloads`.
- `LINKEDIN_ZIP = /^(?:basic|complete)?_?linked_?in_?data_?export[^/\\]*\.zip$/i`, tested after removing a browser's " (1)" suffix.
- `startWatch(home, hours)`, `stopWatch(home)`, `resumeWatch(home)`.
- **The loop** polls `readdir` every 10 s, with no recursion. It only considers names that match the pattern, are modified after `since − 10 min`, and have the same size on two polls 10 s apart. It never opens any other file.
- **On a found file:** run `readZipEntries` with `fs.promises.open` and `zlib.inflateRawSync`, then `buildNetwork`, then `saveNetwork`. Store `found = basename`, then stop.
- **On a parse error:** set `lastError` and keep watching.
- Stops at `until`.
- Uses an `unref()`'d timer, so it never keeps the process alive.

### Server (`packages/server`)

| File | Change |
|---|---|
| `src/api.ts` | The routes in §4 (after `:371`). `startBackground()` (`:497`) also calls `resumeWatch(home)`. `stop()` stops the watcher. |
| `test/server.test.ts` (or a new `test/network.test.ts`) | Route tests against a temp `home`. |

### Web (`apps/web/src`)

| File | Change |
|---|---|
| `lib/network.ts` | **New.** `useNetworkStatus()`, `useNetworkSummary()` and `usePeopleAt(company)`, each with an in-memory cache per key. A `networkChanged()` event bumps a counter, so an import or delete refreshes the Radar and panel. Plus `importZip(file)`, `deleteNetwork()`, `setFriend()`, `startWatch()` and `stopWatch()`. Every function is a no-op when `!canRunLocally`. |
| `lib/zipFile.ts` | **New.** A Blob adapter for `core/network/zip`: `read = (o, l) => file.slice(o, o + l).arrayBuffer()`, `inflateRaw` via `new Response(new Blob([b]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer()`. |
| `lib/referralLinks.ts` | **New, pure.** Every outside URL (§8). Each result goes through `safeUrl` (`@rawjobs/core/text:395`). |
| `lib/referralMessages.ts` | **New, pure.** Templates, `jobRef(job)`, `noteCount(text)`, `aiPrompt(...)`. |
| `lib/peoplePaste.ts` | **New, pure.** The LinkedIn search paste parser (§6.F). |
| `lib/agency.ts` | **New, pure.** `isAgencyPosting(job)`: `job.ats === "bullhorn"`, or the name matches `/\b(staffing|recruitment|recruiting|resourcing|personnel|talent solutions|executive search|search partners)\b/i`. |
| `lib/userState.ts` | §3.2: the types, `EntryPatch` (`:153`), `applyPatch` (`:284-321`), `mergeStates` (`:369-389`), `entryFrom` (`:496-560`), plus `referralWord(entry)`. |
| `lib/clipboard.ts` | `copyText(text, win: Window = window)`: use `win.navigator.clipboard` and `win.document` (`:6-27`). |
| `lib/filters.ts` | Details below. |
| `components/referral/TalkToSomeone.tsx` | **New.** The panel section (§6.A). |
| `components/referral/PersonRow.tsx` | **New.** One ranked person: name, position, "Likely: high" (word plus shape plus colour), why-line, a "How this is worked out" disclosure, Friend toggle, "Add as contact", "Draft a message". |
| `components/referral/ConnectLinkedIn.tsx` | **New.** The guided dialog (§6.B): the existing `Dialog` (`components/Dialog.tsx`), the Downloads toggle, choose or drop a file, progress, errors. |
| `components/referral/SearchLinks.tsx` | **New.** Warm and cold link lists (§6.K). |
| `components/referral/FindFriends.tsx` | **New.** The paste box and results (§6.F). |
| `components/referral/SeePeople.tsx` | **New.** The popup and PiP launcher (§6.G). |
| `components/referral/OutreachCard.tsx` | **New.** The floating card body, used by both PiP and the fallback popup. |
| `components/referral/MessageDrafts.tsx` | **New.** Tabs (the `primitives/Tabs.tsx` pattern used in `pipeline/JobTracking.tsx:49-59`), counter, Copy, Mark as messaged, AI prompt. |
| `components/referral/BookACall.tsx` | **New.** ADPList iframe panel, Topmate link, ethics line. |
| `components/JobDetail.tsx` | Insert `<TalkToSomeone job={job} entry={entry} onUpdate={p.onUpdate} />` **right after `<WhyItMatches …/>` at `:385`**, before `NotCheckedYet` at `:387`. Import near `:44`. |
| `components/pipeline/PeopleTab.tsx` | `PersonCard` (`:124-189`): show the outreach stage as a `Select` (To contact … Referred) and "via". Read and write through the `onUpdate({ outreach })` patch. |
| `components/radar/JobCard.tsx` | Details below. |
| `components/radar/RadarPage.tsx` | Details below. |
| `components/radar/MoreFilters.tsx` | Add the row `["knownOnly", "Only companies where you know someone"]` at `:22-32`, shown when `networkReady || filters.knownOnly`. That mirrors the `surgeOnly` rule at `:26`. Add `filters.knownOnly` to the count at `:67`. |
| `components/radar/FilterSheet.tsx` | `SORTS` (`:9-14`) gains `{ value: "people", label: "People you know" }`. **Show it only when the network is connected**: filter at the two render sites, `RadarPage.tsx:472` and `:664-667`. |
| `components/Settings.tsx` | A new `<NetworkSection/>` on the `"data"` page, after `<TrackingData …/>` (`:481`). It uses `Section` (`:845`) and `Toggle` (`components/ui.tsx:53`). The delete confirm copies the `StartOver` dialog pattern (`:994-1044`). |
| `components/settings/registry.ts` | Add `{ id: "network", page: "data", title: "LinkedIn connections", words: "linkedin connections network referral friends people import export zip downloads delete refresh" }` after `"tracking"` (`:49`). |
| `main.tsx` | Before `createRoot(...)`: when `location.hash` starts with `#card/`, render `<OutreachCardPage/>` (the fallback popup) instead of `<App/>`. |

**`lib/filters.ts` changes**
- `Sort` (`:18`) gains `"people"`.
- `Filters` (`:22-57`) gains `knownOnly: boolean`; `DEFAULT_FILTERS` (`:92-117`) sets `knownOnly: false`.
- `Ctx` (`:121-141`) gains `knownAt?: (j: Job) => number`.
- `passes`: `if (f.knownOnly && !ctx.knownAt?.(j)) return false;`, placed next to `surgeOnly` at `:185`.
- `sortJobs` (`:357-367`): add a 7th parameter `known?: (j) => number`. `people` sorts by known count descending, then score, then newest.
- `chipsOf` (near `:476`): `if (f.knownOnly) chips.push({ key: "known", label: "Know someone there", remove: { knownOnly: false } })`.
- `fromQuery` sort allowlist (`:560`): add `"people"`.
- `toQuery` needs nothing: it is generic.

**`components/radar/JobCard.tsx` changes**
- `Props` (`:14-24`) gains `known?: number` and `reach?: string`.
- Meta (`:150-157`): after the status part, push `reach` (`text-ink`), then `known`. Render `known` as `<span className="inline-flex items-center gap-1"><Users className="rj-icon" aria-hidden />{n} you know</span>` with `title="{n} of your LinkedIn connections work at {company}"`.
- Import `Users` from lucide at `:4`.

**`components/radar/RadarPage.tsx` changes**
- `ctx` (`:131`): add `knownAt`.
- `sortJobs` call (`:177`): pass `known`.
- `card()` (`:361-375`): pass `known` and `reach={referralWord(p.user[g.lead.id])}`.
- `MoreToggles` (`:773`): pass `networkReady`.

### Docs

| File | Change |
|---|---|
| `PRIVACY.md` | §9, in the PRs that add the handling. |
| `docs/plans/referral-finder.md` | This plan, committed with PR 1. |
| `design/components/*` | No new kit component. The panel reuses `rj-drawer__section` and `rj-h` (as `JobDetail.tsx:289-290` does). |

---

## 6. UI behaviour, component by component

### A. "Talk to someone who works here" (panel section)

- **Placement:** after "Why it matched".
- **Header:** `<h3 className="rj-h">Talk to someone who works here</h3>`, with two secondary small buttons on the right:
  - "Find friends at {Company}" (F);
  - "See people at {Company}" (G).
- **Hosted copy** (`!canRunLocally`): only the search links (K).
- **Loading:** fetch `/api/network/people` once per company per page load, cached. Show nothing for under 100 ms, then one line "Looking for people you know…" (the loader rule in `design/README.md`).

| State | Condition | Shows |
|---|---|---|
| Agency | `isAgencyPosting(job)` | A notice (copy §7). Search links for the agency's own recruiters only. No network list. |
| Not connected | `!status.connected` | Invite copy, a primary button "Connect LinkedIn" that opens `ConnectLinkedIn`, then the cold search links. |
| Stale | connected and `ageDays > 60` | A `text-warning-text` line above the list with a "Get a fresh copy" link that opens the dialog. The list still shows. |
| Friends | `people.length > 0` | The top 5 ranked `PersonRow`s and "Show all {n}". Then the "Also at {company}" hint (below). Then the warm search links, folded under "More ways in". |
| Nobody | connected and none | "You don't know anyone at {Company} on LinkedIn yet." Then the warm links (2nd-degree, alumni, past colleagues) and cold links (recruiters, hiring posts, Blind). |

- **"Also at {company}":** `knownPeople(state, jobId)` (`pipeline/detail.ts:81`), filtered to contacts whose `company` has the same `networkKey`, minus people already on this job. Copy: "{Name} is on your {Job title} job at {Company}. Add them here too." with an "Add" button.
- **"How this is worked out":** a `<details>` on each row with a `<dl>` of `PersonPoint`s, each as `+40 You're connected on LinkedIn`, and the band thresholds stated: "60 or more is high, 35 to 59 medium, under 35 low."
- **Book a call** (J): a quiet button at the end of the section.

### B. Connect LinkedIn (dialog)

1. "Open LinkedIn's data page" opens `https://www.linkedin.com/mypreferences/d/download-my-data` in a new tab (verify the URL at build time).
2. Instructions: "Choose **Want something in particular?** and tick Connections, Positions and Education. Then Request archive."
3. "LinkedIn emails you when the file is ready, usually in about 10 minutes. Download it."
4. A toggle, on by default: "Watch my Downloads folder for it, for the next 24 hours". The folder path shows in mono. Clicking step 1 with the toggle on calls `POST /api/network/watch`.
5. A drop zone plus "Choose the ZIP file" (`<input type=file accept=".zip,application/zip">`). The browser reads the ZIP (`lib/zipFile.ts`) and posts the 3 CSV texts.
6. **Live status in `role="status"`:** "Watching your Downloads folder…", then "Found Basic_LinkedInDataExport_10-20-2026.zip. Imported 812 connections." Errors use `role="alert"`.
7. The dialog shows a closing "You can delete the ZIP from Downloads now. RawJobs keeps only names, companies, positions and the date you connected." **Never delete the user's file.**

**Settings → Data & privacy → "LinkedIn connections" card**
- **Not connected:** "Connect LinkedIn".
- **Connected:** "812 connections from LinkedIn, imported 12 days ago." Buttons "Get a fresh copy" (dialog) and "Delete" (danger outline).
- **After 30 days:** the hint becomes "It's been 34 days. Get a fresh copy so new jobs and people show up."
- **Watching:** "Watching Downloads until 14:30. Stop watching."
- **Delete:** an in-page confirm `Dialog`, with the title "Delete your LinkedIn connections?" and buttons "Cancel" / "Delete connections".

### E. Radar

- Covered in §5. Stage words come from `referralWord`.
- The "People you know" sort and the "Know someone there" filter appear only once a network is imported (`networkReady`). A shared link that has them still shows them, so they can be turned off.

### F. Find friends at {Company}

- **Button:** `window.open(referralLinks.findFriends(company), "_blank", "noopener,noreferrer")`. Below the header an inline panel opens:
  - "On LinkedIn, press Ctrl+A then Ctrl+C on the results page, and paste here." (Show ⌘ on macOS, from `platform`.)
  - A `<textarea>` labelled "Paste LinkedIn search results".
- **Parser:** `parsePeoplePaste(text)` returns `{ name, degree: 1 | 2, title?, location?, mutual?: { first: string; others: number } }[]`.
  - Split into lines and trim.
  - A degree marker is a line matching `/^(?:•\s*)?(1st|2nd|3rd\+?)$/` or `/^(1st|2nd|3rd)\s+degree connection$/i`.
  - Name: the nearest earlier line that isn't noise (`View … profile`, `Status is …`, `Connect`, `Message`, `Follow`, `Pending`, `Premium`, a line containing `•`).
  - Title: the next useful line after the marker. Location: the line after that.
  - Mutual: `/^(.+?) and (\d+) other mutual connections?$/` or `/^(.+?) is a mutual connection$/`.
  - Drop 3rd+, "Out of network" and "LinkedIn Member". Dedupe by name plus title. Cap at 100.
- **Storage:** results are kept in a module-level `Map<jobId, Pasted[]>`, so they survive switching jobs but not a reload (§11 Q5). They are never sent to the server.
- **Rows:** each gets a score (`degree` 1 or 2) and "Add as contact".
- **2nd-degree rows** add "Ask {mutual} to introduce you", which copies the intro template (§7) and adds the mutual as a `to-contact` contact on request.
- **No rows found:** "No people found in that. Copy the whole results page (Ctrl+A, then Ctrl+C) and paste again."

### G. See people at {Company}

On click (one user gesture), two things happen.

**1. The LinkedIn window**
- `const w = window.open("about:blank", "rawjobs-linkedin", `popup,left=${screen.availLeft ?? 0},top=${screen.availTop ?? 0},width=${Math.floor(screen.availWidth / 2)},height=${screen.availHeight}`)`.
- Then `w.opener = null; w.location.href = url`. This keeps popup sizing (some browsers turn a `noopener` popup into a tab) while cutting the back-reference.
- The URL is `linkedin.com/company/{slug}/people/?keywords={role}` when a slug is known (none in Release 1; Wikidata P4264 later). Otherwise it is people search with `keywords="{Company}" {role}`.

**2. The floating card**
- If `"documentPictureInPicture" in window`: `await documentPictureInPicture.requestWindow({ width: 380, height: 560 })`.
  - Copy the stylesheets: for each `document.styleSheets` entry, clone the `<link>` or `<style>` node.
  - Set `pip.document.documentElement.dataset.theme` to the current theme (`lib/theme.ts`).
  - `createPortal(<OutreachCard …/>, pip.document.body)`.
- Otherwise: `window.open("/#card/" + encodeURIComponent(job.id), "rawjobs-card", "popup,width=380,height=560,left=…")`. `main.tsx` renders `OutreachCardPage`, which reads the job from `useUserState()` and `useData()`. The `storage` event keeps both windows in sync.

**The card contains**
- The job title and company.
- "Paste their LinkedIn profile link" (validated with `linkedInUrl`), "Their first name".
- "Connection note" with a 200 counter.
- "Copy note", "Copy referral ask", and "Save person" (adds a contact as `to-contact`, via LinkedIn).
- Every copy uses `copyText(text, pipWindow)`.
- Keyboard: Esc closes the card (PiP `pagehide` cleans up the portal). Focus starts on the URL field.

### H. Message drafts (dialog per person)

- **Tabs:** "Connection note" | "Ask for a referral" | "Follow up". Each has an editable textarea prefilled from a template.
- **Counter (Connection note):** `aria-live="polite"`, "142 of 200". At 181–200 it turns `text-warning-text` with "Close to LinkedIn's 200-character limit". Over 200 it turns `text-danger-text` with "Over by 12. LinkedIn won't send it". Never colour alone: words plus an icon.
- **"Copy":** shows a toast, then shows the "Mark as messaged" button (§3.2).
- **"Copy a prompt for your own AI":** copies `aiPrompt()`. A hint says: "Paste it into any AI you use. RawJobs doesn't send it anywhere."

### I. Contact log

- People added from A, F or G go to `Entry.contacts`, with `outreach[cid] = { stage: "to-contact", via: "linkedin", at, networkId?, degree?, mutual? }`.
- `PeopleTab` shows and edits the stage and via.
- The Radar meta shows the stage word.

### J. Book a call

- **Button:** "Book a call with someone there" toggles a panel inside the section:
  - `<iframe src="https://adplist.org/mentors/company/{slug}" title="ADPList mentors at {Company}" loading="lazy" referrerpolicy="no-referrer" sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-popups-to-escape-sandbox" className="h-[28rem] w-full rounded-md border border-line">`.
  - **The iframe loads only after the click**, so nothing reaches ADPList otherwise.
  - Next to it, an "Open in new tab" link.
- **Topmate:** a link to `https://topmate.io/s/{company}` (new tab) labelled "Search Topmate", with the hint "Matches service names, not employer."
- **Ethics line, always shown:** "Pay for advice, never for a referral."
- **Slug:** `slugify(displayName(company))`: lower case, `[^a-z0-9]+` becomes `-`, trimmed. Verify a few known companies at build time.

### K. Search links

All are plain `<a target="_blank" rel={LINK_REL}>`. `LINK_REL = "noopener noreferrer"` comes from `contactLinks.ts:4`; it's stricter than the brief's `noreferrer` and the repo's own convention. Builders live in `lib/referralLinks.ts`.

| Link | URL |
|---|---|
| Friends (1st+2nd) | `https://www.linkedin.com/search/results/people/?keywords=%22{Company}%22&network=%5B%22F%22%2C%22S%22%5D` |
| 2nd-degree | Same, with `network=["S"]` |
| Alumni | people search, `keywords="{Company}" "{School}"`, one per school from Education.csv (at most 2) |
| Past colleagues | people search, `keywords="{Company}" "{Past employer}"`, from Positions.csv plus `profile.past_employers` (`schema.ts:390`), at most 3 |
| Same role | `/company/{slug}/people/?keywords={role}` when a slug is known; else people search `"{Company}" {role}` |
| Recruiters | people search, `keywords="{Company}" (recruiter OR "talent acquisition")` |
| Hiring posts | `https://www.linkedin.com/search/results/content/?keywords=%22{Company}%22%20hiring&datePosted=%22past-month%22` |
| Blind referral threads | `https://www.teamblind.com/search/{Company}%20referral` (verify the pattern at build time) |

---

## 7. Copy strings

Sentence case, no emoji, no em dashes. Voice per `design/README.md`.

**Panel**
- Section title: "Talk to someone who works here"
- Buttons: "Find friends at {Company}", "See people at {Company}", "Connect LinkedIn", "Add as contact", "Draft a message", "Mark as friend" / "Friend", "Show all {n}", "Book a call with someone there"
- Not connected: "A referral is the surest way in. Connect LinkedIn to see who you already know at {Company}. Your connections stay on this computer."
- Nobody: "You don't know anyone at {Company} on LinkedIn yet. These searches find people one step away."
- Agency: "A recruitment agency posted this, so the employer isn't named. Ask the agency's recruiter which company it is, then look for people there."
- Stale: "Your LinkedIn connections are {n} days old. Get a fresh copy to see people who joined since."
- Band: "Likely: high", "Likely: medium", "Likely: low"
- Disclosure: "How this is worked out"
- Recruiter tag: "Recruiter: can route, can't vouch"
- Loose match: "Works at {their company}" (shown when `how === "prefix"`)

**Connect dialog**
- Title: "Connect LinkedIn"
- Steps: as in §6.B
- Watch toggle: "Watch my Downloads folder for the file, for 24 hours"
- Drop zone: "Drop the ZIP here, or choose the file"
- Errors:
  - "That ZIP has no Connections.csv. Request the archive again with Connections ticked."
  - "That file isn't a ZIP from LinkedIn. Choose the file named like Basic_LinkedInDataExport_….zip."
  - "That ZIP is protected with a password, so it can't be read."
  - "That export is too big to read here. Request only Connections, Positions and Education."
  - "Your browser can't open ZIP files. Update it, or turn on Watch my Downloads folder."
- Done: "Imported {n} connections, {p} positions and {e} schools."

**Settings card**
- Title: "LinkedIn connections"
- Hint: "Who you know at each company, from LinkedIn's own export. Kept on this computer only."
- Delete confirm: title "Delete your LinkedIn connections?", body "Your imported connections, positions, schools and friend marks are removed from this computer. People you added to jobs stay." Buttons "Cancel" / "Delete connections".

**Message templates** (`{first}`, `{company}`, `{title}`, `{link}`, `{jobId}`, `{me}`)
- **Connection note:** "Hi {first}, I'm applying for the {title} role at {company} and would love to hear what it's like on your team. Open to a quick chat?"
- **Ask for a referral:** "Hi {first}, I'm applying for {title} at {company} ({link}{, job ID {jobId}}). My background in {topic} fits what the team needs. Would you be open to referring me? I can send my resume and a short note you can forward. Thanks either way."
- **Follow up:** "Hi {first}, following up on my note about the {title} role at {company}. Happy to share more if it helps. Thanks for your time."
- **Intro via mutual:** "Hi {mutual}, I see you know {first} at {company}. I'm applying for their {title} role. Would you be comfortable introducing us? Happy to send a short blurb you can forward."
- **AI prompt:** "Write a short, friendly LinkedIn message (under {limit} characters) from me to {first}, a {position} at {company}. We're {relationship}. I'm applying for {title} ({link}). Ask whether they'd be open to {ask}. No flattery, no buzzwords."

**Radar**
- Row meta: "{n} you know". Filter: "Know someone there". Sort: "People you know". Toggle row: "Only companies where you know someone".

**Book a call**
- "Open in new tab", "Search Topmate", "Matches service names, not employer.", "Pay for advice, never for a referral."

---

## 8. PR sequence, Release 1 (A–K)

Each PR is small, merges through Mergify on its own, and leaves `main` shippable. Every one runs `pnpm check`, includes a "Release note" line, and gets screenshots for visible changes (CLAUDE.md).

### PR 1: Core: read LinkedIn's export (no UI)
- **Files:** `core/src/network/{types,zip,csv,linkedin-export,company,score}.ts`, core exports, and this plan doc.
- **Tests (`packages/core/test/network-*.test.ts`)**
  - Fixture CSVs live in `packages/core/test/fixtures/linkedin/`. All are synthetic: fake names, a "Notes:" preamble, a BOM, CRLF, a quoted `"Acme, Inc."`, a filled Email column, comma-only blank rows.
  - ZIPs are built inside the test with `zlib.deflateRawSync`. No binary is committed. One fixture ZIP also holds `messages.csv`, `Invitations.csv` and a nested `Connections/Connections.csv`.
  - Assert that `inflateRaw` is called only for allowlisted names (spy).
  - Assert that the Email value never appears in `JSON.stringify(result)`.
  - Errors: encrypted, ZIP64, oversize, not-a-zip, missing Connections.
  - Dates in every tolerated format.
  - Company: aliases, stoplist, `EXACT_ONLY` (Apple ≠ Apple Leisure Group), no prefix match at ≤ 4 characters, prefix match for "Kraken Digital Asset Exchange".
  - Score: one row per rule plus the band edges.
- **Release note:** `none`.

### PR 2: Import connections in Settings, with delete (B, without the watcher)
- **Files:** `core/src/network/store.ts`; the API routes `GET/DELETE /api/network`, `POST /api/network/import`, `GET /api/network/summary`, `GET /api/network/people`, `PUT /api/network/friends`; `web/lib/{network,zipFile}.ts`; `ConnectLinkedIn.tsx` (file and drop only; watcher toggle hidden); the Settings `NetworkSection` and registry entry.
- **Privacy:** **PRIVACY.md updated** (§9a), and the stale "Your data" fixed.
- **Tests**
  - Server: round trip on a temp home; the file is atomic (no `.tmp` left); 400 errors; DELETE removes the file; a write without Origin gets 403 (existing guard).
  - Web: the registry test; the card's states; the delete confirm flow (happy-dom, stubbed fetch); `lib/zipFile.ts` with a ZIP built in the test (Blob plus a `DecompressionStream` polyfill or a skip under happy-dom; §11 Q8).
- **Release note:** `New: Import your LinkedIn connections (Settings → Data & privacy) to see who you know at each company. They stay on your computer.`

### PR 3: The panel section (A, K, and C/D in use)
- **Files:** `TalkToSomeone.tsx`, `PersonRow.tsx`, `SearchLinks.tsx`, `lib/{referralLinks,agency}.ts`; `JobDetail.tsx:385`. "Find friends" and "See people" are plain new-tab links in this PR.
- **Tests:** each state (not connected, friends, nobody, agency, stale), the ranking order, the "How this is worked out" contents, every URL builder (exact encoded strings), the hosted copy shows only links.
- **Release note:** `New: Each job shows people you know there, ranked by how likely they are to help, with searches to find more.`

### PR 4: Downloads watcher (B, finished)
- **Files:** `core/src/network/watch.ts`; `POST/DELETE /api/network/watch`; resume in `startBackground`; the dialog toggle and status; the Settings "Watching…" line.
- **Privacy:** **PRIVACY.md** (§9b).
- **Tests:** a temp folder as Downloads (injectable `folder` and `now`); fake timers; ignores names that don't match; ignores files older than `since`; waits for a stable size; imports and stops; keeps watching after a bad ZIP; stops at `until`; resumes after a restart; DELETE stops it; matches the name pattern with " (1)", `Complete_` and different cases.
- **Release note:** `New: RawJobs can pick up your LinkedIn export from Downloads by itself while you wait for it.`

### PR 5: Contact log (I)
- **Files:** `userState.ts` (§3.2); "Add as contact" in `PersonRow`; status Saved on the first contact; `PeopleTab` stage and via; the "Also at {company}" hint.
- **Tests:** `applyPatch` drops outreach for removed contacts; import validation; merge where the newer `at` wins; `referralWord`; adding a contact sets Saved only from undefined or dismissed; existing `tracking.test.tsx`, `pipelineV2.test.ts` and `jobTracking.test.tsx` still pass.
- **Release note:** `New: Track who you asked about each job, from To contact to Referred.`

### PR 6: Message drafts (H)
- **Files:** `MessageDrafts.tsx`, `lib/referralMessages.ts`.
- **Tests:** counter thresholds (180, 181, 200, 201); job ID from `job.id` and from URLs (Workday `R12345`, Greenhouse `gh_jid`); Copy then "Mark as messaged" writes outreach and the activity; the AI prompt holds no data beyond the job and person shown.
- **Release note:** `New: Draft a connection note, a referral ask or a follow-up for each person, and copy it.`

### PR 7: Find friends paste box (F)
- **Files:** `FindFriends.tsx`, `lib/peoplePaste.ts`.
- **Tests:** fixture text files in `apps/web/test/fixtures/linkedin-search/*.txt`, synthetic, imitating today's layout (`• 2nd`, "2nd degree connection", "X and 3 other mutual connections", "X is a mutual connection", 3rd+, "LinkedIn Member", noise lines); empty or garbage input; dedupe; results not persisted (`localStorage` untouched, no fetch).
- **Release note:** `New: Find friends at a company: search LinkedIn, paste the results, and see who can introduce you.`

### PR 8: See people window and floating card (G)
- **Files:** `SeePeople.tsx`, `OutreachCard.tsx`, the `main.tsx` `#card/` route, `copyText(text, win)`.
- **Tests:**
  - `copyText` uses the window passed in;
  - window sizing maths, with `screen` mocked;
  - `w.opener` is nulled;
  - PiP present: `requestWindow` is called and the portal renders;
  - PiP absent: the fallback popup URL;
  - `OutreachCardPage` renders from state;
  - the 200 counter.
- **Release note:** `New: See people at a company opens LinkedIn beside a small RawJobs card for notes and links.`

### PR 9: Radar (E)
- **Files:** `filters.ts`, `JobCard.tsx`, `RadarPage.tsx`, `MoreFilters.tsx`, `FilterSheet.tsx`, `useNetworkSummary`.
- **Tests:** `knownOnly` filtering; the `people` sort; chip; `fromQuery`/`toQuery` round trip with `sort=people`; the sort is hidden when not connected; the row meta renders the Users icon with an aria-hidden icon and the text "3 you know"; stage words.
- **Release note:** `New: The Radar shows how many people you know at each company, with a filter and a sort.`

### PR 10: Book a call (J)
- **Files:** `BookACall.tsx`.
- **Privacy:** **PRIVACY.md** (§9c).
- **Tests:** the iframe only after the click; `sandbox` and `referrerpolicy` attributes; slug cases; a server test that HTML responses carry no CSP, or one that includes `frame-src https://adplist.org`.
- **Release note:** `New: Book a call with a mentor who works at the company, through ADPList or Topmate.`

**Ordering notes**
- PR 3 depends on PR 2. PRs 4, 6, 7, 8, 9 and 10 depend only on PR 3 (or PR 2) and can go in any order. PR 5 must come before PR 6's "Mark as messaged". Otherwise PR 6 ships Copy only and PR 5 adds the button.
- PR 2 has a short gap where Settings can import before the panel uses the data. Keep PR 3 right behind it, or hold the PR 2 release note until PR 3 merges (releases are batched, so this is low-risk).

---

## 9. Privacy changes (PRIVACY.md, in the PR that adds each)

**a) PR 2.** A new row in "What stays on your computer":

| What | Where |
|---|---|
| Your LinkedIn connections (names, profile links, company, position, date connected), your own positions and schools, and who you marked as a friend, from the export you download | `profile/network.json` (gitignored). Delete it in Settings → Data & privacy → LinkedIn connections. |

Plus a paragraph:
- "RawJobs reads only Connections.csv, Positions.csv and Education.csv from the ZIP. It never opens your messages, invitations or anything else in it, and never keeps email addresses.
- Nothing is sent to LinkedIn or anyone else.
- People you paste from a LinkedIn search are kept only while the page is open, unless you add them to a job."

The same PR fixes "Settings → Your data → Sharing" to "Settings → Data & privacy → Sharing".

**b) PR 4.** "While you wait for your LinkedIn file, and only if you leave Watch my Downloads folder on, RawJobs looks at the **names** of new files in your Downloads folder every 10 seconds for up to 24 hours. It opens only a file named like Basic_LinkedInDataExport_….zip, and stops once it finds it." The watch state is `profile/network-watch.json`.

**c) PR 3 / PR 10.** A new section, "Links you open". It covers all R1 links, so add it in PR 3 and extend it in PR 10:
- "Buttons like Find friends, See people and the search links open LinkedIn, Blind, ADPList or Topmate in your browser. Those sites see what you searched for (the company's name, a role) like any visit.
- Book a call shows ADPList's page inside RawJobs once you click it; ADPList sees your IP address and the company.
- RawJobs itself never contacts these sites."

**d) The "No telemetry" section** is unchanged. Also state that the tracking export (Settings) now includes the people and outreach stages you added to jobs.

---

## 10. Later phases (L)

Not detailed. Each needs its own plan and a PRIVACY.md change.

- **L1. People search with the user's own Brave Search API key.**
  - The key goes in `profile/secrets.json`, like Telegram.
  - Query: `site:linkedin.com/in "{company}" "{role}"`, from the user's computer, with **no caching**.
  - Results are shown like pasted search rows (session only).
  - Check Brave's ToS on displaying results, and the rate limits.
- **L2. GitHub org public members.**
  - `api.github.com/orgs/{org}/public_members` (unauthenticated, 60 requests an hour).
  - The org comes from Wikidata P2037 or the user. Engineering roles only.
- **L3. Company team page.**
  - Fetch the company's own `/about` or `/team` under `robots.ts` rules. Low precision; prototype first.
- **L4. Gmail "new position" emails.**
  - `gmail.readonly` is a **restricted** scope: a published app needs Google verification and a CASA security assessment.
  - A per-user OAuth client in "testing" mode works for up to 100 test users, but its refresh tokens expire after 7 days. That's poor UX.
  - **Proposal:** defer the API. Instead offer importing a Google Takeout mbox of one label (the user filters LinkedIn notification emails into it), parsed locally for "started a new position" lines. IMAP with an app password is a fallback, but it means handling credentials.
- **L5. Warm-up release.**
  - A "Get to know people" weekly queue drawn from `to-contact` and `warming` contacts.
  - A checklist for turning on LinkedIn's bell for a person.
  - A touches log (reuse `Activity`) and an "ask window" (ask after N touches or M days).
  - Fits Pipeline v2's weekly plan (`prefs.weeklyPlan.outreach`).
- **L6. Wikidata P4264 (LinkedIn company ID) in the directory build.**
  - Add it beside the P452 industry use in `scripts/catalog/lib/wikidata.ts`.
  - It becomes `linkedin?: string` on directory companies (`core/src/suggest.ts:28` `IndexedCompany`).
  - This turns on the exact `/company/{slug}/people/` links in G and K.
- **L7. EEA DMA Member Data Portability API.**
  - Needs a LinkedIn developer app and 3-legged OAuth. A local open-source app can't keep a client secret.
  - Investigate a PKCE or relay design, or defer.

---

## 11. Risks and open questions

**Risks**
1. **LinkedIn's export and search layouts change.**
   - The parsers find headers by name and are tolerant.
   - Fixtures are synthetic and documented.
   - The paste parser fails with a helpful message, never silently.
   - Add a "Report a problem reading this" link to the issue template (no data attached).
2. **Matching mistakes** (a common-word company, a person's out-of-date company).
   - Handled with `EXACT_ONLY`, the stoplist, no prefix match at ≤ 4 characters, and a visible "Works at {their company}" on loose matches.
   - Also covered by the 60-day stale notice.
3. **The Downloads watcher on unusual setups** (OneDrive Known Folder Move, redirected folders).
   - The folder shown in the UI lets the user notice. Choosing the file still works.
   - Only names are read, and only matching files are opened.
4. **Document PiP is Chromium only** (Chrome/Edge 116+, secure context; 127.0.0.1 qualifies).
   - The fallback popup covers the rest.
   - Popup blockers: both windows must open inside the same click handler, before any `await`. Open the LinkedIn window first, then `requestWindow`. Test that order in Chrome.
5. **Clipboard in PiP:** fixed by `copyText(text, win)`.
6. **The ADPList iframe** could start blocking framing later. Show the "Open in new tab" link whenever the iframe fails, and handle `onLoad`/`onError` with a 5 s timeout.
7. **Size.** A 30k-connection `network.json` is about 5 MB. The summary is computed on the server, and the browser fetches people per company only.
8. **Third-party personal data** (connections' names).
   - It's the user's own export, kept local.
   - Email addresses are dropped, the Delete button is prominent, and nothing is in backups (`profile/backups` covers tracking only).

**Open questions**
1. **Q1.** Keep the contact log in `Entry.outreach`? This plan recommends it; see §0.1. If not, the alternative is a fifth tracking part, `network`, which touches `core/tracking.ts:20-26`, `web/lib/tracking.ts:13`, the export/import and the merge.
2. **Q2.** How long should the watch window be: 24 h, or N set by the user? LinkedIn says a selected-files archive takes about 10 minutes and a complete one up to 24 hours.
3. **Q3.** Should "Friend" tags live in `network.json` (deleted with it, as here) or in tracking prefs (exported with backups)?
4. **Q4.** Should adding the first contact also move a Not interested job to Saved? This plan says yes.
5. **Q5.** Should pasted search results survive a reload (sessionStorage), or stay in memory only, as here?
6. **Q6.** Should users be able to set a company's LinkedIn page by hand before Wikidata P4264 (L6) lands?
7. **Q7.** Should prefix matches count toward the Radar's "N you know"? This plan counts exact and alias matches only, and the panel shows loose ones labelled.
8. **Q8.** Tests for `DecompressionStream` under happy-dom: add a polyfill built on `zlib` in the test setup, or test `lib/zipFile.ts` in Node with a Blob only?
9. **Q9.** Verify before building: the LinkedIn download page URL, Blind's search URL, the Topmate `/s/` pattern, and ADPList slugs for multi-word companies.

### Critical files for implementation
- `C:\Users\tanma\Documents\Claude\Code\job-hunter\apps\web\src\lib\userState.ts`
- `C:\Users\tanma\Documents\Claude\Code\job-hunter\apps\web\src\components\JobDetail.tsx`
- `C:\Users\tanma\Documents\Claude\Code\job-hunter\packages\server\src\api.ts`
- `C:\Users\tanma\Documents\Claude\Code\job-hunter\apps\web\src\lib\filters.ts`
- `C:\Users\tanma\Documents\Claude\Code\job-hunter\packages\core\src\dashboard.ts` (`companyNameKey`, reused by `network/company.ts`)

Also important: `apps/web/src/components/Settings.tsx`, `apps/web/src/components/settings/registry.ts`, `apps/web/src/components/radar/JobCard.tsx`, `apps/web/src/components/pipeline/PeopleTab.tsx`, `apps/web/src/lib/clipboard.ts`, `packages/core/src/atomic.ts`, `PRIVACY.md`.

**Sources for the LinkedIn export format.** These are third-party sources; there is no official LinkedIn spec for the preamble.
- [Juicebox: LinkedIn connections import (the "Notes" section above the header)](https://docs.juicebox.ai/help/data-migration/linkedin-connections)
- [DEV Community: Back up your LinkedIn data (the header line starting "First Name", comma-only rows)](https://dev.to/szabgab/back-up-your-linkedin-data-404d)
- [Biznology: Download your data (Basic_LinkedInDataExport_<date>.zip name)](https://biznology.com/2017/10/reclaim-your-linkedin-connections-as-contact-emails-via-download-your-data/)
- [linkedin-export skill (expects the Connections.csv preamble)](https://skills.cat/skills/tdimino/claude-code-minoan/linkedin-export)

---

## 12. Review changes (2026-10-20). These override the sections above

Five audits (structure, frontend, production readiness, security and privacy, UX) all said "approve with changes". Where this section and an earlier one disagree, this section wins.

### 12.1 New PR sequence

Core release (each PR mergeable and shippable alone):

1. **PR 1, core, no UI.** `packages/core/src/network/`: safe ZIP reader, LinkedIn export parser, company key, person score, paste parser. Pure, fixtures only. `Release note: none`. The exports are unused until PR 2.
2. **PR 2, import, panel and privacy.** This merges the old PRs 2 and 3. It covers `profile/network.json` and its store, the `/api/network*` routes, the import and delete section on Settings → Data & privacy (file pick or drop only), the "Talk to someone who works here" section (A, C, D, K), and the PRIVACY.md sections for the import and for links you open.
3. **PR 3, contact log.** `Entry.outreach`, its stages in Pipeline's People tab, and the Radar stage word.
4. **PR 4, message drafts.**
5. **PR 5, Radar.** Count, filter and sort.
6. **PR 6, Find friends paste box.**

Follow-ups, built after the core release and each mergeable alone:

7. **PR 7, Downloads watcher.** Hidden on macOS in this release (see 12.4).
8. **PR 8, See people card.** One window per click (see 12.6).
9. **PR 9, Book a call.** The ADPList panel ships only if ADPList's terms allow framing; otherwise it is a new-tab link. Topmate is a link.

The old ordering notes are replaced: every PR from 3 on depends on PR 2, and PRs 6, 8 and 9 also depend on PR 3.

### 12.2 Data and storage

- **`Entry.outreach` must survive every path.** `sameV1Ids` (`userState.ts:346-360`) re-keys `outreach` through `renamed`. `capEntry` (`:261`) and `applyPatch` drop outreach keys whose contact is gone. `mergeStates` unions outreach after `sameV1Ids`.
- **Older builds must not drop the field.** PR 3 also makes `entryFrom` (`:496`) keep unknown fields, so a later field survives a rollback. PR 3's notes say that a build older than PR 3 still drops `outreach`; it can be restored from `profile/backups`.
- **`network.json` versions.**
  - `version > 1` means "made by a newer RawJobs": never overwrite it, and show "Update RawJobs to read your connections."
  - A damaged file goes through `readJsonOrSetAside`.
- **One write queue.** Every `network.json` write goes through one in-process promise queue. An import re-reads `friends` inside the queue.
- **One company normalizer.** Export `companyNameWords` from `dashboard.ts`, using the same pipeline as `companyNameKey`, and build both indexes from it. `companyWords` from `employers.ts` is not used. `COMPANY_ALIASES` lives next to `NAME_OVERRIDES` in `display-name.ts`.
- **The index.**
  - Built right after each save, not on the first request.
  - Summary counts are computed once per build.
  - `GET /api/network/summary` sends `ETag: importedAt` and answers 304 when it hasn't changed.
  - `me` (your positions and schools) is returned once by `GET /api/network`, not by every `/people` call.
  - People rows carry `connectedDays`, not the date.

### 12.3 ZIP and import safety

- **Never trust declared sizes.**
  - Node: `zlib.inflateRaw` (async) with `{ maxOutputLength }`.
  - Browser: stream through `DecompressionStream("deflate-raw")` and count bytes, aborting at the cap.
  - Reject an entry when the inflated length differs from the declared size.
- **Header handling.**
  - Take the compressed size, method and CRC from the central directory only.
  - Skip the local header as 30 + its own name length + its own extra length, because LinkedIn's exports set flag bit 3.
  - Bounds-check every offset against the file size.
  - At most 10,000 entries. Entries are allowlisted by basename, and no other entry is ever inflated.
- **Error codes:** `NOT_ZIP`, `ZIP_MALFORMED`, `ZIP_TOO_BIG`, `ZIP_ENCRYPTED`, `NO_CONNECTIONS`, `TOO_BIG`.
- **Request size.** `readBody(req, 12_000_000)`. On overflow return `413 {ok:false, errors:[{code:"TOO_BIG"}]}`, never a 500. The browser checks the size before posting.
- **Caps.** Each CSV is capped at 10 MB, rows at 30,000, and fields at 200 characters.
- **Tests** cover: an understated declared size, a truncated end-of-central-directory, an offset past the end of the file, flag bit 3, an encrypted entry, a BOM, CRLF line ends, and quoted commas.
- **Where tests run.** ZIP tests run in Node's default test environment, not happy-dom.
- **Feature detection.** Check with `try { new DecompressionStream("deflate-raw") }`. If that fails, the dialog shows "Unzip the file and choose Connections.csv".

### 12.4 Downloads watcher (PR 7)

- **Polling.** Use `setTimeout` chaining, not `setInterval`, so polls never overlap.
- **Which files.**
  - Skip 0-byte files, `.part` and `.crdownload` files, and anything that isn't a regular file (check with `lstat`).
  - Remember `(name, size, mtimeMs)` for files already tried, and retry a file only when one of those changes.
  - `EBUSY` or `EPERM` while a file is open means try again next poll; it isn't an error.
- **Windows Downloads folder.**
  - Run `reg query` with `execFile`, `windowsHide` and a 2 s timeout, once per watch start.
  - Expand every `%VAR%`, then `stat` the result.
  - Fall back to `homedir()/Downloads`.
- **macOS.** No toggle in this release: macOS privacy controls usually block a background `node` process from reading Downloads. On any OS, start does one `readdir` straight away; on `EPERM` it returns `NO_ACCESS` with the message "RawJobs can't look in Downloads. Choose the file instead."
- **Watch state.**
  - Kept in `profile/network-watch.json`, so a second server sees a watch is already running.
  - `until` is capped at 48 h; an expired or unreadable state file is deleted at start.
  - Clear the watch timer in `stop()` before its `if (!current) return`.
  - The import is idempotent: the same file, size and modified time never import twice.
- **Logging.** One `server.log` line each for start, found, error code and stop. Log only the basename and size, never contents or names.
- **Telling the page.** While watching, the page polls `GET /api/network` every 10 s. When `importedAt` changes it refreshes and shows "Imported {n} connections from Downloads".
- **Stopping.** The panel's not-connected state shows "Watching Downloads until {time}. Stop".

### 12.5 Security headers and privacy

- **Headers on `/api/network/*`:** `cache-control: no-store`, `x-content-type-options: nosniff`, `cross-origin-resource-policy: same-origin`.
- **Validation.**
  - The `PUT /friends` id must match `/^[un]:[\w-]{1,100}$/` and exist.
  - Never echo the company query in errors or logs.
- **Referrer.** Add `<meta name="referrer" content="no-referrer">` to `apps/web/index.html`.
- **Links.**
  - Every href built from CSV, paste or input goes through `safeUrl` or a profile check.
  - LinkedIn profile URLs must match `^/in/[^/]+`, because `linkedInUrl` accepts any linkedin.com URL.
  - Query parts use `encodeURIComponent`.
- **No `dangerouslySetInnerHTML`** under `components/referral/`; a test greps for it.
- **Paste box.**
  - Memory only: no localStorage, sessionStorage, drafts or report links.
  - Input capped at 1 MB and 100 people. Lines clipped to 200 characters.
  - Never described as "importing" or "scraping".
- **Corrected PRIVACY wording.** "Your connections file (`network.json`) isn't backed up or synced. People you add to a job's contacts are part of your tracking data, so they're in its browser copy, its backups and its exports."
  - The delete-confirm dialog says this too.
  - "Start over" also deletes `network.json`, `network-watch.json` and any `.tmp` next to them.
- **Stale text.** Fix "Settings → Your data" to "Settings → Data & privacy" in PRIVACY.md.

### 12.6 See people card (PR 8)

- **One click, one window.** "See people" opens only the card: Document PiP, or a small popup where PiP isn't available. The card has an "Open LinkedIn beside this" button. That is a second click, which opens `window.open(url, "rawjobs-linkedin", "popup,noopener,noreferrer,left,top,width,height")` on the left half of the screen.
- **When something is blocked.**
  - If `requestWindow` rejects, show the "Open LinkedIn" button inline in the panel instead.
  - If `window.open` returns `null`, show: "Your browser blocked the LinkedIn window. Allow pop-ups for RawJobs, or use the search links."
- **One `PipHost` at App level** holds `{win, jobId}`, so moving between jobs doesn't empty the card. It clears on `pagehide`. Esc is bound on `win`. Closing the card returns focus to the "See people" button.
- **Styles.** Copy each stylesheet into PiP: a `<link>` with an absolute `sheet.href`, or a `<style>` with the rule text. Wait for the links to load before the first render. Follow `rawjobs:theme` events.
- **Inside the card.** No `Toast`, `Menu` or `Select`. Feedback goes in a `role="status"` line in the card.
- **Copying.** `copyText(text, win)` uses the PiP window's `navigator` and `document`.
- **The popup fallback.**
  - It is routed in `app/route.ts` `parseHash` as `card/<jobId>`, with title and company in the hash, so it doesn't load the job list.
  - It never writes tracking itself. "Save person" goes to the opener over `BroadcastChannel("rawjobs-card")`.

### 12.7 UX changes

- **One contact UI.**
  - Once a person is added, their row in the section shows "On this job: {stage}" and opens Pipeline's People tab through a new `initialTab` prop on `JobTracking`.
  - Stages are edited only in `PersonCard`, through a new `onStage(cid, outreach)` callback.
  - "Also at {company}" reuses `knownPeople` and `KnownPicker`.
  - A test checks that a person never has two stage controls.
- **Lighter rows.**
  - Each row shows name, position, band and why. Close contact, Draft and "How this is worked out" sit behind a per-row "More" disclosure.
  - Book a call moves inside "More ways in".
  - Not connected: one line plus "Connect LinkedIn".
  - The section is hidden on Not interested jobs.
- **Words.**
  - "Likely to help: high/medium/low".
  - The manual tag is "Close contact", so it doesn't clash with the "Find friends" search button, which keeps the prototype's label.
  - One word for the Messaged stage everywhere: "Messaged".
- **Saving the job.**
  - Adding the first contact to an unsaved job saves it, with the toast "Saved this job and added {name}" and Undo.
  - "Mark as messaged" has Undo, and works without copying first.
- **Refresh reminder.** From 30 days, a muted line: "Connections imported {n} days ago. Get a fresh copy". From 60 days it uses warning colour.
- **Message drafts.**
  - All three drafts live in the dialog's state, so switching tabs keeps edits.
  - The character counter isn't a live region. It announces only when crossing 181 and 201, linked with `aria-describedby`.
- **Paste results.**
  - A `role="status"` count, a "Clear" button, and the line "Gone when you reload."
  - Zero results: "No people found. Only 1st and 2nd connections show here."
  - LinkedIn's interface in another language: "Set LinkedIn to English to use this."
- **Close contact toggle.** It has `aria-pressed` and the accessible name "Mark {name} as a close contact". "Show all" moves focus to the 6th row.
- **ADPList panel.**
  - The toggle has `aria-expanded` and `aria-controls`.
  - "Open in new tab" and "Close" come before the iframe.
  - Fall back to the link when nothing loads within 5 s.
  - `sandbox` without `allow-forms`, and `referrerpolicy="no-referrer"`.
- **Shortcuts.** No new single-key shortcuts. A test checks that Esc in a nested dialog keeps the job open.
- **Copy fixes.**
  - Password-protected ZIP: "That ZIP has a password, so RawJobs can't read it. Request a new archive from LinkedIn."
  - Agency: "…and may not name the employer".
  - Topmate: "Topmate searches service titles, not employers. Check each profile."

### 12.8 Frontend details

- **`sortJobs` takes an options object**: `sortJobs(jobs, sort, opts)`. Update both callers.
- **`sortsFor(networkReady)`** is used at all three sort sites, including `FilterSheet.tsx:50`.
- **Company counts are memoized by company name** inside the `ctx` deps, so `companyNameKey` runs once per company, not once per job.
- **JobCard** takes only `known?: number` and works out the stage word from `entry`. The meta line order is: status, "N you know", then the existing fact.
- **`usePeopleAt`.**
  - A module cache keyed by `networkKey`, with in-flight requests deduplicated, read through `useSyncExternalStore`.
  - Drop a response whose key is no longer current.
  - Scores go through `useMemo`.
- **Paste parser.**
  - Matches `Name • 2nd` on one line and on two lines, and `3rd+` with a space before it.
  - Uses "View {name}'s profile" (both apostrophes) as the strongest name anchor.
  - Dedupes doubled name lines and ignores navigation text.
  - Parses on paste or through `useDeferredValue`, not on every keystroke.
- **`NetworkSection`** is its own file, `components/settings/NetworkSection.tsx`. The confirm dialog is shared with "Start over".
- **Corrections to §0.**
  - `route(url, req, res)` already receives `req`, so read the query with `new URL(req.url!, "http://x")`.
  - `PARTS` is at `packages/core/src/tracking.ts:26`.
  - `readBody`'s cap is 12 MB.
- **PiP types.** If TypeScript's DOM lib lacks `documentPictureInPicture`, add a small `declare global`.

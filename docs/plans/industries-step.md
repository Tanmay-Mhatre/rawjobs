# Industries step: fix plan

Team: UX designer, frontend engineer, resume-matching engineer, product manager; round table, then tech-lead review. Detection rules were sent back once, then challenged by a skeptic and re-tested on 23 sample resumes.

## Decision summary

One PR with three parts, all offline.

1. **Nothing moves.** Delete `relevantIndustries()` and every sort in `IndustriesStep`. Groups appear in `INDUSTRY_GROUPS` (catalog) order, chips inside each group in catalog order, and every group is always rendered. The "Show all industries" button is removed. Clicking a chip changes only its own fill and icon.
2. **Suggestions come from the resume only, and say why.** The "From your resume" card at the top holds the suggestions. It shows the evidence in one line (e.g. "stablecoin ×9, payments ×6") and pre-selects only strong matches. Topics (`draft.keywords`) and current picks (`draft.industries`) never feed suggestions or ordering.
3. **Garbage in is caught at step 1.**
   - A core `resumeTemplate()` check flags an unfilled template. Step 1 then shows an amber warning with Replace, and nothing is prefilled from it.
   - Resume detection ignores headings, contact lines, placeholders and the Work-authorization / Visa / Interests / References / Languages sections.
   - Bare "mobility" leaves the resume `terms` and `CV_DICTIONARY`.

**How the disagreements were settled:**
- **No ordering at all, rather than an order frozen at mount.** The frontend engineer's Settings point checks out. `Settings.tsx:140-143` renders `ResumeStep` and `IndustriesStep` on one page, and `suggest` is a `useMemo` over the resume text. An order frozen on mount would go stale there, and one recomputed on resume change would move things. The top card already puts resume suggestions first, so sorting the groups adds nothing. With no sort there is nothing to freeze, nothing to test for staleness, and the reported bug cannot come back.
- **No pinned "Your industries" card, "Picked (N)" row or per-group disclosure.** Each duplicates chips or adds movement. The UX designer and the PM withdrew their own versions. "Where did it go?" is answered three ways: the chip stays where it was clicked, focus stays on it (React keys are stable ids), and the footer lists the picks by name.
- **Light detection now, weighted scoring later.** The matching engineer's zones, weights, recency and caps were tuned on 6 fixtures and depend on `rolesFromResume`, which misreads some lines. This PR ships only the parts that remove the bug class: ignored sections, heading and placeholder stripping, the term fixes, and an evidence-returning API. Weighted scoring can follow behind the same `industryEvidence` contract.

## User experience (before / after)

**Before (the reported resume):**
- Step 1 accepted an empty cv-tailor template without comment.
- Its heading "WORK AUTHORIZATION & MOBILITY" silently became a "mobility" topic. There is no Topics step in the wizard; `STEP` is welcome, resume, roles, locations, industries, review.
- That topic matched the `mobility` industry term (`industries.ts:413`). "Industry, energy & transport" sorted first, and because every other group had 0 hits, `visible` hid the crypto and finance groups behind "Show all industries".
- Every click re-sorted the groups and chips (`steps.tsx:711-736`).

**After:**

1. **Step 1 with a template.** The summary is replaced by an amber box:
   > "This looks like an empty resume template (it still has placeholders like [Your Name]). We won't fill anything from it. Replace it with your filled-in resume, or skip and pick things yourself."
   
   It has a primary **Replace** button and a quiet "Use it anyway" link (which clears the flag for this text). Nothing is prefilled.
2. **Step 1 with a real CV.** "Suggested from your resume" gains an **Industries** row (Crypto & Web3, Payments, Fintech) next to Titles, Places and Topics, so a wrong guess shows up in the step where the CV was given.
3. **Industries step.** The top card reads "From your resume: click to add or remove". Chips appear strongest first, at most 5, with up to 3 pre-selected. Under them is one muted line:
   > "Your resume mentions stablecoin ×9, payments ×6, crypto exchange ×3."
   - With an AI profile the line reads "From your master resume profile."
   - With no resume but chosen roles, the card is titled "Suggested from your roles" and has no evidence line.
   - With nothing detected, the card is replaced by one line: "We didn't spot an industry in your resume. Pick any below, or skip: your jobs are still found by your roles and places."
   - With a template: "Your saved resume looks like an empty template, so nothing is suggested. Replace it in step 1 (Resume)."
4. **Below the card:** search and "Clear all", then all 7 groups in catalog order with all chips. Clicking toggles in place. Search only filters within groups, as today.
5. **Footer:**
   > "3 picked: Crypto & Web3, Payments, Fintech. Companies in these industries are scanned…"
   
   The list stops after 6 names and adds "and N more". A visually hidden `aria-live="polite"` region says "Added Payments. 3 picked." or "Removed Payments."

## Detection changes (revised after review)

The final rules take five fixes from the skeptic, change one, and add one rule of my own. Every case gives the expected result on the last run: the original fixtures (a) to (f), the skeptic's A1 to A9, and my new checks M1 to M5. No repo files were changed. A temporary copy was put in the repo root for each run and deleted afterwards.

### Responses to the skeptic

| # | Claim | Verdict | Evidence |
|---|---|---|---|
| 1 | The phone-number filter deletes date ranges written with a plain hyphen | **Accepted** | "2021 - 2024" matched the phone pattern. With the fix, A1 gives crypto=4. M1 shows "+971 50 123 4567" and "(044) 555-1234" are still removed, while "2019-2022" is kept. |
| 2 | A LinkedIn PDF export loses Top Skills and the headline | **Accepted** | Added "top skills" and "honors-awards" to the keep list. A2 now gives crypto=6 and payments=4. |
| 3 | Wrapped PDF lines get past the 20-word limit | **Accepted** | New limits: 6 lines, 8 words per line, 4-line look-ahead for a date range. A3 gives crypto=6 and A6 gives crypto=7. |
| 4 | The one-line rule removes real Experience bullets | **Accepted** | The one-line rule now uses a narrower list. A8 gives payments=5. M5 shows a "Visa:" bullet is kept and a "**Languages**:" line is still removed. |
| 5 | Numbered publications make a researcher's CV look like a template | **Accepted** | Replaced `\d+%?` with `x+%?\|n\|number\|amount`. A4 is no longer a template (biotech=11). M4 shows "[X%]" and "[N]" still count as placeholders. |
| 6 | Interests after a dash, and bold "**Interests**:" labels, leak gaming | **Accepted** | A5, A5b and A9 now give construction only. |
| 7 | A 4-line role block loses its company line | **Accepted** | The 4-line look-ahead keeps "Crypto.com" in A7. |
| Residual | An Interests sentence over 8 words "can produce an unselected gaming chip … but not a pre-selection" | **Rebutted** | M3 is a single 13-word Interests sentence. It gave gaming=3, so Gaming was **pre-selected**. The 8-word limit also let "UAE Golden Visa holder. Open to relocation… global mobility programme alumni." leak back into (b), (c) and (c2). **My fix:** the first line after a removed-section heading may have up to 40 words; later lines still have the 8-word limit. M3 now gives construction only. The Visa line is removed from (b), (c) and (c2), and their evidence is unchanged. A3 and A6 still pass: their prose or bullets come after at least one short line, so they arrive as the second or later line. |
| Tie | Payments and Crypto are tied on (b) and (c) | **Agreed** | The test checks that both are in the top 2 and both are pre-selected. No tie-break. |

### Rules (`resume-parse.ts`)

```ts
const KEEP_SECTIONS = ["summary","professional summary","executive summary","career summary","profile","professional profile","personal profile","personal statement","objective","career objective","about","about me","overview","experience","work experience","professional experience","relevant experience","employment","employment history","work history","career history","professional background","career highlights","highlights","key achievements","achievements","accomplishments","selected achievements","education","academic background","qualifications","skills","technical skills","core skills","key skills","skills inventory","core competencies","competencies","expertise","areas of expertise","tools","technologies","tech stack","certifications","certification","certificates","licenses","licences","courses","training","professional development","projects","selected projects","key projects","awards","honors","honours","publications","volunteering","volunteer work","volunteer experience","leadership","memberships","affiliations","professional memberships","positioning","top skills","honors-awards"];
// Section headings only. The one-line rule (INLINE_SKIP) uses a narrower list.
const SKIP_SECTIONS = ["languages","language","language skills","interests","hobbies","personal interests","outside work","references","contact","contact details","contact information","personal details","personal information","work authorization","work authorisation","visa","visa status","right to work","relocation","mobility","global mobility","availability","notice period","nationality"];
const KEEP_SET = new Set(KEEP_SECTIONS), SKIP_SET = new Set(SKIP_SECTIONS);

function headingKind(line: string): "skip" | "keep" | null {
  let t = line.trim().replace(/^#{1,6}\s+/, "").replace(/\s*:$/, "").replace(/^(\*\*|__)(.*)\1$/, "$2").trim();
  t = t.replace(/\s*\([^)]*\)\s*$/, "").replace(/\s*:$/, "").trim().toLowerCase().replace(/\s+/g, " ");
  if (!t || t.length > 50) return null;
  const parts = t.split(/\s*(?:&|\+|,|\/|\||—|–|\band\b)\s*/).filter(Boolean);
  if (!parts.length || parts.length > 3) return null;
  if (parts.every((p) => SKIP_SET.has(p))) return "skip";
  if (parts.every((p) => SKIP_SET.has(p) || KEEP_SET.has(p))) return "keep";
  return null;
}
// Leaves out visa / mobility / availability / contact: these also start real bullets ("Visa: launched card issuing…").
const INLINE_SKIP = new RegExp(String.raw`^\s*(?:[-*•]\s*)?(?:\*\*|__)?(?:languages?(?:\s+(?:skills|spoken))?|(?:personal\s+)?interests|hobbies|references|nationality|visa\s+status|work\s+authori[sz]ation|right\s+to\s+work|notice\s+period|relocation|hobbies\s*(?:&|and)\s*interests)(?:\*\*|__)?\s*[:—–](?:\*\*|__)?\s*\S`, "i");
const DATE_RANGE = /\b(?:19|20)\d{2}\s*(?:[–—-]|to)\s*(?:(?:[a-z]{3,9}\.?\s+)?(?:19|20)\d{2}|present|current|now|today)\b/i;
const SKIP_MAX_LINES = 6, SKIP_MAX_WORDS = 8, SKIP_FIRST_MAX_WORDS = 40;
const PLACEHOLDER = /\[(?:your\b[^\]\n]{0,30}|name|full name|company(?: name)?|employer|(?:job )?title|role|position|dates?|start date|end date|month|year|city|country|location|phone(?: number)?|email(?: address)?|school|university|degree|institution|x+%?|n|number|amount)\]/gi;
const EMPTY_LABEL = /^\s*(?:[-*•]\s*)?[A-Za-z][A-Za-z /&]{1,30}:\s*$/;

export function resumeBody(text: string): string {
  const cleaned = text.replace(/\r\n?/g, "\n")
    .replace(/<!--[\s\S]*?(?:-->|$)/g, " ")
    .replace(/\[([^\]\n]{1,80})\]\((?:[^)\s]+)\)/g, "$1")
    .replace(PLACEHOLDER, " ")
    .replace(/\[[^\]\n]{1,40}\]|\{\{[^}\n]*\}\}/g, " ")
    .replace(/\blorem ipsum\b[^\n]*/gi, " ")
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, " ")
    .replace(/\b(?:https?:\/\/|www\.)\S+|\b[\w-]+(?:\.[\w-]+)*\.(?:com|io|org|net|me|dev|ai|co)\/\S*/gi, " ")
    .replace(/\+?\d[\d\s().-]{6,}\d/g, (m) => (m.replace(/\D/g, "").length >= 9 && !DATE_RANGE.test(m) ? " " : m)); // phones, not "2021 - 2024"
  const lines = cleaned.split("\n").map((l) => l.trim()).filter(Boolean);
  const out: string[] = [];
  let skipping = false, skipped = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const kind = headingKind(line);
    if (kind || /^#{1,6}\s/.test(line)) {
      skipping = kind === "skip"; skipped = 0;
      if (!kind) out.push(line.replace(/^#{1,6}\s+/, "")); // "### Binance — Senior PM" is evidence
      continue;
    }
    if (skipping) {
      const words = line.split(/\s+/).length;
      const roleAhead = lines.slice(i, i + 4).some((l) => DATE_RANGE.test(l)); // company/title/location/dates
      // The first line of a removed section may be one long sentence ("Interests" / "Work Authorization"); later lines must be short.
      if (++skipped <= SKIP_MAX_LINES && words <= (skipped === 1 ? SKIP_FIRST_MAX_WORDS : SKIP_MAX_WORDS) && !roleAhead) continue;
      skipping = false;
    }
    if (INLINE_SKIP.test(line) || EMPTY_LABEL.test(line)) continue;
    out.push(line);
  }
  return out.join("\n");
}

const wordCount = (s: string) => (s.match(/[\p{L}\p{N}]+/gu) ?? []).length;
export function resumeTemplate(text: string): string[] | null {
  const seen = new Set<string>();
  const distinct = (text.replace(/<!--[\s\S]*?(?:-->|$)/g, " ").match(PLACEHOLDER) ?? [])
    .map((p) => p.trim()).filter((p) => !seen.has(p.toLowerCase()) && seen.add(p.toLowerCase()));
  const emptyLabels = text.split(/\r?\n/).filter((l) => EMPTY_LABEL.test(l)).length;
  if (distinct.length >= 3) return distinct;
  if ((distinct.length >= 1 || emptyLabels >= 4) && wordCount(resumeBody(text)) < 80) return distinct.length ? distinct : ["empty fields"];
  return null;
}
```

**`industries.ts`.** This is unchanged from the revision. Each industry has one pattern with its terms longest first, so "cross-border payments" or "core banking" counts once, not twice.

```ts
export type IndustryEvidence = { id: string; count: number; terms: [string, number][] };
export function industryEvidence(text: string, minMentions = 2): IndustryEvidence[] {
  const lower = text.toLowerCase(), out: IndustryEvidence[] = [];
  for (const ind of INDUSTRIES) {
    const terms = [...ind.terms].sort((a, b) => b.length - a.length);
    const re = new RegExp(terms.map((t) => `(?:${termRegex(t).source})`).join("|"), "giu");
    const byTerm = new Map<string, number>();
    for (const m of lower.matchAll(re)) { const term = terms.find((t) => termRegex(t).test(m[0])) ?? m[0]; byTerm.set(term, (byTerm.get(term) ?? 0) + 1); }
    const count = [...byTerm.values()].reduce((s, n) => s + n, 0);
    if (count >= minMentions) out.push({ id: ind.id, count, terms: [...byTerm].sort((a, b) => b[1] - a[1]).slice(0, 3) });
  }
  return out.sort((a, b) => b.count - a.count); // ties keep catalog order
}
export const industriesFromText = (text: string, min = 2) => industryEvidence(text, min).map((e) => e.id);
```

**Pre-select rule:** an industry is pre-selected when its count is 3 or more, up to 3 industries, and never when the resume is a template. The catalog edits from the plan still apply: bare "mobility" is removed, and hospital, clinic, registered nurse and nursing are added to Healthcare.

### Fixture table (observed on the final run)

| Fixture | Template? | Industries (count) | Pre-selected |
|---|---|---|---|
| (a) real `profile/resume.md` (cv-tailor template) | `["[Your Name]","[Company]","[Title]"]` | none | `[]` |
| (b) crypto PM, markdown | no | payments=11, crypto=11, fintech=2, banking=2, regtech=2 | payments, crypto |
| (c) crypto PM, PDF text, Languages first | no | payments=12, crypto=12, fintech=2, banking=2, regtech=2 | payments, crypto |
| (c2) Languages, then an unrecognised heading | no | same as (c); "BINANCE" and the title line are kept | payments, crypto |
| (d) nurse | no | healthtech=9 | healthtech |
| (e) civil engineer, one-line Interests | no | construction=5 | construction |
| (e2) civil engineer, Interests section | no | construction=5 | construction |
| (f) 59-word resume with "[link]" | no | payments=4 | payments |
| A1 dates with a plain hyphen after Languages | no | crypto=4, payments=2 | crypto |
| A1b same with an en dash | no | crypto=4, payments=2 | crypto |
| A2 LinkedIn "Save to PDF" export | no | crypto=6, payments=4 | crypto, payments |
| A3 Contact block, then a summary with no heading | no | crypto=6, payments=2 | crypto |
| A4 researcher CV, publications numbered [1] [2] [3] | no | biotech=11 | biotech |
| A5 "Interests — video games, esports" | no | construction=4 | construction |
| A5b "**Interests**:" then list lines | no | construction=4 | construction |
| A6 page-2 bullets after a sidebar section | no | crypto=7, payments=2 | crypto |
| A7 4-line role block after Languages | no | none ("Crypto.com" kept) | `[]` |
| A8 bullets starting "Visa:", "Mobility:", "Availability:" | no | payments=5, mobility=2 | payments |
| A9 Hobbies line in Title Case | no | construction=4 | construction |
| M1 phone numbers next to "2019-2022" | no | payments=3 (phones removed, dates kept) | payments |
| M2 Languages first line of 11 words | no | construction=4 ("Gaming club" leaks, count 1) | construction |
| M3 13-word Interests sentence about gaming | no | construction=4 (was gaming=3, pre-selected) | construction |
| M4 "[Your Name]", "[X%]", "[N]" | `["[Your Name]","[X%]","[N]"]` | none | `[]` |
| M5 "- Visa: card issuing…" and "- **Languages**: …" | no | payments=2 (Visa bullet kept, Languages line removed) | `[]` |

### Tests to add

- **(b)/(c):** payments and crypto are both in the top 2 and both pre-selected. No tie-break.
- **Longest-first counting:** "cross-border payments" counts 1 and "core banking" counts 1. Check that `employers.ts` (minimum 1) gives the same results.
- **One test for each skeptic fix:** A1, A2, A4, A5b, A8.
- **First-line rule:** M3.

### Remaining known limits

1. **Short lines just after a removed section can disappear.** The 6-line and 8-word limits mean that, after an unrecognised heading, real lines of 8 words or fewer can be lost (up to 5 lines after the first). Examples are a short summary line, or a LinkedIn headline of 8 words or fewer, as in A2. A date range within 4 lines stops this. The first line of a removed section is dropped if it has up to 40 words, so one real sentence placed straight after a removed heading by a two-column PDF is lost.
2. **Leaks after the first line.** In a removed section, a later line of more than 8 words (a referee's bio, a second Interests sentence) ends the removal and stays in. It can add a count of 1 or 2 to an industry, and reaches pre-selection only if it repeats industry words.
3. **Word tables.** In two-column Word files built as tables, `htmlToMarkdown` in `extract.ts` joins the paragraphs inside a cell with no separator ("LanguagesEnglishArabic"). That breaks heading recognition and whole-word matching, and needs a separate fix in `extract.ts`.
4. **Tied counts.** Ties (payments and crypto on (b) and (c)) show in catalog order.
5. **Bracketed false positives.** A real resume with 3 or more leftover placeholders ("[Company]", "[X%]") is flagged as a template; "Use it anyway" covers this. Link-style brackets and numbered references don't trigger it.
6. **English only.** The heading vocabulary is English only. Headings in other languages are kept as content, so they can only add evidence, never remove a section.
7. **Phone-number residue.** Removing a phone number can leave stray `| (` characters behind. This has no effect on matching.


## UI changes (exact behaviour)

- **Ordering.** Groups come from `INDUSTRY_GROUPS` in catalog order and chips come from `g.ids` in catalog order. There is no sort, no `hits`, no `first`, no `visible`/`hidden`/`showAll`, and nothing that reads `draft.industries` or `draft.keywords` for layout. Keys stay `g.label` and the id.
- **Search.** It filters with `matches` exactly as today. A group with no matches is skipped while searching. ToggleChips' existing behaviour still lists picked chips that don't match at the end of their own group; that is acceptable and only happens during search.
- **Where picks go.** A pick stays where it was clicked. It also shows in the top card if it is a suggestion; both copies share the same state.
- **Suggestion card contents.**
  - `fromResume` = `suggest.industries`.
  - If that is empty and there is no template, use `useMemo(() => industriesFromTitles(draft.include), [draft.include.join("\n")])` and title the card "Suggested from your roles".
  - The card only changes when the resume or the roles change, never when a chip is clicked.
- **Evidence line.** Built from `suggest.industryWhy` for the ids shown: the first 3 terms across them, with counts.
- **Empty and template states.** Use the copy in the user-experience section above. The template state shows text that points back to step 1. `IndustriesStep` has no step-navigation prop today, so there is no link; see open question 2.
- **Accessibility.** One `sr-only` `role="status"` element. Its text is set inside the `update` wrappers of both ToggleChips `onChange` calls by comparing the old and new `draft.industries`.

## File-by-file change list

1. **`packages/core/src/catalog/industries.ts`**
   - Edit the `mobility` and `healthtech` terms.
   - Add `industryEvidence`.
   - `industriesFromText` becomes a wrapper around it.
2. **`packages/core/src/resume-parse.ts`**
   - Add `resumeBody` and `resumeTemplate` (both exported).
   - In `detectFromResume`, add the template short-circuit and compute industries from evidence over `resumeBody`.
   - Add `template` and `industryWhy` to `Detected`.
3. **`apps/web/src/lib/suggest.ts`**
   - `Suggestions` gains `template: string[] | null` and `industryWhy: Record<string, [string, number][]>`, with defaults in `NO_SUGGESTIONS`.
   - `buildSuggestions` sets them. With an AI profile, the template check is skipped and the AI industries win.
   - `prefillDraft`: if `s.template`, return `{}`. Apply the offline pre-select rule (count ≥ 3, at most 3).
4. **`apps/web/src/setup/ResumeStep.tsx`**
   - `SavedResume`: when `suggest.template` is set, show the amber box (`bg-warning-subtle/50 text-warning-text`, the same style as line 320) quoting the first 2 placeholders, with Replace and "Use it anyway". Hide the summary and the Fill button.
   - Add `<Row label="Industries" items={suggest.industries.map(industryLabel)} />`.
   - Include `industries` in the `nothing` check so a resume with only industries still shows the summary.
5. **`apps/web/src/setup/steps.tsx`**
   - Delete `relevantIndustries`, the sort, `showAll` and the "Show all" button.
   - Add the roles fallback for the card, the evidence line, the empty and template copy, the footer that names the picks, and the live region.
   - Remove the now-unused `matchesTerm` and `ChevronDown` imports if nothing else uses them.
6. **`apps/web/src/setup/presets.ts`:** remove `mobility`, add `micromobility`.
7. **Stale prefill (small).** In `ResumeStep`, when a resume replaces one whose suggestions were a template, change the Fill button to "Fill from this resume". Its patch is `prefillDraft({ ...draft, keywords: {}, industries: [] }, suggest)`: it refreshes topics and industries even though they aren't empty. It is a button, never automatic.
   - This user's existing template-derived "mobility" topic only came from the old code path, so it is not detectable after the fact. For them, the visible symptom goes away because topics no longer drive Industries; see open question 1.

## Tests

**`packages/core/test/industries.test.ts`**
- `industryEvidence` on a crypto/fintech PM resume returns crypto first, includes payments and fintech, and includes term counts.
- "WORK AUTHORIZATION & MOBILITY" plus "open to global mobility" gives no `mobility` industry. "shared mobility platform" ×2 does.
- A registered-nurse resume ("Registered Nurse, St. Mary's Hospital", patient care) gives `healthtech`.
- The existing `industriesFromText` tests and the "everyday words" tests stay unchanged and green.
- `industriesFromTitles(["Mobility Product Manager", …])` behaviour is unchanged.

**`packages/core/test/resume.test.ts`**
- `resumeTemplate` flags the cv-tailor skeleton ("# MASTER RESUME — [Your Name]", headings only, "## WORK AUTHORIZATION & MOBILITY") and returns `["[Your Name]", …]`.
- It returns null for a 400-word real resume with one `[link]`, and for a short real 60-word resume with no placeholders.
- `detectFromResume` on the template returns empty titles, keywords and industries, with no "mobility".
- On a real resume with an "Interests: gaming, football" section, gaming and sports are absent.
- Update the tiny-input `toEqual`.

**`apps/web/test/setup.test.ts`** (or a new `suggest.test.ts`)
- `buildSuggestions(template)` sets `template`, and `prefillDraft` returns `{}`.
- Offline pre-selection is at most 3 and only ids with count ≥ 3.
- With an AI profile, the template is ignored and up to 4 are pre-selected.

**`apps/web/test/industriesStep.test.tsx`** (new; happy-dom, Harness pattern from `dealbreakers.test.tsx`)
- Record all group headings and every chip button name. Click chips in two different groups.
- Assert both lists are identical and `document.activeElement` is still the clicked chip.
- All 7 groups render, with or without suggestions, and there is no "Show all industries".
- A draft with `keywords: { mobility: 3 }` and no resume industries renders groups in catalog order, with no transport-first.
- The live region reads "Added Payments. 3 picked."; the footer names the picks.
- Template suggestions show the template line and no pre-selected chips.
- Roles-only (`include: ["registered nurse", "nurse practitioner"]`) shows "Suggested from your roles" with Healthcare.

## Rejected ideas and why

- **Freezing a relevance sort at mount** (lazy `useState`): it goes stale in Settings, where the resume and industries share a page, and it is unnecessary once the top card carries the suggestions.
- **Moving the "top group" to the front once:** the same staleness problem, and it adds nothing beyond the card.
- **Append-only pinned "Your industries" card, "Picked (N)" row:** they duplicate chips and grow or shrink while the user clicks, which is the "something moved" problem in another form.
- **Collapsible per-group disclosure, the `keepSelected` prop, a flat "Matches" search mode:** more UI and state for about 50 chips that fit in one scroll. Hiding groups is how this bug hid the right group in the first place.
- **"Fewer than 150 words means template":** it would insult people with short real CVs. Placeholders are required.
- **Full weighted, recency-aware section scoring in this PR:** the weights are speculative and it depends on `rolesFromResume` quirks. Deferred behind the `industryEvidence` contract.
- **Recency down-weighting:** a product choice nobody asked for. It would drop banking for a fintech PM.
- **Roles or topics influencing order:** topics are silent prefills the user never sees. Roles only appear as the fallback card contents.
- **Employer-name lookup** (Rain → crypto): needs a per-company tag API. Follow-up.

## Owner decisions (proposed)

1. Remove the leftover "mobility" topic from rawjobs.config.local.yaml; the installed app has no saved setup yet.
2. Template notice on the Industries step: plain text pointing to step 1, no button.
3. Offline pre-selection: count of 3 or more, at most 3.
4. Weighted, recency-aware scoring: parked until real resumes show misses.
5. Word two-column tables joining words (extract.ts): separate follow-up.

Files checked: `apps/web/src/setup/steps.tsx:703-824`, `packages/core/src/catalog/industries.ts:409-417,582-626`, `packages/core/src/resume-parse.ts:154-206`, `apps/web/src/lib/suggest.ts`, `apps/web/src/setup/ResumeStep.tsx:494-560`, `apps/web/src/setup/presets.ts:69`, `apps/web/src/components/ToggleChips.tsx`, `apps/web/src/components/Settings.tsx:140-143`, `packages/core/src/employers.ts:157`, `packages/core/test/industries.test.ts`, `packages/core/test/resume.test.ts:93-108`.
## As built (differences from the plan)

- No "Use it anyway" link on the template warning, and no "Fill from this resume" refresh button. A template has nothing to fill from, and a real resume with three or more `[Company]`-style placeholders is rare. Both can follow if anyone hits them.
- Section headers with a Clear action (`Field`) reserve the button's height, so the first pick in a group no longer pushes its chips down 7px. This applies to every setup step.
- Verified in the dev app: step 1 lists industries ("Payments · Crypto & Web3 · Regtech · Banking", with no Mobility or Gaming for a resume that has Interests and Work-authorization sections). On the Industries step, clicks in four groups moved nothing (0px), and the template warning shows on both steps.

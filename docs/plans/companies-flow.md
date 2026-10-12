# Companies flow: directory + suggestions (plan v1)

Status: **final draft for approval**. Built from the v0 draft, two independent research reviews (Data & Sourcing; Product & Matching), a debate round, and the user's decisions (2026-10-04).

## Goal
Users pick companies from a large shared directory instead of hunting for careers links, and get **suggestions that fit them, without AI**: rule-based, explainable, private. Adding by link stays as a fallback, and new companies can be shared back to the directory (opt-in).

## Decisions
| # | Decision | Source |
|---|---|---|
| 1 | Seed a **big dump** of companies (10–20k live boards); users can add more; refreshed regularly | User + Data |
| 2 | **Hybrid**: one central directory upstream; companies users add can be shared back (opt-in) so everyone benefits | User |
| 3 | Monitoring of stale links, ATS switches and subsidiaries is **phase 2**, not phase 1 | User |
| 4 | Main suggestion signal = **this company's open jobs that pass *your* title/location gates right now**, not a company-trait blend | Product, agreed by Data |
| 5 | Upstream publishes a compact **per-job index** (no descriptions) for the profiled set; matching runs **locally** with the existing `passesGates`/`scoreJob` | Product, agreed by Data |
| 6 | **Two tiers**: ~300–500 curated + contributed companies (+ watched) are *profiled* and rankable; the rest of the dump is **search/browse only**, checked live on demand | Both |
| 7 | "Valid board" = **more than 0 jobs and a name/domain match**, never just HTTP 200 | Data, agreed by Product |
| 8 | **SmartRecruiters connector in phase 1**; **Workday as phase 1b beta** (curated entries only); Oracle/Taleo/iCIMS/SuccessFactors stay link-only | Both |
| 9 | UAE honesty: a visible **"Not trackable yet"** section plus a **coverage line**, not hidden | Both |
| 10 | Avoid share-alike, non-commercial and AGPL data sources; keep provenance for attribution | Data |

## Evidence that shaped it
- **UAE spot-check (33 companies, live probes):** 10 of 12 global crypto/fintech/AI firms hiring in the UAE are on Greenhouse/Lever/Ashby, e.g. Bybit (55 GCC jobs), Binance (45), Kraken (31), Tamara (29). Only ~19% of UAE-native employers are. talabat is on SmartRecruiters (45 AE jobs), Property Finder on Teamtailor, G42 on iCIMS, FAB on Oracle.
- **Traps:** SmartRecruiters and Workable return 200 for fake or dormant slugs; ambiguous slugs (`rain`, `kraken` vs `kraken.com`) need a domain check.
- **What users trust:** job recommenders win on relevance and trust. LinkedIn's "follow" means "alert me on matching jobs", which is our model. Over-filtering (Otta complaints) and popularity bias are the known failure modes.

## 1. Data (upstream repo)
**Sources, no AI:**
- [latmay/ats-career-page-urls](https://huggingface.co/datasets/latmay/ats-career-page-urls) (CC BY 4.0, ~70k URLs)
- [crypto-jobs-fyi/crawler](https://github.com/crypto-jobs-fyi/crawler) (Apache-2.0, ~365 crypto/AI/fintech firms with industries)
- kalil0321/ats-scrapers (MIT)
- our own Common Crawl CDX pass
- enrichment from Wikidata (CC0); yc-oss only after a licence check

A hand-picked list seeded the curated tier (since 2026-10-12 it gives no ranking boost, and the tooling that built it is gone: suggestions come only from the user's own roles, places and industries).

**Files** (published as GitHub Release assets on a rolling `latest` tag; clients fetch with an ETag and cache locally):
1. `directory.json`: curated identity, PR-reviewed. Per company: `{ id, name, domain, boards:[{ats, slug, region?, shard?, site?, careers_url}], parent_id, industries[], hq_country, tier: "profiled"|"dump", supported, sources[], added_at }`.
2. `index.json`: machine-written **daily**, for the profiled set only. Per company:
   - `open_jobs`, `new_7d`, `last_ok_at`
   - `terms[]`: top description terms, computed upstream, with a rarity filter that drops terms found in more than 50% of companies
   - `jobs`: merged rows `[title, location, workplace, age_days, count]`, capped at 400 per company, newest kept

   Estimated ~1 MB gzipped for ~2k boards.

**Pipeline** (`jobhunter catalog build|refresh`, GitHub Actions):
- union the sources, normalise to `(ats, slug, …)`, fetch politely (1 request/s per host), keep only valid boards (decision 7), dedupe by ats+slug, then by domain
- daily index refresh ≈ 12 min for 2k boards (Greenhouse without `content=true`)
- a `NOTICE` file carries source attribution

## 2. Matching (in the user's copy, no AI)
For each profiled company, run the user's gates over its `jobs` rows. M = rows that pass.

Score (0–100):
- **Now 50**: `50 × min(1, log2(1+|M|)/log2(6))`
- **Quality 20**: mean of the top 3 `scoreJob` scores in M
- **Topics 20**: user keyword weights matched in `terms[]`, normalised by the user's top-5 weights
- **Near-miss 10**: right title, other GCC country (places catalogue grouping) or accepted remote region

Components with no data are dropped and the rest rescaled. **Diversity re-rank**: at most 3 big employers (more than 300 jobs) in the top 12, and no more than 2 in a row from the same industry. Live description fetch happens only on "Why this company?" or on Add.

## 3. Companies tab UX
- **Coverage line**, e.g. "We track 9 of 21 relevant UAE companies · data as of 4 Oct"
- **Hiring for you now** (12 cards). Each card shows chips such as "3 roles match: Senior PM, Payments (Dubai) +2", "New this week", "Your topics: crypto, payments", and has Watch / Not interested / Expand. Selecting cards fills a sticky "Watch n companies → check & scan" bar.
- **Worth watching** (6): strong fit, nothing open today. Chip: "No match today · hires Product in Riyadh".
- **Not trackable yet**: visible, with careers-page links and "Notify me when supported"
- **Starter packs** ("UAE fintech", "Global crypto · remote EMEA", "AI labs"), each showing its trackable/total ratio
- **Browse all**: search the whole dump. Filters: industry, country, has matches now, supported. Expanding a dump company runs a live check ("2 roles match you now").
- **Add by link**: existing tool. If the company isn't in the directory, an opt-in **"Suggest for the shared directory"** checkbox appears (unchecked by default).
- **My companies**: existing health table, plus a batch "Share n new companies" action.
- **Sparse results**: if there are fewer than 5 local matches, widen city → country → GCC → remote regions, and label each step.
- **Not interested** is stored as `companies_hidden` in the config.
- **Hooks**: the Radar empty state and the setup checklist say "5 suggested companies are hiring for you".

## 4. Contribution (hybrid sync-back)
- **Checkbox** → opens a pre-filled **GitHub issue form** containing only the name + careers URL. The user reviews and submits it under their own account.
- **Notice:** "Opens a public GitHub issue with only this company's name and careers link. Nothing about you, your profile, resume or other companies is sent. The issue is posted under your GitHub username."
- **Upstream Action:**
  - re-detects the ATS and live-validates the board (decision 7)
  - dedupes, allow-lists hosts and rate-limits per author
  - opens a bot PR; **a maintainer merges it** (no auto-merge in v1)
- **After merge:** the company joins the profiled tier in the next index run.

## 5. Connectors
- **SmartRecruiters** (official, keyless) in phase 1; validation requires `totalFound > 0`.
- **Workday** in phase 1b as beta: tenant/shard/site from `detect-known.ts`; handle 403/422.
- **Teamtailor** later.

## Phases
| Phase | Scope |
|---|---|
| **1a Data** | Source pipeline + validation, `directory.json` (dump + curated tier from crypto-jobs-fyi + user's list + spot-check), daily `index.json`, Release publishing, NOTICE |
| **1b Matching + UI** | Client fetch/cache, local company scoring, Companies tab (coverage line, 3 sections, packs, browse, bulk add, not interested), Radar/checklist hooks |
| **1c Connectors** | SmartRecruiters; Workday beta |
| **1d Contribution** | Opt-in share, issue form, validation Action, bot PR |
| **2** | Monitoring (stale slugs, ATS switches, subsidiaries), monthly coarse pass over the dump (powers a "hiring in GCC" browse filter), learning from Not-interested reasons, Teamtailor, Arabic/bilingual title and city variants ("DXB") |

## Dependencies and open items
1. **The upstream GitHub repo must exist** (public template). Releases, Actions and issue forms all live there. Not created yet.
2. **The user's company list + HR portal links**, to seed the curated tier.
3. **Final licence check** on yc-oss and the Common Crawl-derived data before use.
4. **Unmeasured estimates:** index size (~1 MB gz) and refresh time. Verify in 1a.

## Risks
- **Stale "now":** data can be up to a day old. Label "data as of" and re-check live on Add.
- **Brittle rules:** gates miss some title and city variants (Arabic, "DXB"). Phase 2.
- **Sparse contributions:** the curated tier depends on maintainer effort.
- **Native UAE coverage stays limited** (~30% of targets need enterprise connectors that aren't possible).

# Auto-accepting moved careers pages (v4: fact-checked, peer-reviewed, owner decisions)

**Built** (2026-10-15) as one PR: fast-track, shadow mode and auto-accept behind `MOVES_AUTO_ACCEPT`
(off by default). How it works now: `docs/shared-directory.md`, "Company evidence and auto-accept".

Status: plan only, not built. History: v1 was in chat. v2 was corrected by a repo fact-check and a web fact-check. v3 adds an independent adversarial peer review and checks its claims against the code (2026-10-15).

## Recommendation
Build it in three steps. Each later step only starts if the earlier one shows it's worth it.
1. **Fast-track (build first).** The pipeline computes company-owned evidence and quotes it in the review issue, with the candidate box pre-ticked. A maintainer still adds `move-approved`. This saves review time and adds no automated trust.
2. **Shadow auto.** Each issue also says "would auto-accept: yes or no", and the pipeline tracks how often that would happen.
3. **Auto-accept**, only if step 2 shows real volume and no false accepts, including on red-team fixtures.

Why not go straight to auto:
- **A wrong accept is costly.** It delists the old board for **everyone** (`build.ts`: a moved-away board is dropped and "never trusted again" until reverted), and the move shows as "checked by RawJobs".
- **It would reach few companies.** Trusted company domains exist almost only for seed rows (see Coverage).

## Today (verified in the repo)
- Users report moves. The Worker keeps up to 20 reporter hashes per report.
- Every 3 h, `moves.ts` runs 7 gates in the order 1, 2, 6, 5, 7, 3, 4, then opens one `move-review` issue per old board.
- A maintainer adds `move-approved` (maintain or admin access only). `moves-approve.ts` re-runs the gates fresh and writes `moves.json` with `by: "review"`. The next release ships it.
- Apps only **suggest** accepted moves.
- The kill switch already exists: repo variable `MOVES_AUTO_ACCEPT`, which becomes env `AUTO_ACCEPT` and is read by `autoAcceptEnabled()`. It changes nothing today. `MoveRecord.by` already allows `"auto"`.
- Gate 3: "proven gone" exists only on Greenhouse, Lever and Ashby. Anything else becomes `not_proven`, which **already passes** to review.
- Gate 7 ignores the reported `to` board. So `taleo:mashreqbank` → `oracle:hcld` is a normal move, not a removal (v2 had this wrong).

## Threat model
- **Impostor board.** Self-serve slugs (Greenhouse, Lever, Ashby, Workable, SmartRecruiters) are open to anyone with an account, and a dead slug is probably re-claimable. Fake boards impersonating real companies are a documented scam (FBI IC3, 2022).
- **Owner-controlled fields are never proof.** This covers board names, job texts and the Greenhouse "job board URL" that rewrites every job's `absolute_url`.
- **Content on the company domain the company doesn't fully control.** That includes user-generated subdomains (community or help centres), subdomains taken over through a dangling CNAME, open redirects, and group or subsidiary pages that link many boards.
- **A lapsed company domain** that someone else re-registers.
- **Our fetcher itself:** SSRF, oversized responses, robots.txt.

## Evidence (company-owned only)
**Trusted page.** This is the **exact host and URL** of the row's company-hosted `careers_url`, as the directory stored it before the report, plus that same host's homepage. Never a sibling subdomain or the registrable domain.
- The source is the directory record, or `resolve.ts` data for seed rows.
- Wikidata is dropped. It only ever confirmed sources that are enough on their own, and anyone can edit it.

**S1: the page links to exactly the candidate.**
- Pull every URL from the trusted page: `href`/`src`, script and iframe sources, and text after unescaping `\/`, HTML entities and `%2F`.
- Run each through the existing board detectors (`detect-known.ts` / `find-boards.ts`) and compare `companyKey`. No substring regex: `acme` must not match `acme-fake`.
- **One-board rule.** The candidate must be the only hiring-system board on the page. Several boards (group, regions, subsidiaries) means manual review.
- **Baseline swap.** When a row is first resolved, store a snapshot of which boards its trusted page links. S1 can stand in for a dead-proof only as a before/after swap: the old board linked before, the new one linked now. Without a baseline, S1 means fast-track only.

**S2: the old URL redirects to the candidate.**
- Follow redirects by hand, at most 5 hops.
- Every hop before the last must be on the exact trusted host. The first off-host hop must be the final URL, and it must parse to the candidate.

**The domain wasn't re-registered.** The RDAP creation date must be earlier than the date the directory first stored that host. RDAP has gaps: `.ae`, `.io` and `.co` aren't in the IANA bootstrap. An unknown age allows fast-track only.

**Dead-proof for vendor hosts (new).** DNS NXDOMAIN twice, 24 h apart, on a vendor-provisioned host (`*.taleo.net`, `*.myworkdayjobs.com`, `*.oraclecloud.com`) counts as **proven** gone. Today those reports end up `not_proven`.

**Not evidence (hints shown in the issue only):**
- Name match, crossprobe, reporter count.
- DNS CNAME: low recall. Big companies point careers hosts at CDNs, and Ashby and Greenhouse don't support custom domains.
- Board size or age.
- Job continuity: failing boards' rows are kept only 7 days.

## Decision rule
| Outcome | Conditions |
|---|---|
| **auto** (step 3 only) | All gates pass. Gone is proven (404/410 or NXDOMAIN), or S1 is a baseline swap. S1 or S2 holds on the trusted host, with the one-board rule. The evidence points at a candidate a reporter chose. RDAP age is OK. Not a pack company. No earlier revert or refusal for this old board. Under the caps. |
| **fast-track** | Gates pass and S1 or S2 holds, but some auto condition fails (no baseline, unknown age, a pack company, step 3 not on). |
| **manual** | Everything else. Also when the evidence names a board no reporter chose: the issue suggests that board for review. |

## Guard rails
- **Refusals and reverts are permanent for auto.** Persist closed or refused issues and `reverted: true` moves in a `moves-blocked` list that auto checks. Today a revert drops out of `activeMoves`, so the move could come straight back.
- **Revert only on contradiction.** Re-verify auto moves before each build, for 30 days. Revert only when the page now links a **different** board. A failed fetch, a bot block (CDNs often block GitHub runner IPs) or a geo variant means "unknown": keep the move and flag it.
- **Hold the delisting.** An auto move stays suggestion-only, and the old board stays listed, until a second re-verify at least 24 h later passes.
- **Concurrency.** `moves.ts` and `moves-approve.ts` both write `moves.json` and `moves-pending.json`. Put them in one workflow concurrency group and re-check under it. `directoryMoves` keeps only the first move per old board, so an auto pick and a manual pick could conflict without anyone noticing.
- **Fetch safety:**
  - https on port 443 only.
  - Resolve DNS and refuse private, link-local or metadata IPs at every hop.
  - At most 5 hops, a body cap of about 2 MB, no cookies, and the existing User-Agent.
  - robots.txt: 5xx or a timeout means **disallow** (RFC 9309). Today `robots.ts` allows everything on an error, so fix that or use a stricter wrapper.
  - At most 3 pages per company and 5 minutes per run.
- **Caps:** at most 10 auto-accepts per run and 20 per day, plus the release gate's existing cap of 50 new moves. A spike turns auto off for that run.
- **Audit.** Every fast-track or auto issue quotes the evidence (page URL, the parsed board key, the trusted-host source, RDAP date) through `codeSafe`, inside a code block, with no links.
- **Badge.** Auto moves keep "checked by RawJobs" (owner decision 3). `by: "auto"` in `moves.json` records how each move was accepted.

## Shadow mode: what counts as success
- Zero errors in 30 moves only proves an error rate under about 10% (rule of three). Maintainer decisions are also not ground truth, and real traffic contains no attacks.
- So also add **red-team fixtures**: a subsidiary page, a user-generated subdomain, a prefix slug, a redirect chain off the trusted host, a JS-only page, a bot-blocked page, and a re-registered domain. Every one of them must come out manual or fast-track.
- Report **volume**: how many moves a month would auto-accept. If it's about 1 a month, stop at fast-track.

## Coverage, honestly
- `build.ts` sets `careers_url` to the board's own address for most rows, so it's a hiring-system URL.
- Measured on the local directory copy: **3,022 of 147,731 live rows (2.0%)** have a careers URL that the board detectors don't treat as a hiring-system host. Many are hiring systems served on the company's own domain, such as SAP SuccessFactors at `careers.<company>.com`. The rest are seed rows with a company page (`publish.ts:178`). `resolve.ts` adds homepage data for seed and Wikidata companies.
- One caveat: a hiring system on the company's domain (for example a SuccessFactors custom host) proves only that the domain is the company's. Treat the page as trusted only when the host is a subdomain of a registrable domain the directory already associates with that company.
- So company evidence exists for a minority of rows. That's the main reason to start with fast-track.
- To widen coverage later: store each row's company site from `resolve.ts` results in the directory (a new field), and the baseline snapshot along with it.

## Mashreq walk-through (live, 2026-10-15)
- **Trusted page:** `https://www.mashreq.com/en/uae/about-us/careers/careers-portal/`, the old row's `careers_url`.
- **S1:** the page links exactly one hiring-system board, `hcld.fa.em2.oraclecloud.com/.../sites/CX_1`. No Taleo link.
- **Old board:** `mashreqbank.taleo.net` is NXDOMAIN, which proves it gone under the new rule after a second check.
- **RDAP:** `mashreq.com` was registered 2003-05-23.
- **Verdict:** fast-track today. Auto in step 3, unless Mashreq is in a pack.

**Open check before building:** Oracle's key `oracle:<slug>` ignores `site`. Can one Oracle tenant host several career sites (for example `CX_1` and `CX_2` for different brands)? If so, S1 key matching needs the site included for Oracle.

## Owner decisions (2026-10-15)
1. **Refused or reverted moves are blocked forever**, for both auto and manual review. The pipeline never opens a review for that `from>to` pair again. Only a maintainer can lift a block, by editing `moves-blocked.json`.
2. **Build it all, merge once.** Fast-track, shadow and auto ship together in one PR, or in stacked branches merged once. Auto ships **switched off** (`MOVES_AUTO_ACCEPT` unset), so shadow mode runs first. Auto turns on later by setting the repo variable, with no new code.
3. **One badge.** Auto moves keep "checked by RawJobs". No separate badge.
4. **Pack companies go to fast-track, never auto** (decided from the stats below). Revisit once shadow data exists.

## Stats behind decision 4 (local directory copy from 2026-10-14, 186,040 rows; move reports so far: 0)
| Segment | Live rows | Company-hosted careers URL (auto-reachable) | Median open jobs |
|---|---|---|---|
| Pack-eligible (live + industry-tagged) | 1,944 | 202 (10.4%) | 28 |
| Everything else live | 145,787 | 2,820 (1.9%) | 6 |
- Auto can reach only about 3,000 live rows (2%). Pack companies are about 7% of those.
- Pack companies are the biggest boards (median 28 open jobs, against 6) and are added in one click by many users. A wrong move there hits the most people.
- So fast-tracking packs costs only a few maintainer clicks and keeps the highest-impact rows under human review.
- "Company-hosted" counted here includes SAP SuccessFactors boards served on a company's own domain (for example `careers.lupin.com`). Those count as the company's own host.
- `moves-pending.json` is empty and `moves.json` doesn't exist yet. There are no real move reports yet, which is another reason auto starts switched off.

## Build plan (one merge, when you say go)
- **Part A: fast-track.**
  - Safe fetcher: manual redirects, IP checks, body cap, strict robots.
  - Trusted-page evidence: URL extraction, board detectors, one-board rule.
  - NXDOMAIN dead-proof.
  - Evidence in issues, with the box pre-ticked.
  - `moves-blocked.json`, written on refusal and on revert.
  - A shared concurrency group.
- **Part B: shadow.** Baseline snapshots, the RDAP check, the "would auto-accept" verdict, red-team fixtures, and the volume report.
- **Part C: auto, behind `MOVES_AUTO_ACCEPT`.**
  - Writes `by: "auto"`, keeps the "checked by RawJobs" badge.
  - Holds the delisting until a second re-verify.
  - Re-verifies and reverts only on contradiction.
  - Caps, and packs always fast-tracked.

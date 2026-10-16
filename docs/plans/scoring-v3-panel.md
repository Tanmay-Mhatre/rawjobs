# Fit score v3: panel review (2026-10-16)

Status: research only. Nothing gets built until the user says go.

Six experts were briefed with the same pack: the current scorer, the constraints, and the v3 proposal. Each researched on their own (web and repo, reading `origin/main` at 23e4487).

- **Proposal reviewed:** (1) topics taken from the résumé, (2) matching by meaning, using a concept map or an on-device model, (3) an eval built from the user's own saves and hides, (4) bands calibrated per user.
- **Constraints:** open models only, no LLM in the app, local and private, free, every point explainable.

## Verdicts

| Panelist | Score | One line |
|---|---|---|
| Semantic matching (IR) | 6/10 | "Map *or* model" is a false choice. Use an open model offline to build a concept map, ship the map as data, and keep any on-device model optional. |
| Local-first engineering | 7/10 for feasibility, 8/10 for the hybrid | A bundled ONNX runtime is 301 MB unpacked and breaks the single tarball. Use a signed map plus optional pure-JS static embeddings. |
| Competitive landscape | 6.5/10 | The leaders all match on meaning. v3 still lacks a per-requirement checklist, labels before the number, feedback with reasons, and a larger eval. |
| Résumé and skill extraction | 5/10 | The offline topic dictionary has about 60 terms, fixed weights and no word forms. Use one shared lexicon for the résumé and the postings, with weights based on evidence. |
| Recsys and evaluation | 5/10 | One user's saves can't tune global weights. Per-user bands go in circles. Found a real bug in the learned order. |
| Red team (trust, fairness) | 5/10 | Embeddings bring false positives (Java ≈ JavaScript), plus negation, keyword stuffing and filter bubbles. Bands that drift destroy trust. |

Average about 5.7/10: the direction is right, but the mechanisms need changing. These are the scores from the reports sent after the panel reread the current code on `origin/main`.

## Unanimous: "no further upgrades possible" doesn't exist

- Job vocabulary drifts every month: new tools, new titles.
- The labels come from one person and are noisy.
- The best published systems still score well short of perfect. TalentCLEF 2025 title matching tops out at a MAP of about 0.5–0.65; skill extraction span-F1 is about 0.5–0.75.
- NDCG@10 of 0.926 on about 50 in-field invented pairs is probably already within noise of how far the labellers agree with each other.

The achievable target is a **plateau**: the scorer stops improving measurably on a frozen holdout. Precision on synonym matches stays at or above about 0.9, and a check every quarter confirms the plateau holds. New vocabulary then reaches users through a weekly data refresh, with no app release.

## What changes from the proposal

### Item 2, meaning matching: concept map (accepted, reshaped)

- **Build** `concepts.json` weekly in the directory pipeline from four sources:
  - ESCO v1.2 (about 14k skills in 28 languages; EU reuse terms, attribution)
  - O\*NET Technology Skills (CC BY 4.0)
  - Wikidata aliases (CC0)
  - a hand-curated `overrides.yaml` for domain words such as PSP, BIN sponsor and issuer processor, which always wins
- **Propose new aliases** with open embeddings run in CI only (bge-small-en-v1.5 or JobBERT-v2, MIT). Propose an alias only when cosine is at or above about 0.85 and PMI co-occurrence agrees. Proposals go to a review queue and are never auto-shipped.
- **Edges have a direction.** A narrower term in the posting proves your broader topic ("card issuing" proves "cards", "PSP" proves "payments"). A broader term never proves a narrower one ("fintech" doesn't prove "payments"). ESCO's broader and narrower relations give the direction. Gate the map on a labelled set of about 300 alias pairs with hard negatives (PSP vs PlayStation), following the pattern of `scripts/catalog/industry-precision.ts`. This stops one bad hub edge from lifting every job.
- **Ambiguous terms** (go, r, swift, spark, excel, PSP) count only when context words are present. Keep a tested deny-list of confusable pairs: Java/JavaScript, PM/PMM.
- **Ship** the map signed through `data-signing.ts`, about 0.5–3 MB compressed. Keep a baked fallback in the bundle and record the map version in `why`.
- **Match** with `matchTopic()` in `score.ts`, which returns `{kind: exact|alias|narrower|related, via, span}`. Credit is 1.0 for exact or alias, about 0.9 for narrower and 0.5 for related, capped. A related match never fills a topic on its own.
- **Explanation:** "'PSP' ≈ your topic 'payments' (alias)", with a one-click "not the same thing" fix. Never show a raw cosine.
- **Rejected:** bundling an ONNX transformer. It is 301 MB native, 200–400 MB of memory, slow and opaque.
- **Optional, only if the eval shows a recall gap:**
  - potion-base-8M static embeddings: pure JS, about 7.5 MB int8, around 1 ms per job, downloaded only if the user turns it on
  - credit capped at 0.5 of a mention
  - the matched sentence is quoted as the reason

### Item 1, topics from the résumé (accepted, reshaped)

- **Normalise both sides first.** Fold case and accents, add an acronym table and a light stemmer inside `termRegex`. This fixes "forecasts" vs "forecasting".
- **Extract** with the same lexicon the scorer uses, so résumé and posting share one vocabulary.
- **Weight by evidence:**
  - section: Experience 1.0, Summary 0.8, Skills list 0.5 and capped at 3
  - recency: 0.5^(years since the role ended / 4)
  - frequency
  - rarity: IDF over the scanned jobs
  - years per skill
- **UX: suggestions only.**
  - Pre-tick only topics with strong evidence. Tap a chip to see why it was suggested.
  - Removed topics stay removed. A résumé change only adds new suggestions.
  - Tag each topic as "from past roles" or "your target", and weight target topics higher. This protects career changers.
  - If the résumé isn't in a language the lexicon covers, say so instead of showing empty results.

### Item 3, eval from real behaviour (rejected as a way to tune global weights)

- One user's saves are too few and too biased by position to tune or prove the global weights. Use them only to personalise that user's order.
- **Bug to fix in the shipped learned order (#255):** picks are joined to the current job list, so the model forgets choices once a posting closes. Fix: store `fitFeatures(why)` in the entry when the user decides.
- **Learning v2:**
  - Bayesian logistic regression with a Laplace posterior and a prior toward "no change".
  - Graded labels: applied > saved; interview or offer counts most.
  - Not-interested reasons routed by type: "company" is excluded, "other" counts 0.3.
  - Time decay with a 60-day half-life.
  - Each job's nudge shrinks with the model's uncertainty, reaching full strength at about 20 picks of each kind.
  - Auto-off when leave-one-out shows the nudge doesn't help.
  - A "Learned from 26 choices: your level counts more" line, and Reset stays.
- **Skip:** IPS or unbiased LTR, and bandits. At about 30 events they add noise, not signal.
- **Eval hygiene:**
  - Freeze the test split and score it only at release; report bootstrap CIs and treat changes under 0.02 as noise.
  - Add synonym and ambiguous-acronym pairs, plus a precision metric for alias matches.
  - Add career-changer, terse-CV and non-English profiles.
  - Optional: an open 7–8B judge in CI grades thousands of public postings against synthetic profiles. A person spot-checks; the human pairs stay as the holdout.

### Item 4, per-user calibrated bands (rejected as written)

- Bands that move break trust: a job turns from green to grey with no change to the job. They are also circular, because users save what the app showed as Strong.
- **Instead:**
  - **Fixed bands.** Strong = score at or above the cut-off **and** no missed check on place, level or must-haves.
  - **Lead with the band chip and the reason line;** the number comes second.
  - **Suggested cut-off.** After 15+ likes and 15+ hides, suggest the threshold that best separates them. Use only picks made before the nudge was on, clamp it to 55–85, and apply it only when the user taps.
  - **Local fit report** in Settings, with counts and Wilson intervals: save rate by band, saves that came from Fair or Weak, hides of Strong jobs, interviews by band.

## Added by the panel (not in the proposal)

1. **A checklist for every requirement.** Mark each must-have bullet met, near, missing or unknown, and name the matched item or synonym ("Missing: Kafka"), the way LinkedIn and Huntr do. Keep keywords near 20% of the score, as Huntr does.
2. **Robustness:**
   - Ignore a term with a negation next to it ("no X needed").
   - Ignore boilerplate a company repeats across its postings (company-level IDF), and match in the requirements and responsibilities sections.
   - Resist keyword stuffing: count a term once per section and cap what a long term list can earn.
3. **Title meaning.** Use JobBERT-v2 title vectors, built offline, to add a "near title" tier behind the gate, always showing the nearest of your titles as the reason.
4. **Reason codes from the scorer.** The UI copy shouldn't be worked out from point values.
5. **Hide-with-reason chips that propose a visible profile change** (add an exclude word, raise the level), not just a nudge to the model.
6. **Licences:**
   - Add a NOTICE crediting ESCO, O\*NET 31.0 and Wikidata.
   - Don't use Lightcast Open Skills: commercial use needs a licence.
   - Don't bundle Gemma models.
   - Check the licence of the ConTeXT model before using it.
7. **EU AI Act.** A tool that ranks jobs for the seeker's own use most likely falls outside Annex III 4(a). That changes if RawJobs ever ranks candidates or submits applications at scale. This is not legal advice.

## Build order (each step its own PR, gated by `pnpm eval:match`)

| # | Step | Why first |
|---|---|---|
| P0 | **Eval upgrade**: frozen test split, bootstrap CIs, synonym, acronym, career-changer and terse-CV pairs, alias precision metric. **Fix the learned-order bug**: snapshot features at decision time. | Every later step needs to be measurable, and the bug is live. |
| P1 | **Normaliser and stemmer** on both sides; **negation, boilerplate and stuffing guards**. | Cheap, and improves precision before recall is added. |
| P2 | **Concept map v1**: about 300 curated concepts baked in, `matchTopic()`, "via" reasons, deny-list, "not the same thing" fix. | Biggest win for the least work, with no network. |
| P3 | **Pipeline**: ESCO, O\*NET and Wikidata import, offline embedding alias proposals with a review queue, signed weekly `concepts.json`, NOTICE. | Brings the map to scale; updates without app releases. |
| P4 | **Résumé extractor on the lexicon** (evidence weights, past vs target, suggestions UX); **per-requirement checklist** with gap names; **years per skill**. | Fixes thin no-topic profiles; best-in-class explanation. |
| P5 | **Learning v2** (Bayesian, graded labels, decay, leave-one-out auto-off, "what I learned"); **Strong = cut-off + checks**; **band chip first**; **suggested cut-off**; **local fit report**. | Personalisation that can be trusted and shows its own value. |
| P6 | **Gated on eval:** optional potion static embeddings, JobBERT near-title tier, open-judge eval set. | Only if P2–P5 measurably plateau short of the target. |

## Sources

Collected by the panelists, with the full lists in their reports. Key ones:

- JobBERT-v2/v3: https://huggingface.co/TechWolf/JobBERT-v2 and https://arxiv.org/html/2507.21609v1
- TalentCLEF 2025: https://arxiv.org/abs/2507.13275
- ESCO: https://esco.ec.europa.eu/en/use-esco/download
- O\*NET licence: https://www.onetcenter.org/license_db.html
- Lightcast terms: https://legal.lightcast.io/lightcast-legal/open-terms-of-use
- potion-base-8M: https://huggingface.co/minishlab/potion-base-8M
- onnxruntime-node size: https://www.npmjs.com/package/onnxruntime-node
- LinkedIn semantic job search: https://arxiv.org/html/2602.07309v1
- LANTERN: https://arxiv.org/abs/2510.05490
- Huntr match score: https://help.huntr.co/en/articles/12241684-job-match-score
- Eightfold matching: https://eightfold.ai/engineering-blog/ai-powered-talent-matching-the-tech-behind-smarter-and-fairer-hiring/
- SkillSpan: https://aclanthology.org/2022.naacl-main.366
- Joachims 2017 unbiased LTR: https://arxiv.org/abs/1608.04468
- GLMix (KDD 2016): https://videolectures.net/kdd2016_zhang_response_prediction
- Niculescu-Mizil & Caruana 2005: https://mlanthology.org/icml/2005/niculescumizil2005icml-predicting
- Reusable holdout: https://cis.upenn.edu/~aaroth/reusable.html
- Kunkel et al. CHI'19: https://interactivesystems.info/publications/let-me-explain-impact-of-personal-and-impersonal-explanations-on-trust-in-recommender-systems-2019
- Degenerate feedback loops: https://arxiv.org/abs/1902.10730
- Negation in dense retrieval: https://arxiv.org/html/2507.22337v1
- EU AI Act service desk: https://ai-act-service-desk.ec.europa.eu/en/node/464

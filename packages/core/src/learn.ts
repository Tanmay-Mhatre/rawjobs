import type { ScoreBreakdown } from "./schema";

/**
 * Best match learns from you, on this computer only: the jobs you save or apply to against the ones you
 * mark Not interested. A small logistic model over the score's own parts finds which of them matter more
 * to you (say, being at your level more than your topics), and nudges the order by at most `MAX_NUDGE`
 * rank points. It never changes a score, a dealbreaker, a filter or an alert: only the Best match order.
 */
export const LEARN = {
  /** Fewest jobs liked, and fewest marked Not interested, before the order changes at all. */
  minEach: 3,
  /** The largest nudge, in rank points (a fresh job's freshness is worth 15). */
  maxNudge: 8,
  /** Pull towards "no change": strong, so a handful of choices moves the order only a little. */
  l2: 1,
  steps: 300,
  rate: 0.5,
} as const;

/** The score's parts, each 0..1, plus how many of its checks are unknown or missed. */
const FEATURES = ["title", "level", "focus", "place", "topics", "industry", "unknowns", "misses"] as const;

export function fitFeatures(why: ScoreBreakdown): number[] | undefined {
  // Scores from before checks existed don't carry focus or level apart from the title: leave them out.
  if (why.focus === undefined || why.gate) return undefined;
  const checks = why.checks ?? [];
  return [
    why.title / 30,
    (why.level ?? 0) / 10,
    why.focus,
    why.location / 20,
    why.scale ? 0 : why.keywordPoints / 40,
    (why.industry ?? 5) / 10,
    checks.filter((c) => c.status === "unknown").length / 2,
    checks.filter((c) => c.status === "missed").length / 2,
  ];
}

/** What was learned: a weight per part, and the average job it's measured from. */
export type LearnedOrder = { weights: number[]; mean: number[]; liked: number; disliked: number };

/** Learns from your choices; undefined until there are enough of each kind (LEARN.minEach). */
export function learnOrder(examples: readonly { why: ScoreBreakdown; liked: boolean }[]): LearnedOrder | undefined {
  const rows = examples.flatMap((e) => {
    const x = fitFeatures(e.why);
    return x ? [{ x, y: e.liked ? 1 : 0 }] : [];
  });
  const liked = rows.filter((r) => r.y === 1).length;
  const disliked = rows.length - liked;
  if (liked < LEARN.minEach || disliked < LEARN.minEach) return undefined;
  const n = FEATURES.length;
  const mean = Array.from({ length: n }, (_, i) => rows.reduce((s, r) => s + r.x[i]!, 0) / rows.length);
  const centred = rows.map((r) => ({ x: r.x.map((v, i) => v - mean[i]!), y: r.y }));
  const w = new Array<number>(n).fill(0);
  let bias = Math.log(liked / disliked);
  for (let step = 0; step < LEARN.steps; step++) {
    const grad = w.map((wi) => LEARN.l2 * wi);
    let gb = 0;
    for (const r of centred) {
      const err = sigmoid(bias + dot(w, r.x)) - r.y;
      gb += err;
      for (let i = 0; i < n; i++) grad[i]! += err * r.x[i]!;
    }
    bias -= (LEARN.rate * gb) / centred.length;
    for (let i = 0; i < n; i++) w[i]! -= (LEARN.rate * grad[i]!) / centred.length;
  }
  return { weights: w.map((v) => Math.round(v * 1000) / 1000), mean, liked, disliked };
}

/** How many rank points this job moves in Best match: between -maxNudge and +maxNudge, 0 for older scores. */
export function learnedNudge(m: LearnedOrder | undefined, why: ScoreBreakdown): number {
  const x = m && fitFeatures(why);
  if (!m || !x) return 0;
  return (
    LEARN.maxNudge *
    Math.tanh(
      dot(
        m.weights,
        x.map((v, i) => v - m.mean[i]!),
      ),
    )
  );
}

const dot = (a: readonly number[], b: readonly number[]) => a.reduce((s, v, i) => s + v * b[i]!, 0);
const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

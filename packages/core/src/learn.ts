import type { ScoreBreakdown } from "./schema";

/**
 * Best match learns from you, on this computer only: the jobs you save, apply to or move further against
 * the ones you mark Not interested. A small logistic model over the score's own parts finds which of them
 * matter more to you (being at your level more than your topics, say), and nudges the order by at most
 * `maxNudge` rank points. It never changes a score, a dealbreaker, a filter or an alert.
 *
 *   - Choices weigh what they say: applying counts more than saving, an interview or offer most. "Not
 *     interested: company" says nothing about fit and is left out; "other" counts a little.
 *   - Older choices fade (half as much every 60 days): what you want shifts during a search.
 *   - It starts gently after a few choices of each kind and reaches full strength at `fullEach`.
 *   - It checks itself: left-one-out over your own choices, if the nudge doesn't separate what you
 *     liked from what you didn't better than the score alone, it switches off (`helps: false`).
 */
export const LEARN = {
  /** Fewest jobs liked, and fewest marked Not interested, before the order changes at all. */
  minEach: 3,
  /** Choices of each kind at which the nudge reaches full strength. */
  fullEach: 20,
  /** The largest nudge, in rank points (a fresh job's freshness is worth 15). */
  maxNudge: 8,
  /** Pull towards "no change": strong, so a handful of choices moves the order only a little. */
  l2: 1,
  steps: 300,
  rate: 0.5,
  /** A choice counts half as much after this many days. */
  halfLifeDays: 60,
  /** The self-check uses at most this many recent choices (it trains once per choice). */
  checkMax: 60,
} as const;

/** The score's parts, each 0..1, plus how many of its checks are unknown or missed. */
export const FEATURES = ["title", "level", "focus", "place", "topics", "industry", "unknowns", "misses"] as const;
const PART_WORDS: Record<(typeof FEATURES)[number], string> = {
  title: "the title",
  level: "your level",
  focus: "a title close to yours",
  place: "the place",
  topics: "your topics",
  industry: "the industry",
  unknowns: "what a posting doesn't say",
  misses: "checks a job misses",
};

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

/** One of your choices: the job's parts when you made it, what you did, and when. */
export type Choice = {
  /** fitFeatures of the job when you chose (kept with the choice, so it outlives the posting). */
  features?: number[];
  why?: ScoreBreakdown;
  status: string;
  reason?: string;
  at?: string;
  /** The job's score, for the self-check. */
  score?: number;
};

/** What a choice is worth to the model: liked or not, and how much. 0 leaves it out. */
export function choiceWeight(c: Choice, now = Date.now()): { liked: boolean; weight: number } {
  const age = c.at ? Math.max(0, (now - Date.parse(c.at)) / 86_400_000) : 0;
  const fade = 0.5 ** ((Number.isFinite(age) ? age : 0) / LEARN.halfLifeDays);
  if (c.status === "dismissed") return { liked: false, weight: (c.reason === "company" ? 0 : c.reason === "other" ? 0.3 : 1) * fade };
  const w = c.status === "interviewing" || c.status === "offer" ? 2 : c.status === "applied" ? 1.5 : 1;
  return { liked: true, weight: w * fade };
}

/** What was learned: a weight per part, the average job it's measured from, how sure, and whether it helps. */
export type LearnedOrder = {
  weights: number[];
  mean: number[];
  liked: number;
  disliked: number;
  /** 0..1: grows with your choices, so a few of them move the order only a little. */
  strength: number;
  /** False when the self-check found the nudge doesn't help: the order then stays as scored. */
  helps: boolean;
  /** "Your level counts more for you", from the largest learned weight. */
  learned?: string;
};

type Row = { x: number[]; y: number; w: number; score?: number };

function fit(rows: readonly Row[]): { weights: number[]; mean: number[] } {
  const n = FEATURES.length;
  const total = rows.reduce((s, r) => s + r.w, 0) || 1;
  const mean = Array.from({ length: n }, (_, i) => rows.reduce((s, r) => s + r.w * r.x[i]!, 0) / total);
  const centred = rows.map((r) => ({ ...r, x: r.x.map((v, i) => v - mean[i]!) }));
  const liked = rows.reduce((s, r) => s + r.w * r.y, 0);
  const w = new Array<number>(n).fill(0);
  let bias = Math.log(Math.max(liked, 1e-3) / Math.max(total - liked, 1e-3));
  for (let step = 0; step < LEARN.steps; step++) {
    const grad = w.map((wi) => LEARN.l2 * wi);
    let gb = 0;
    for (const r of centred) {
      const err = r.w * (sigmoid(bias + dot(w, r.x)) - r.y);
      gb += err;
      for (let i = 0; i < n; i++) grad[i]! += err * r.x[i]!;
    }
    bias -= (LEARN.rate * gb) / total;
    for (let i = 0; i < n; i++) w[i]! -= (LEARN.rate * grad[i]!) / total;
  }
  return { weights: w.map((v) => Math.round(v * 1000) / 1000), mean };
}

/** Area under the curve: how often a liked choice outranks a disliked one (ties count half). */
function auc(points: readonly { s: number; y: number }[]): number {
  const pos = points.filter((p) => p.y === 1);
  const neg = points.filter((p) => p.y === 0);
  if (!pos.length || !neg.length) return 0.5;
  let wins = 0;
  for (const p of pos) for (const q of neg) wins += p.s > q.s ? 1 : p.s === q.s ? 0.5 : 0;
  return wins / (pos.length * neg.length);
}

const nudgeOf = (m: { weights: number[]; mean: number[] }, x: readonly number[], strength: number) =>
  LEARN.maxNudge *
  strength *
  Math.tanh(
    dot(
      m.weights,
      x.map((v, i) => v - m.mean[i]!),
    ),
  );

/** Learns from your choices; undefined until there are enough of each kind (LEARN.minEach). */
export function learnOrder(choices: readonly Choice[], now = Date.now()): LearnedOrder | undefined {
  const rows: Row[] = choices.flatMap((c) => {
    const x = c.features ?? (c.why && fitFeatures(c.why));
    const { liked, weight } = choiceWeight(c, now);
    return x && x.length === FEATURES.length && weight > 0 ? [{ x, y: liked ? 1 : 0, w: weight, score: c.score }] : [];
  });
  const liked = rows.filter((r) => r.y === 1).length;
  const disliked = rows.length - liked;
  if (liked < LEARN.minEach || disliked < LEARN.minEach) return undefined;
  const model = fit(rows);
  const strength = Math.min(1, Math.min(liked, disliked) / LEARN.fullEach);

  // Self-check: train without each choice and see whether score + nudge ranks it better than the score alone.
  const recent = rows.slice(-LEARN.checkMax).filter((r) => r.score !== undefined);
  let helps = true;
  if (recent.length >= 2 * LEARN.minEach) {
    const base = recent.map((r) => ({ s: r.score!, y: r.y }));
    const tuned = recent.map((r) => ({ s: r.score! + nudgeOf(fit(rows.filter((o) => o !== r)), r.x, strength), y: r.y }));
    helps = auc(tuned) > auc(base);
  }

  const top = model.weights.reduce((best, v, i) => (Math.abs(v) > Math.abs(model.weights[best]!) ? i : best), 0);
  const learned = Math.abs(model.weights[top]!) >= 0.1 ? `${capital(PART_WORDS[FEATURES[top]!])} counts ${model.weights[top]! > 0 ? "more" : "less"} for you` : undefined;
  return { ...model, liked, disliked, strength, helps, ...(learned ? { learned } : {}) };
}

/** How many rank points this job moves in Best match: within ±maxNudge, 0 for older scores or when it doesn't help. */
export function learnedNudge(m: LearnedOrder | undefined, why: ScoreBreakdown): number {
  const x = m?.helps ? fitFeatures(why) : undefined;
  return m && x ? nudgeOf(m, x, m.strength) : 0;
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const dot = (a: readonly number[], b: readonly number[]) => a.reduce((s, v, i) => s + v * b[i]!, 0);
const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

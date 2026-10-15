import { cx } from "../../lib/cx";

/** design/components/ScoreBadge bands: strong at or above your threshold, fair from 40, weak below. */
export type ScoreBand = "strong" | "fair" | "weak";

export const FAIR_FROM = 40;
export const DEFAULT_THRESHOLD = 65;

export function scoreBandOf(score: number, threshold = DEFAULT_THRESHOLD): ScoreBand {
  if (score >= threshold) return "strong";
  if (score >= FAIR_FROM) return "fair";
  return "weak";
}

const WORD: Record<ScoreBand, string> = { strong: "Strong", fair: "Fair", weak: "Weak" };

/** "Strong match, score 74, estimated": what the badge says in words. */
export function scoreLabel(score: number, threshold = DEFAULT_THRESHOLD, estimated = false) {
  return `${WORD[scoreBandOf(score, threshold)]} match, score ${score}${estimated ? ", estimated" : ""}`;
}

export type ScoreBadgeProps = {
  score: number;
  /** The user's strong-match threshold (profile.min_score). */
  threshold?: number;
  /** Scored on title, place and industry only (a directory job not fetched yet): dashed, with "~". */
  estimated?: boolean;
  /** lg in the job drawer. */
  size?: "md" | "lg";
  /** The band in words under the number ("Strong"), so the band never rests on colour alone. */
  word?: boolean;
  className?: string;
};

export function ScoreBadge({ score, threshold = DEFAULT_THRESHOLD, estimated = false, size = "md", word = false, className }: ScoreBadgeProps) {
  const band = scoreBandOf(score, threshold);
  return (
    <span
      role="img"
      aria-label={scoreLabel(score, threshold, estimated)}
      className={cx("rj-score", `rj-score--${band}`, estimated && "rj-score--estimated", size === "lg" && "rj-score--lg", word && "rj-score--word", className)}
    >
      {estimated ? `~${score}` : score}
      {word && <small className="rj-score__word">{WORD[band]}</small>}
    </span>
  );
}

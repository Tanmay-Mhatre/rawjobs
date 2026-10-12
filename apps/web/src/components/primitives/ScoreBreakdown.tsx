import type { ReactNode } from "react";
import { cx } from "../../lib/cx";

/** One score factor: points earned of its maximum. */
export type ScorePart = { label: string; earned: number; max: number };

/**
 * The four factors and their maximums (one word per meaning: title, place, keywords, industry). Jobs
 * scored before the industry part existed have freshness in its place until the next scan.
 */
export function scoreParts(why: { title: number; location: number; keywordPoints: number; industry?: number; freshness?: number; scale?: number }): ScorePart[] {
  return [
    { label: "Title", earned: why.title, max: 30 },
    { label: "Place", earned: why.location, max: 20 },
    // With no keywords in the profile the score is scaled from the other three, so there's no keyword part.
    ...(why.scale ? [] : [{ label: "Keywords", earned: why.keywordPoints, max: 40 }]),
    why.industry === undefined ? { label: "Fresh", earned: why.freshness ?? 0, max: 10 } : { label: "Industry", earned: why.industry, max: 10 },
  ];
}

const clamp = (n: number) => Math.min(1, Math.max(0, n));

/**
 * design/components/ScoreBreakdown: a bar of segments sized to each factor's maximum, filled to what was
 * earned, with a legend and (optionally) the keywords found and missed. The bar reads every value aloud.
 */
export function ScoreBreakdown({
  score,
  parts,
  found,
  missing,
  className,
}: {
  score: number;
  parts: ScorePart[];
  /** Keywords found in the posting, shown as marks. */
  found?: string[];
  /** Profile keywords the posting doesn't mention. */
  missing?: string[];
  className?: string;
}) {
  // The kit's grid is 30fr 20fr 40fr 10fr; build it from the parts so a three-factor score works too.
  const columns = { gridTemplateColumns: parts.map((p) => `${p.max}fr`).join(" ") };
  const spoken = `Score ${score}: ${parts.map((p) => `${p.label.toLowerCase()} ${p.earned} of ${p.max}`).join(", ")}`;
  const why: ReactNode[] = [];
  if (found?.length) {
    why.push(
      <span key="found">
        Keywords found:{" "}
        {found.map((k, i) => (
          <span key={k}>
            {i > 0 && " "}
            <mark>{k}</mark>
          </span>
        ))}
        .
      </span>,
    );
  }
  if (missing?.length) why.push(<span key="missing">{`${why.length ? " " : ""}Not found: ${missing.join(", ")}.`}</span>);
  return (
    <div className={cx("rj-breakdown", className)}>
      <div className="rj-breakdown__bar" role="img" aria-label={spoken} style={columns}>
        {parts.map((p) => (
          <span key={p.label} className="rj-breakdown__seg">
            <i style={{ transform: `scaleX(${clamp(p.max ? p.earned / p.max : 0)})` }} />
          </span>
        ))}
      </div>
      <div className="rj-breakdown__legend" aria-hidden style={columns}>
        {parts.map((p) => (
          <span key={p.label}>
            {p.label} <b>{p.earned}</b>
            {p.earned < p.max && `/${p.max}`}
          </span>
        ))}
      </div>
      {why.length > 0 && <p className="rj-breakdown__why">{why}</p>}
    </div>
  );
}

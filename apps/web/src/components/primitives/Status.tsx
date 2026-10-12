import { cx } from "../../lib/cx";

/** The square glyphs shared by Status and ScoreBadge: full, half, empty, slashed. Never a dot. */
export type GlyphShape = "full" | "half" | "empty" | "slash";

export function StatusGlyph({ shape }: { shape: GlyphShape }) {
  return <i className={`rj-glyph rj-glyph--${shape}`} aria-hidden />;
}

/** A company's board status (One word per meaning: Healthy, Dormant, Broken link). */
export type BoardState = "healthy" | "dormant" | "broken";

const SHAPE: Record<BoardState, GlyphShape> = { healthy: "full", dormant: "half", broken: "slash" };
export const BOARD_STATE_LABEL: Record<BoardState, string> = { healthy: "Healthy", dormant: "Dormant", broken: "Broken link" };

/** design/components/Status: shape + color + word, so it never depends on color alone. */
export function Status({ state, label = BOARD_STATE_LABEL[state], className }: { state: BoardState; label?: string; className?: string }) {
  return (
    <span className={cx(`rj-status rj-status--${state}`, className)}>
      <StatusGlyph shape={SHAPE[state]} />
      <span className="rj-status__label">{label}</span>
    </span>
  );
}

import { cx } from "../components/ui";
import type { StepProps } from "./fields";

// ---------- threshold (Review and Settings) ----------

export const THRESHOLDS = [
  { value: 70, label: "Strong matches only", hint: "Title, place and several of your topics line up" },
  { value: 55, label: "Good and strong", hint: "Right role and place, some topic overlap" },
  { value: 40, label: "Everything that fits", hint: "Right role and place, topics optional" },
];

export function ThresholdPicker({ draft, update }: StepProps) {
  const custom = !THRESHOLDS.some((t) => t.value === draft.minScore);
  return (
    <div className="grid gap-2 sm:grid-cols-3">
      {THRESHOLDS.map((t) => (
        <button
          key={t.value}
          type="button"
          onClick={() => update({ minScore: t.value })}
          aria-pressed={draft.minScore === t.value}
          className={cx("rounded-md border p-3 text-left transition-colors", draft.minScore === t.value ? "border-ink bg-active" : "border-line hover:bg-inset")}
        >
          <span className="block type-small font-semibold">
            {t.label} <span className="tabular font-normal text-muted">({t.value}+)</span>
          </span>
          <span className="mt-0.5 block type-small text-muted">{t.hint}</span>
        </button>
      ))}
      {custom && <p className="type-small text-muted sm:col-span-3">Custom threshold from your config: {draft.minScore}+</p>}
    </div>
  );
}

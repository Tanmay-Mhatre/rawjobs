import { useEffect, useState } from "react";
import type { Draft } from "../lib/setup";
import { Field } from "./primitives";
import { Segmented } from "./ui";

type Props = { draft: Draft; update: (patch: Partial<Draft>) => void };

/** "frontend, credit risk" -> ["frontend", "credit risk"]. */
export const parseList = (text: string) => [...new Set(text.split(/[,;\n]/).map((s) => s.trim().toLowerCase()).filter(Boolean))];

/**
 * A comma-separated list in one text field. It keeps what you type (a trailing comma, a half-typed
 * word) and saves the parsed list as you go; it only rewrites the text when the list changes elsewhere.
 */
function ListField({ label, help, placeholder, value, onChange }: { label: string; help: string; placeholder: string; value: string[]; onChange: (v: string[]) => void }) {
  const [text, setText] = useState(value.join(", "));
  useEffect(() => {
    if (parseList(text).join("\u0000") !== value.join("\u0000")) setText(value.join(", "));
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Field
      label={label}
      help={help}
      placeholder={placeholder}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        onChange(parseList(e.target.value));
      }}
    />
  );
}

/**
 * Settings → Profile → Dealbreakers: salary floor, where you can work without a visa sponsor, and work
 * you won't do. A job that breaks one stays on the Radar with the reason, scored under your threshold.
 */
export function DealbreakersStep({ draft, update }: Props) {
  const floor = draft.salaryFloor;
  const setFloor = (patch: Partial<NonNullable<Draft["salaryFloor"]>>) => {
    const next = { amount: floor?.amount ?? 0, currency: floor?.currency ?? "", period: floor?.period ?? "year", ...patch };
    update({ salaryFloor: next.amount > 0 || next.currency ? next : undefined });
  };
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <div className="grid grid-cols-[minmax(0,1fr)_6rem] gap-3">
          <Field
            label="Salary floor"
            inputMode="numeric"
            placeholder="85000"
            value={floor?.amount ? String(floor.amount) : ""}
            onChange={(e) => setFloor({ amount: Number(e.target.value.replace(/[^\d.]/g, "")) || 0 })}
          />
          <Field label="Currency" placeholder="EUR" maxLength={3} value={floor?.currency ?? ""} onChange={(e) => setFloor({ currency: e.target.value.trim().toUpperCase() })} />
        </div>
        <Segmented<"year" | "month">
          label="Salary floor per"
          value={floor?.period ?? "year"}
          onChange={(period) => setFloor({ period })}
          options={[
            { value: "year", label: "A year" },
            { value: "month", label: "A month" },
          ]}
        />
        <p className="type-small text-muted">Base pay. A posted range that tops out more than 5% under it counts. Jobs that don't say their pay never do.</p>
      </div>
      <ListField
        label="Countries you can work in without a visa sponsor"
        help='Separate with commas. "eu" covers the EU. Write "none" if you need sponsorship everywhere. Leave empty to skip this check.'
        placeholder="united kingdom, eu"
        value={draft.workAuthorization ?? []}
        onChange={(workAuthorization) => update({ workAuthorization })}
      />
      <ListField
        label="Work you won't do"
        help="Separate with commas. Counts when the title says it, or the description keeps coming back to it, not a passing mention."
        placeholder="frontend, credit risk, accounts payable"
        value={draft.avoid ?? []}
        onChange={(avoid) => update({ avoid })}
      />
    </div>
  );
}

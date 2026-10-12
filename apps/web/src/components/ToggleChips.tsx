import { Check, Plus } from "lucide-react";
import { useState } from "react";
import { cx } from "./ui";

type Props = {
  /** Every option, in display order. Selected values not listed here are shown too. */
  options: readonly string[];
  selected: readonly string[];
  onChange: (next: string[]) => void;
  label: string;
  /** "accent" is kept as a name for the default: pressed chips are inverted ink, like the Chip primitive. */
  tone?: "accent" | "bad" | "plain";
  /** Show a small input to add a value that isn't in the options. */
  addPlaceholder?: string;
  /** Display text for an option (defaults to the value). */
  format?: (v: string) => string;
  /** A short muted note after an option's text (e.g. "few companies"). */
  note?: (v: string) => string | undefined;
  size?: "sm" | "md";
};

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * The one select/deselect control: every option is always visible; selected ones are filled
 * with a check, and clicking any chip toggles it. Nothing disappears or locks once picked.
 */
export function ToggleChips({ options, selected, onChange, label, tone = "accent", addPlaceholder, format = (v) => v, note, size = "md" }: Props) {
  const [text, setText] = useState("");
  const all = [...options, ...selected.filter((s) => !options.includes(s))];
  const toggle = (v: string) => onChange(selected.includes(v) ? selected.filter((s) => s !== v) : [...selected, v]);
  const add = () => {
    const v = norm(text);
    if (v && !selected.includes(v)) onChange([...selected, v]);
    setText("");
  };
  const on = {
    accent: "border-ink bg-ink text-raised",
    bad: "border-danger/50 bg-danger-subtle text-danger-text",
    plain: "border-ink/30 bg-inset text-ink",
  }[tone];

  return (
    // biome-ignore lint/a11y/useSemanticElements: an ARIA role on purpose: the native element (fieldset, output, input, hr, ul) would change layout or behaviour here
    <div role="group" aria-label={label} className="flex flex-wrap items-center gap-1.5">
      {all.map((v) => {
        const active = selected.includes(v);
        return (
          <button
            key={v}
            type="button"
            aria-pressed={active}
            onClick={() => toggle(v)}
            className={cx(
              "inline-flex items-center gap-1 rounded-md border font-medium transition-colors",
              size === "sm" ? "h-7 px-2 type-label" : "h-8 px-2.5 type-label",
              active ? on : "border-dashed border-line text-muted hover:border-ink/40 hover:bg-hover hover:text-ink",
            )}
          >
            {active ? <Check className="size-3.5" /> : <Plus className="size-3.5" />}
            {format(v)}
            {note?.(v) && <span className="font-normal opacity-70">· {note(v)}</span>}
          </button>
        );
      })}
      {addPlaceholder && (
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          onBlur={() => text.trim() && add()}
          placeholder={addPlaceholder}
          aria-label={`Add to ${label}`}
          className={cx("min-w-36 flex-1 rounded-md border border-transparent bg-transparent px-2 type-small placeholder:text-muted", size === "sm" ? "h-7" : "h-8")}
        />
      )}
    </div>
  );
}

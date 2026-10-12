import { matchesTerm } from "@rawjobs/core/text";
import { ROLE_FAMILIES } from "@rawjobs/core/catalog/roles";
import { Plus, X } from "lucide-react";
import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { ToggleChips } from "../components/ToggleChips";
import { Button, cx } from "../components/ui";
import { inferFamily } from "../lib/setup";
import { CV_DICTIONARY, KEYWORD_PACKS } from "./presets";
import { ClearButton, Field, MoreOptions, PickButton, RESUME_LABEL, clearing, type StepProps } from "./fields";

// ---------- Topics ----------

/** Weight a topic gets when you add it without choosing one. */
const DEFAULT_WEIGHT = 3;

export function KeywordsStep({ draft, update, suggest, resumeText = "" }: StepProps & { resumeText?: string }) {
  const [cv, setCv] = useState("");
  const entries = Object.entries(draft.keywords).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const fromPaste = useMemo(
    () =>
      cv.trim().length < 40
        ? []
        : Object.entries(CV_DICTIONARY)
            .filter(([k]) => matchesTerm(cv, k))
            .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
    [cv],
  );
  // With a saved resume, suggestions are ready without pasting anything.
  const found = fromPaste.length ? fromPaste : (suggest?.keywords ?? []);
  const foundWeight = new Map(found);
  const fam = ROLE_FAMILIES.find((f) => f.id === (draft.family ?? inferFamily(draft.include)));
  const setWeight = (k: string, w: number) => {
    const next = { ...draft.keywords };
    if (w <= 0) delete next[k];
    else next[k] = Math.min(5, w);
    update({ keywords: next });
  };
  /** Toggle a group of suggestions on or off, keeping everything outside the group. */
  const toggleGroup = (options: string[], next: string[], weight: (k: string) => number) => {
    const kw = { ...draft.keywords };
    for (const k of options) {
      if (next.includes(k) && !(k in kw)) kw[k] = weight(k);
      if (!next.includes(k) && k in kw) delete kw[k];
    }
    update({ keywords: kw });
  };
  const packActive = (p: (typeof KEYWORD_PACKS)[number]) => Object.keys(p.keywords).every((k) => k in draft.keywords);
  const togglePack = (p: (typeof KEYWORD_PACKS)[number]) => {
    if (!packActive(p)) return update({ keywords: { ...p.keywords, ...draft.keywords } });
    // Keep words that another selected pack also needs (e.g. "payments" is in Fintech and Payments).
    const keep = new Set(KEYWORD_PACKS.filter((o) => o.id !== p.id && packActive(o)).flatMap((o) => Object.keys(o.keywords)));
    const next = { ...draft.keywords };
    for (const k of Object.keys(p.keywords)) if (!keep.has(k)) delete next[k];
    update({ keywords: next });
  };
  const resumeTopics = found.map(([k]) => k).filter((k) => !fam?.topics.includes(k));
  // Everything you picked that isn't offered above, so it can be removed here too.
  const shown = new Set([...(fam?.topics ?? []), ...resumeTopics]);
  const yours = entries.map(([k]) => k).filter((k) => !shown.has(k));
  /** Clear for the picked topics among `options`. */
  const clearTopics = (options: string[], name: string) => {
    const picked = options.filter((k) => k in draft.keywords);
    const keywords = Object.fromEntries(Object.entries(draft.keywords).filter(([k]) => !picked.includes(k)));
    return { count: picked.length, noun: ["topic", "topics"] as [string, string], name, ...clearing(draft, update, { keywords }) };
  };

  return (
    <div className="space-y-8">
      {fam && (
        <Field label={`Suggested for ${fam.label}`} action={<ClearButton {...clearTopics(fam.topics, `Clear topics suggested for ${fam.label}`)} />}>
          <ToggleChips
            label={`Topics for ${fam.label}`}
            options={fam.topics}
            selected={fam.topics.filter((k) => k in draft.keywords)}
            onChange={(next) => toggleGroup(fam.topics, next, () => DEFAULT_WEIGHT)}
          />
        </Field>
      )}

      {resumeTopics.length > 0 && (
        <Field label={fromPaste.length ? "Found in the text you pasted" : RESUME_LABEL(suggest)} action={<ClearButton {...clearTopics(resumeTopics, "Clear suggested topics")} />}>
          <ToggleChips
            label="Suggested topics"
            options={resumeTopics}
            selected={resumeTopics.filter((k) => k in draft.keywords)}
            onChange={(next) => toggleGroup(resumeTopics, next, (k) => foundWeight.get(k) ?? DEFAULT_WEIGHT)}
          />
        </Field>
      )}

      <Field label={fam || resumeTopics.length ? "Add your own" : "Your topics"} action={<ClearButton {...clearTopics(yours, "Clear your own topics")} />}>
        <AddKeyword onAdd={(k) => setWeight(k, DEFAULT_WEIGHT)} />
        {yours.length > 0 && <ToggleChips label="Your topics" options={yours} selected={yours} onChange={(next) => toggleGroup(yours, next, () => DEFAULT_WEIGHT)} />}
      </Field>

      <MoreOptions summary={entries.length ? `${entries.length} topics` : undefined}>
        <Field label="Industry topic packs">
          <div className="flex flex-wrap gap-2">
            {KEYWORD_PACKS.map((p) => (
              <PickButton key={p.id} active={packActive(p)} onClick={() => togglePack(p)}>
                {p.label}
              </PickButton>
            ))}
          </div>
        </Field>
        <Field label="Find topics in other text" hint={resumeText ? undefined : "Paste your CV or LinkedIn summary. It stays on this computer."}>
          <textarea
            value={cv}
            onChange={(e) => setCv(e.target.value)}
            rows={3}
            aria-label="Text to find topics in"
            placeholder="Paste text here…"
            className="w-full resize-y rounded-md border border-line bg-raised p-2.5 type-small placeholder:text-muted"
          />
        </Field>
        {entries.length > 0 && (
          <Field
            label="Importance"
            action={
              <ClearButton
                label="Clear all"
                {...clearTopics(
                  entries.map(([k]) => k),
                  "Clear all topics",
                )}
              />
            }
            hint={
              <>
                <b className="text-ink">5</b> = core, <b className="text-ink">1</b> = nice to have.
              </>
            }
          >
            <ul className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
              {entries.map(([k, w]) => (
                <li key={k} className="flex items-center gap-2 py-1">
                  <span className="min-w-0 flex-1 truncate type-small">{k}</span>
                  <WeightControl keyword={k} weight={w} onChange={(n) => setWeight(k, n)} />
                  <button
                    type="button"
                    onClick={() => setWeight(k, 0)}
                    aria-label={`Remove ${k}`}
                    title={`Remove ${k}`}
                    className="flex size-7 items-center justify-center rounded-md text-muted hover:bg-inset hover:text-danger-text"
                  >
                    <X className="size-4" />
                  </button>
                </li>
              ))}
            </ul>
          </Field>
        )}
      </MoreOptions>
    </div>
  );
}

/** 1–5 importance as a radio group: arrow keys move, only the checked one is in the tab order. */
function WeightControl({ keyword, weight, onChange }: { keyword: string; weight: number; onChange: (n: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const onKey = (e: KeyboardEvent) => {
    const step = e.key === "ArrowRight" || e.key === "ArrowUp" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowDown" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = Math.min(5, Math.max(1, weight + step));
    onChange(next);
    ref.current?.querySelectorAll<HTMLButtonElement>("[role=radio]")[next - 1]?.focus();
  };
  return (
    <div ref={ref} role="radiogroup" aria-label={`Weight for ${keyword}`} onKeyDown={onKey} className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <button
          key={i}
          type="button"
          role="radio"
          aria-checked={i === weight}
          aria-label={`${i} of 5${i === 1 ? ", nice to have" : i === 5 ? ", core" : ""}`}
          tabIndex={i === weight ? 0 : -1}
          onClick={() => onChange(i)}
          className={cx(
            "flex size-6 items-center justify-center rounded-md type-label tabular transition-colors",
            i === weight ? "bg-ink text-raised" : i < weight ? "bg-active text-ink" : "bg-inset text-muted hover:bg-line",
          )}
        >
          {i}
        </button>
      ))}
    </div>
  );
}

function AddKeyword({ onAdd }: { onAdd: (k: string) => void }) {
  const [text, setText] = useState("");
  const submit = () => {
    const k = text.trim().toLowerCase();
    if (k) onAdd(k);
    setText("");
  };
  return (
    <div className="flex gap-2">
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          e.preventDefault();
          submit();
        }}
        placeholder="Add a keyword, e.g. tokenization"
        aria-label="Add a keyword"
        className="h-9 min-w-0 flex-1 rounded-md border border-line bg-raised px-3 type-small placeholder:text-muted"
      />
      <Button onClick={submit} disabled={!text.trim()}>
        <Plus className="size-4" /> Add
      </Button>
    </div>
  );
}

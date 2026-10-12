import { FEW_COMPANIES, INDUSTRIES, INDUSTRY_BY_ID, INDUSTRY_GROUPS as GROUPS, industriesFromTitles } from "@rawjobs/core/catalog/industries";
import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import { ToggleChips } from "../components/ToggleChips";
import { useIndustryCounts } from "../lib/data";
import { ClearButton, Field, RESUME_LABEL, clearing, type StepProps } from "./fields";

// ---------- Industries ----------

// The catalog's groups (broadest first), each with its industries in catalog order. Nothing re-sorts: a chip stays where it was clicked.
const INDUSTRY_GROUPS = GROUPS.map((g) => ({ label: g.label, ids: INDUSTRIES.filter((i) => i.group === g.id).map((i) => i.id) }));
export const industryLabel = (id: string) => INDUSTRY_BY_ID.get(id)?.label ?? id;

/** "a, b and c", or "a, b and 3 more" past `max`. */
function listText(items: string[], max = 6): string {
  const shown = items.slice(0, max);
  const more = items.length - shown.length;
  if (more > 0) return `${shown.join(", ")} and ${more} more`;
  return shown.length > 1 ? `${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1]}` : (shown[0] ?? "");
}

export function IndustriesStep({ draft, update, suggest }: StepProps) {
  const [q, setQ] = useState("");
  const [said, setSaid] = useState("");
  const fromResume = (suggest?.industries ?? []).filter((id) => INDUSTRY_BY_ID.has(id));
  // No resume industries: suggest from the chosen roles instead ("Registered Nurse" -> Healthcare).
  const rolesKey = draft.include.join("\n");
  // biome-ignore lint/correctness/useExhaustiveDependencies: rolesKey stands for the roles' contents (a new array each render)
  const fromRoles = useMemo(() => industriesFromTitles(draft.include).slice(0, 5), [rolesKey]);
  const suggested = fromResume.length ? fromResume : suggest?.template ? [] : fromRoles;
  const why = fromResume
    .flatMap((id) => suggest?.industryWhy[id] ?? [])
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);
  const query = q.trim().toLowerCase();
  const matches = (id: string) => {
    const ind = INDUSTRY_BY_ID.get(id);
    return !query || !ind || ind.label.toLowerCase().includes(query) || ind.terms.some((t) => t.includes(query)) || id.includes(query);
  };
  // Topics the picked industries suggest; topics are added in Settings.
  const topics = [...new Set(draft.industries.flatMap((id) => INDUSTRY_BY_ID.get(id)?.topics ?? []))].filter((t) => !(t in draft.keywords));
  // Industries the directory has few companies in: say so, so picking one doesn't promise a big scan.
  const counts = useIndustryCounts();
  const few = (id: string) => (counts && id in counts && counts[id]! < FEW_COMPANIES ? "few companies" : undefined);
  /** Set the picks, and tell screen readers what changed. */
  const setPicks = (next: string[]) => {
    const added = next.find((id) => !draft.industries.includes(id));
    const removed = draft.industries.find((id) => !next.includes(id));
    if (added) setSaid(`Added ${industryLabel(added)}. ${next.length} picked.`);
    else if (removed) setSaid(`Removed ${industryLabel(removed)}. ${next.length} picked.`);
    update({ industries: next });
  };

  return (
    <div className="space-y-6">
      {suggested.length > 0 ? (
        <div className="rounded-md border border-dashed border-line p-4">
          <div className="mb-2 flex items-start gap-2">
            <p className="min-w-0 flex-1 type-small">
              <span className="font-semibold text-ink">{fromResume.length ? RESUME_LABEL(suggest) : "Suggested from your roles"}</span>
              <span className="text-muted">: click to add or remove</span>
            </p>
            <ClearButton
              count={draft.industries.filter((id) => suggested.includes(id)).length}
              noun={["industry", "industries"]}
              name="Clear suggested industries"
              {...clearing(draft, update, { industries: draft.industries.filter((id) => !suggested.includes(id)) })}
            />
          </div>
          <ToggleChips
            label="Suggested industries"
            options={suggested}
            selected={draft.industries.filter((id) => suggested.includes(id))}
            onChange={(next) => setPicks([...draft.industries.filter((id) => !suggested.includes(id)), ...next])}
            format={industryLabel}
            note={few}
          />
          {why.length > 0 && <p className="mt-2 type-small text-muted">Your resume mentions {listText(why.map(([t, n]) => `${t} ×${n}`))}.</p>}
        </div>
      ) : suggest?.template ? (
        <p className="type-small text-muted">Your saved resume looks like an empty template, so nothing is suggested. Replace it in the Resume step.</p>
      ) : suggest?.source ? (
        <p className="type-small text-muted">We didn't spot an industry in your resume. Pick any below, or skip: your jobs are still found by your roles and places.</p>
      ) : null}

      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search industries, e.g. biotech, SaaS, energy…"
            aria-label="Search industries"
            className="h-9 w-full rounded-md border border-line bg-raised pl-9 pr-3 type-small placeholder:text-muted"
          />
        </div>
        <ClearButton label="Clear all" count={draft.industries.length} noun={["industry", "industries"]} {...clearing(draft, update, { industries: [] })} />
      </div>

      {INDUSTRY_GROUPS.map((g) => {
        const ids = g.ids.filter(matches);
        if (!ids.length) return null;
        return (
          <Field
            key={g.label}
            label={g.label}
            action={
              <ClearButton
                count={draft.industries.filter((id) => g.ids.includes(id)).length}
                noun={["industry", "industries"]}
                name={`Clear ${g.label} industries`}
                {...clearing(draft, update, { industries: draft.industries.filter((id) => !g.ids.includes(id)) })}
              />
            }
          >
            <ToggleChips
              label={g.label}
              options={ids}
              selected={draft.industries.filter((id) => g.ids.includes(id))}
              // Picked ones stay listed even when the search hides them, so `next` is the whole group's selection.
              onChange={(next) => setPicks([...draft.industries.filter((id) => !g.ids.includes(id)), ...next])}
              format={industryLabel}
              note={few}
            />
          </Field>
        );
      })}

      <p className="type-small text-muted">
        {draft.industries.length === 0
          ? "None picked. That's OK: your jobs are found by your roles and places."
          : `${draft.industries.length} picked: ${listText(draft.industries.map(industryLabel))}. Companies in ${draft.industries.length === 1 ? "this industry" : "these industries"} are scanned and suggested, and you can narrow your Radar to ${draft.industries.length === 1 ? "it" : "them"}.`}
        {topics.length > 0 && <> To rank jobs higher by topics like {topics.slice(0, 5).join(", ")}, add them under Settings, Topics.</>}
      </p>
      <p role="status" className="sr-only">
        {said}
      </p>
    </div>
  );
}

import { matchesTerm } from "@rawjobs/core/text";
import { allTitles, COMMON_EXCLUDES, ROLE_FAMILIES, SENIORITY, type RoleFamily } from "@rawjobs/core/catalog/roles";
import { Check } from "lucide-react";
import { useCallback, useState } from "react";
import { Combobox, type ComboItem } from "../components/Combobox";
import { Field as InputField } from "../components/primitives";
import { ToggleChips } from "../components/ToggleChips";
import { Button, cx } from "../components/ui";
import type { Suggestions } from "../lib/suggest";
import { ClearButton, Field, MoreOptions, RESUME_LABEL, Section, clearing, hasAll, type StepProps, union } from "./fields";

// ---------- 2. Roles ----------

const TITLE_INDEX = allTitles();
const FAMILY_DEFAULT_TITLES = 6;

/** What a family starts with: titles from the resume that belong to it, else its most common ones. */
function familyDefaults(f: RoleFamily, suggest?: Suggestions) {
  const fromResume = (suggest?.titles ?? []).filter((t) => f.titles.includes(t));
  return {
    // Resume matches first, topped up with the family's most common titles.
    include: union(fromResume, f.titles).slice(0, Math.max(FAMILY_DEFAULT_TITLES, fromResume.length)),
    exclude: union(f.exclude, union(suggest?.exclude ?? [], ["intern", "junior"])),
  };
}

export function RolesStep({ draft, update, suggest }: StepProps) {
  const resumeYears = suggest?.experience?.years;
  const fam = ROLE_FAMILIES.find((f) => f.id === draft.family);
  const [choosing, setChoosing] = useState(!fam);
  const [query, setQuery] = useState("");
  const [undo, setUndo] = useState<{ family?: string; include: string[]; exclude: string[]; to: string } | null>(null);

  const famTitles = fam?.titles ?? [];
  const extras = draft.include.filter((t) => !famTitles.includes(t));
  const otherOptions = union(
    (suggest?.titles ?? []).filter((t) => !famTitles.includes(t)),
    extras,
  );
  const q = query.trim().toLowerCase();
  const families = ROLE_FAMILIES.filter((f) => !q || f.label.toLowerCase().includes(q) || f.titles.some((t) => t.includes(q)));
  const suggestedFamily = !fam && suggest?.titles.length ? ROLE_FAMILIES.find((f) => f.titles.some((t) => suggest.titles.includes(t)))?.id : undefined;

  const pickFamily = (id: string) => {
    setChoosing(false);
    setQuery("");
    if (id === draft.family) return;
    const next = ROLE_FAMILIES.find((f) => f.id === id)!;
    const d = familyDefaults(next, suggest);
    if (draft.include.length || draft.exclude.length) setUndo({ family: draft.family, include: draft.include, exclude: draft.exclude, to: next.label });
    else setUndo(null);
    update({ family: id, include: d.include, exclude: d.exclude });
  };

  /** Clear the family and its titles, and open the family list again. */
  const family = clearing(draft, update, { family: undefined, include: [] });
  const clearFamily = {
    onClear: () => {
      family.onClear();
      setUndo(null);
      setChoosing(true);
    },
    onUndo: () => {
      family.onUndo();
      setChoosing(false);
    },
  };

  const search = useCallback(
    (text: string): ComboItem[] => {
      const s = text.trim().toLowerCase();
      return (
        TITLE_INDEX.filter((t) => t.title.includes(s) || t.families.some((f) => f.toLowerCase().includes(s)))
          .filter((t) => !draft.include.includes(t.title))
          // Title starts with it, then contains it, then only its family matches.
          .sort((a, b) => {
            const rank = (t: string) => (t.startsWith(s) ? 0 : matchesTerm(t, s) ? 1 : t.includes(s) ? 2 : 3);
            return rank(a.title) - rank(b.title) || a.title.length - b.title.length;
          })
          .slice(0, 30)
          .map((t) => ({ key: t.title, label: t.title, hint: t.families.join(" · ") }))
      );
    },
    [draft.include],
  );

  return (
    <div className="space-y-8">
      <Section
        n={1}
        title="Job family"
        hint={undefined}
        action={
          fam && !choosing ? (
            <div className="flex shrink-0 gap-1">
              <Button size="sm" onClick={() => setChoosing(true)}>
                Change
              </Button>
              <ClearButton count={1} noun={["job family", "job family"]} message="Cleared the job family and its titles." {...clearFamily} />
            </div>
          ) : undefined
        }
      >
        {fam && !choosing ? (
          <div className="flex items-center gap-2 rounded-md border border-ink bg-active px-3 py-2.5">
            <Check className="size-4 text-ink" aria-hidden />
            <span className="font-semibold">{fam.label}</span>
            <span className="type-small text-muted">· {fam.titles.length} titles</span>
          </div>
        ) : (
          <div className="space-y-3">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter families, e.g. product, risk, sales…"
              aria-label="Filter job families"
              className="h-10 w-full rounded-md border border-line bg-raised px-3 type-small placeholder:text-muted"
            />
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {families.map((f) => {
                const active = f.id === draft.family;
                return (
                  <button
                    key={f.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => pickFamily(f.id)}
                    className={cx("flex items-center gap-2 rounded-md border px-3 py-2.5 text-left transition-colors", active ? "border-ink bg-active" : "border-line hover:bg-inset")}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="line-clamp-2 block type-small font-semibold">{f.label}</span>
                      <span className="block type-small text-muted">
                        {f.titles.length} titles{f.id === suggestedFamily ? " · matches your resume" : ""}
                      </span>
                    </span>
                    {active && <Check className="size-4 shrink-0 text-ink" aria-hidden />}
                  </button>
                );
              })}
              {families.length === 0 && <p className="type-small text-muted">No family matches “{query}”. Use the title search in the next section instead.</p>}
            </div>
            {fam && (
              <button type="button" className="type-label text-muted hover:text-ink" onClick={() => setChoosing(false)}>
                Keep {fam.label}
              </button>
            )}
          </div>
        )}
        {undo && (
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md bg-inset px-3 py-2 type-small">
            <span className="flex-1 text-muted">Switched to {undo.to}: titles and exclusions were reset to its defaults.</span>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                update({ family: undo.family, include: undo.include, exclude: undo.exclude });
                setUndo(null);
              }}
            >
              Undo
            </Button>
          </div>
        )}
      </Section>

      <Section
        n={2}
        title={fam ? `Titles in ${fam.label}` : "Job titles"}
        hint={undefined}
        action={
          <div className="flex shrink-0 gap-1">
            {fam && (
              <Button size="sm" variant="ghost" onClick={() => update({ include: union(fam.titles, extras) })} disabled={hasAll(draft.include, fam.titles)}>
                Select all
              </Button>
            )}
            <ClearButton count={draft.include.length} noun={["title", "titles"]} {...clearing(draft, update, { include: [] })} />
          </div>
        }
      >
        <div className="space-y-4">
          {fam ? (
            <ToggleChips
              label={`Titles in ${fam.label}`}
              options={fam.titles}
              selected={draft.include.filter((t) => famTitles.includes(t))}
              onChange={(next) => update({ include: [...next, ...extras] })}
            />
          ) : (
            !draft.include.length && <p className="type-small text-muted">Pick a job family above, or search for titles below.</p>
          )}
          {otherOptions.length > 0 && (
            <div>
              <p className="mb-1.5 type-label text-muted">
                {fam ? "Other titles" : "Your titles"}
                {suggest?.titles.length ? ` (incl. ${RESUME_LABEL(suggest).toLowerCase()})` : ""}
              </p>
              <ToggleChips label="Other titles" options={otherOptions} selected={extras} onChange={(next) => update({ include: [...draft.include.filter((t) => famTitles.includes(t)), ...next] })} />
            </div>
          )}
          <div>
            <p className="mb-1.5 type-label text-muted">Add a title from any family</p>
            <Combobox
              label="Search job titles"
              placeholder={`Search ${TITLE_INDEX.length}+ titles, or type your own…`}
              search={search}
              onPick={(i) => update({ include: union(draft.include, [i.key]) })}
              onFreeText={(t) => update({ include: union(draft.include, [t]) })}
            />
          </div>
        </div>
      </Section>

      <MoreOptions
        summary={[
          draft.exclude.length && `${draft.exclude.length} hidden`,
          draft.seniority.length && `${draft.seniority.length} seniority`,
          draft.experienceYears !== undefined ? `${draft.experienceYears} years` : resumeYears !== undefined && `${resumeYears} years from resume?`,
        ]
          .filter(Boolean)
          .join(" · ")}
      >
        <Field
          label="Never show me"
          hint="Hide titles with these words."
          action={<ClearButton count={draft.exclude.length} noun={["hidden word", "hidden words"]} {...clearing(draft, update, { exclude: [] })} />}
        >
          <ToggleChips
            label="Titles to hide"
            tone="bad"
            options={union(union(fam?.exclude ?? [], suggest?.exclude ?? []), COMMON_EXCLUDES)}
            selected={draft.exclude}
            onChange={(exclude) => update({ exclude })}
            addPlaceholder="Add another…"
          />
        </Field>
        <Field
          label="Seniority"
          hint="Titles with these words rank higher."
          action={<ClearButton count={draft.seniority.length} noun={["seniority word", "seniority words"]} {...clearing(draft, update, { seniority: [] })} />}
        >
          <ToggleChips
            label="Seniority words"
            tone="plain"
            options={union(union(suggest?.seniority ?? [], SENIORITY), draft.seniority)}
            selected={draft.seniority}
            onChange={(seniority) => update({ seniority })}
            addPlaceholder="Add another…"
          />
        </Field>
        <div className="space-y-2">
          <InputField
            label="Years of experience"
            help="Jobs whose must-haves ask for more than a year beyond this rank lower. Leave empty to skip."
            className="max-w-[24rem]"
            inputClassName="max-w-[6rem]"
            inputMode="numeric"
            placeholder={resumeYears === undefined ? "6" : undefined}
            maxLength={2}
            value={draft.experienceYears === undefined ? "" : String(draft.experienceYears)}
            onChange={(e) => {
              const digits = e.target.value.replace(/\D/g, "");
              update({ experienceYears: digits ? Number(digits) : undefined });
            }}
          />
          {suggest?.experience && draft.experienceYears !== suggest.experience.years && (
            <p className="flex flex-wrap items-center gap-2 type-small text-muted">
              <span>
                {RESUME_LABEL(suggest)}: about {suggest.experience.years} {suggest.experience.years === 1 ? "year" : "years"} across {suggest.experience.roles}{" "}
                {suggest.experience.roles === 1 ? "role" : "roles"}, gaps left out.
              </span>
              <Button size="sm" onClick={() => update({ experienceYears: suggest.experience?.years })}>
                Use {suggest.experience.years}
              </Button>
            </p>
          )}
        </div>
      </MoreOptions>
    </div>
  );
}

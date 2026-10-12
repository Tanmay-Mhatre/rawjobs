import { matchesTerm } from "@rawjobs/core/text";
import { COUNTRIES, countryTerms, groupPlaces, REGIONS, searchPlaces } from "@rawjobs/core/catalog/places";
import { FEW_COMPANIES, INDUSTRIES, INDUSTRY_BY_ID, INDUSTRY_GROUPS as GROUPS, industriesFromTitles } from "@rawjobs/core/catalog/industries";
import { allTitles, COMMON_EXCLUDES, ROLE_FAMILIES, SENIORITY, type RoleFamily } from "@rawjobs/core/catalog/roles";
import { Check, ChevronDown, Plus, Search, X } from "lucide-react";
import { createContext, useCallback, useContext, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Combobox, type ComboItem } from "../components/Combobox";
import { ToggleChips } from "../components/ToggleChips";
import { toast } from "../components/Toast";
import { Button, cx, Toggle } from "../components/ui";
import { useIndustryCounts } from "../lib/data";
import { displayPlace } from "../lib/format";
import type { Suggestions } from "../lib/suggest";
import { inferFamily, type Draft } from "../lib/setup";
import { CV_DICTIONARY, KEYWORD_PACKS, REMOTE_EXCLUDE_SUGGESTIONS } from "./presets";

export type StepProps = { draft: Draft; update: (patch: Partial<Draft>) => void; suggest?: Suggestions };

/** Heading level for section titles inside a step: 2 under the wizard's h1, 3 under a Settings h2. */
export const HeadingLevel = createContext<2 | 3>(3);
function SectionHeading({ children }: { children: ReactNode }) {
  const H = useContext(HeadingLevel) === 2 ? "h2" : "h3";
  return <H className="type-small font-semibold">{children}</H>;
}

export function Field({ label, hint, action, children }: { label: string; hint?: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <div className="space-y-2">
      {/* Room for the action (a Clear that appears with the first pick), so picking doesn't push the chips down. */}
      <div className={cx("flex items-start gap-2", action != null && "min-h-7")}>
        <div className="min-w-0 flex-1">
          <SectionHeading>{label}</SectionHeading>
          {hint && <p className="mt-0.5 type-small text-muted">{hint}</p>}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

/** A clear for these draft fields, and an undo that puts back what they hold now. */
export function clearing(draft: Draft, update: (patch: Partial<Draft>) => void, patch: Partial<Draft>) {
  const before = Object.fromEntries(Object.keys(patch).map((k) => [k, draft[k as keyof Draft]])) as Partial<Draft>;
  return { onClear: () => update(patch), onUndo: () => update(before) };
}

/**
 * "Clear" for a section with picks: empties it at once and offers Undo in a toast.
 * Renders nothing when there's nothing to clear.
 */
export function ClearButton({
  count,
  noun,
  onClear,
  onUndo,
  label = "Clear",
  message,
  name,
}: {
  count: number;
  /** [one, many], e.g. ["title", "titles"]. */
  noun: [string, string];
  onClear: () => void;
  onUndo: () => void;
  label?: string;
  /** Toast text, when "Cleared 3 titles." doesn't read well. */
  message?: string;
  /** Accessible name when several clears on a page share a noun, e.g. "Clear Payments & banking industries". */
  name?: string;
}) {
  if (!count) return null;
  const what = `${count} ${count === 1 ? noun[0] : noun[1]}`;
  return (
    <Button
      size="sm"
      variant="ghost"
      className="shrink-0"
      aria-label={name ?? `${label} ${noun[1]}`}
      onClick={() => {
        onClear();
        toast({ message: message ?? `Cleared ${what}.`, actionLabel: "Undo", onAction: onUndo });
      }}
    >
      {label}
    </Button>
  );
}

function PickButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cx("inline-flex h-9 items-center gap-1.5 rounded-md border px-3 type-label transition-colors", active ? "border-ink bg-ink text-raised" : "border-line bg-raised hover:bg-inset")}
    >
      {active && <Check className="size-4" aria-hidden />}
      {children}
    </button>
  );
}

const union = (a: string[], b: string[]) => [...a, ...b.filter((x) => !a.includes(x))];
const hasAll = (a: string[], b: string[]) => b.every((x) => a.includes(x));

// ---------- 2. Roles ----------

const TITLE_INDEX = allTitles();
const RESUME_LABEL = (s?: Suggestions) => (s?.source === "ai" ? "From your master resume" : "From your resume");
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

/** Secondary settings, collapsed until wanted. The summary says what's inside without opening it. */
export function MoreOptions({ summary, children }: { summary?: string; children: ReactNode }) {
  return (
    <details className="group rounded-md border border-line">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 type-label">
        <ChevronDown className="size-4 text-muted transition-transform group-open:rotate-180" />
        More options
        {summary && <span className="ml-auto truncate pl-2 font-normal text-muted">{summary}</span>}
      </summary>
      <div className="space-y-6 border-t border-line p-3 sm:p-4">{children}</div>
    </details>
  );
}

function Section({ n, title, hint, action, children }: { n: number; title: string; hint?: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-start gap-x-2.5 gap-y-2">
        <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-sm bg-inset type-label text-ink">{n}</span>
        <div className="min-w-[14rem] flex-1">
          <SectionHeading>{title}</SectionHeading>
          {hint && <p className="mt-0.5 type-small text-muted">{hint}</p>}
        </div>
        {action}
      </div>
      <div className="sm:pl-8">{children}</div>
    </section>
  );
}

export function RolesStep({ draft, update, suggest }: StepProps) {
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

      <MoreOptions summary={[draft.exclude.length && `${draft.exclude.length} hidden`, draft.seniority.length && `${draft.seniority.length} seniority`].filter(Boolean).join(" · ")}>
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
      </MoreOptions>
    </div>
  );
}

// ---------- 3. Locations ----------

const POPULAR_COUNTRIES = ["united arab emirates", "saudi arabia", "qatar", "united kingdom", "united states", "india", "singapore", "germany", "netherlands", "canada", "australia"];
const QUICK_REGIONS = ["emea", "europe", "mena", "gcc", "north america", "latam", "apac", "asia", "africa"];
const countryByName = new Map(COUNTRIES.map((c) => [c.name, c]));
const regionByName = new Map(REGIONS.map((r) => [r.name, r]));
const titleCase = displayPlace;
const ACRONYMS = new Set(["emea", "mena", "gcc", "apac", "latam", "dach", "cee", "anz", "amer", "eu"]);
const regionLabel = (name: string) => (ACRONYMS.has(name) ? name.toUpperCase() : titleCase(name));
/** Display form of any place term: regions like "emea" in capitals, everything else title-cased. */
export const placeLabel = (term: string) => (regionByName.has(term) ? regionLabel(term) : displayPlace(term));

function placeItems(q: string, opts: { regions: boolean; remote: boolean }): ComboItem[] {
  return searchPlaces(q, 14)
    .filter((h) => opts.regions || h.kind !== "region")
    .map((h): ComboItem => {
      if (h.kind === "country") {
        const extra = h.country.aliases.length ? ` (${h.country.aliases.slice(0, 2).join(", ")})` : "";
        return {
          key: `country:${h.country.name}`,
          label: opts.remote ? `Remote in ${titleCase(h.country.name)}` : titleCase(h.country.name) + extra,
          hint: opts.remote ? "country" : `country · ${h.country.cities.length} cities: ${h.country.cities.slice(0, 3).join(", ")}…`,
        };
      }
      if (h.kind === "city") return { key: `city:${h.city}`, label: titleCase(h.city), hint: `city · ${titleCase(h.country.name)}` };
      return { key: `region:${h.region.name}`, label: regionLabel(h.region.name), hint: h.region.hint };
    });
}

/** Terms a picked item adds: a country brings its aliases (and cities, for offices). */
function termsFor(key: string, withCities: boolean): string[] {
  const kind = key.slice(0, key.indexOf(":"));
  const name = key.slice(key.indexOf(":") + 1);
  if (kind === "country") {
    const c = countryByName.get(name);
    return c ? countryTerms(c, withCities) : [name];
  }
  if (kind === "region") {
    const r = regionByName.get(name);
    return r ? [r.name, ...r.aliases] : [name];
  }
  return [name];
}

/** Every term a country or region could have added, so turning it off removes all of them. */
function allTermsFor(key: string): string[] {
  return termsFor(key, true);
}

/**
 * Selected places shown as one chip per country/region (not one per city or alias).
 * × removes the whole group; clicking a group lets you deselect single cities or names.
 */
function GroupedPlaces({ terms, onChange, label, remote }: { terms: string[]; onChange: (t: string[]) => void; label: string; remote?: boolean }) {
  const [open, setOpen] = useState<string | null>(null);
  const groups = groupPlaces(terms);
  if (!groups.length) return <p className="type-small text-muted">Nothing selected yet.</p>;
  const openGroup = groups.find((g) => g.key === open);
  return (
    <div className="space-y-2">
      <div role="list" aria-label={label} className="flex flex-wrap gap-1.5">
        {groups.map((g) => {
          // Only cities picked (not the country itself): name the cities, e.g. "Riyadh · Saudi Arabia".
          const citiesOnly = g.kind === "country" && !g.terms.includes(g.name) && g.terms.length <= 2;
          const name =
            g.kind === "region"
              ? regionLabel(g.name)
              : citiesOnly
                ? `${g.terms.map(titleCase).join(", ")} · ${titleCase(g.name)}`
                : g.kind === "country"
                  ? remote
                    ? `Remote in ${titleCase(g.name)}`
                    : titleCase(g.name)
                  : g.name === "remote"
                    ? "Anywhere"
                    : titleCase(g.name);
          const expandable = g.options.length > 1;
          return (
            <span
              key={g.key}
              role="listitem"
              className={cx("inline-flex h-8 items-center rounded-md border type-label", open === g.key ? "border-ink bg-active text-ink" : "border-line bg-raised text-ink")}
            >
              <button
                type="button"
                disabled={!expandable}
                onClick={() => setOpen(open === g.key ? null : g.key)}
                aria-expanded={expandable ? open === g.key : undefined}
                className="flex h-full items-center gap-1 pl-2.5 pr-1 disabled:cursor-default"
                title={g.terms.join(", ")}
              >
                {name}
                {expandable && !citiesOnly && (
                  <span className="tabular font-normal text-muted">
                    · {g.terms.length}/{g.options.length}
                  </span>
                )}
                {expandable && <ChevronDown className={cx("size-3.5 transition-transform", open === g.key && "rotate-180")} />}
              </button>
              <button
                type="button"
                aria-label={`Remove ${name}`}
                onClick={() => {
                  onChange(terms.filter((t) => !g.terms.includes(t)));
                  if (open === g.key) setOpen(null);
                }}
                className="flex h-full items-center rounded-r-md px-1.5 opacity-70 hover:opacity-100"
              >
                <X className="size-3.5" />
              </button>
            </span>
          );
        })}
      </div>
      {openGroup && (
        <div className="rounded-md border border-line bg-inset/40 p-3">
          <p className="mb-2 type-small text-muted">
            Words matched for <b className="text-ink">{titleCase(openGroup.name)}</b>. Deselect any you don't want.
          </p>
          <ToggleChips
            size="sm"
            label={`Terms for ${openGroup.name}`}
            options={openGroup.options}
            selected={openGroup.terms}
            format={titleCase}
            onChange={(next) => onChange([...terms.filter((t) => !openGroup.options.includes(t)), ...next])}
          />
        </div>
      )}
    </div>
  );
}

/** The country this browser is set to (from its language, e.g. en-GB), if it's in the catalogue. */
function localeCountry(): string | undefined {
  try {
    const region = new Intl.Locale(navigator.language).maximize().region;
    const name = region && new Intl.DisplayNames(["en"], { type: "region" }).of(region)?.toLowerCase();
    return name && countryByName.has(name) ? name : undefined;
  } catch {
    return undefined;
  }
}

/** Short codes in capitals ("US", "UAE"), everything else title-cased. */
const termLabel = (t: string) => (t.length <= 3 ? t.toUpperCase() : placeLabel(t));

const WORK_STYLES = [
  { id: "onsite", label: "On-site" },
  { id: "hybrid", label: "Hybrid" },
  { id: "remote", label: "Remote" },
] as const;

export function LocationsStep({ draft, update, suggest }: StepProps) {
  const [withCities, setWithCities] = useState(true);
  const officeSearch = useCallback((q: string) => placeItems(q, { regions: false, remote: false }), []);
  const remoteSearch = useCallback((q: string) => placeItems(q, { regions: true, remote: true }), []);
  const officeGroups = new Set(groupPlaces(draft.places).map((g) => g.key));
  const remoteGroups = new Set(groupPlaces(draft.remoteOk).map((g) => g.key));
  // Your own country first, then the usual list.
  const popular = useMemo(
    () =>
      union(
        [localeCountry()].filter((c): c is string => !!c),
        POPULAR_COUNTRIES,
      ),
    [],
  );
  const office = draft.office.length > 0;

  /** Quick toggle: on adds the group's terms, off removes every term the group could have added. */
  const toggleGroup = (list: "places" | "remoteOk", key: string, add: string[]) => {
    const current = draft[list];
    const isOn = (list === "places" ? officeGroups : remoteGroups).has(key) || (key.startsWith("term:") && current.includes(key.slice(5)));
    const all = key.startsWith("term:") ? [key.slice(5)] : allTermsFor(key);
    update({ [list]: isOn ? current.filter((t) => !all.includes(t)) : union(current, add) } as Partial<Draft>);
  };

  const toggleStyle = (id: (typeof WORK_STYLES)[number]["id"]) => {
    if (id === "remote") return update({ remote: !draft.remote });
    update({ office: draft.office.includes(id) ? draft.office.filter((o) => o !== id) : [...draft.office, id] });
  };

  return (
    <div className="space-y-8">
      <Field
        label="Work style"
        action={<ClearButton count={draft.office.length + (draft.remote ? 1 : 0)} noun={["work style", "work styles"]} {...clearing(draft, update, { office: [], remote: false })} />}
      >
        <div className="flex flex-wrap gap-2">
          {WORK_STYLES.map((w) => (
            <PickButton key={w.id} active={w.id === "remote" ? draft.remote : draft.office.includes(w.id)} onClick={() => toggleStyle(w.id)}>
              {w.label}
            </PickButton>
          ))}
        </div>
      </Field>

      {office && (
        <Field
          label={draft.office.length === 2 ? "Office locations" : draft.office[0] === "hybrid" ? "Hybrid locations" : "On-site locations"}
          action={<ClearButton count={groupPlaces(draft.places).length} noun={["place", "places"]} {...clearing(draft, update, { places: [] })} />}
        >
          <Combobox
            label="Search places"
            placeholder="City or country, e.g. Dubai, London…"
            search={officeSearch}
            onPick={(i) => update({ places: union(draft.places, termsFor(i.key, withCities)) })}
            onFreeText={(t) => update({ places: union(draft.places, [t]) })}
          />
          <div className="flex flex-wrap items-center gap-1.5">
            {popular.map((name) => {
              const key = `country:${name}`;
              const active = officeGroups.has(key);
              return (
                <button
                  key={name}
                  type="button"
                  aria-pressed={active}
                  onClick={() => toggleGroup("places", key, countryTerms(countryByName.get(name)!, withCities))}
                  className={cx(
                    "inline-flex h-7 items-center gap-1 rounded-md border px-2 type-label",
                    active ? "border-ink bg-ink text-raised" : "border-dashed border-line text-muted hover:border-ink/40 hover:bg-hover hover:text-ink",
                  )}
                >
                  {active ? <Check className="size-3" /> : <Plus className="size-3" />}
                  {titleCase(name)}
                </button>
              );
            })}
          </div>
          {suggest?.places.length ? (
            <div>
              <p className="mb-1.5 type-label text-muted">{RESUME_LABEL(suggest)}</p>
              <ToggleChips
                size="sm"
                label="Places from your resume"
                options={suggest.places}
                selected={draft.places.filter((p) => suggest.places.includes(p))}
                format={titleCase}
                onChange={(next) => update({ places: [...draft.places.filter((p) => !suggest.places.includes(p)), ...next] })}
              />
            </div>
          ) : null}
          {draft.places.length > 0 && <GroupedPlaces label="Selected places" terms={draft.places} onChange={(places) => update({ places })} />}
        </Field>
      )}

      {draft.remote && (
        <Field label="Remote from" action={<ClearButton count={groupPlaces(draft.remoteOk).length} noun={["remote region", "remote regions"]} {...clearing(draft, update, { remoteOk: [] })} />}>
          <Combobox
            label="Search remote regions"
            placeholder="Region or country, e.g. EMEA, Germany…"
            search={remoteSearch}
            onPick={(i) => update({ remoteOk: union(draft.remoteOk, termsFor(i.key, false)) })}
            onFreeText={(t) => update({ remoteOk: union(draft.remoteOk, [t]) })}
          />
          <div className="flex flex-wrap gap-1.5">
            {[{ key: "term:remote", label: "Anywhere", add: ["remote"] }, ...QUICK_REGIONS.map((r) => ({ key: `region:${r}`, label: regionLabel(r), add: termsFor(`region:${r}`, false) }))].map(
              (g) => {
                const active = g.key === "term:remote" ? draft.remoteOk.includes("remote") : remoteGroups.has(g.key);
                return (
                  <PickButton key={g.key} active={active} onClick={() => toggleGroup("remoteOk", g.key, g.add)}>
                    {g.label}
                  </PickButton>
                );
              },
            )}
          </div>
          {suggest?.remoteRegions.length ? (
            <div>
              <p className="mb-1.5 type-label text-muted">{RESUME_LABEL(suggest)}</p>
              <ToggleChips
                size="sm"
                label="Remote regions from your resume"
                options={suggest.remoteRegions}
                selected={draft.remoteOk.filter((p) => suggest.remoteRegions.includes(p))}
                format={regionLabel}
                onChange={(next) => update({ remoteOk: [...draft.remoteOk.filter((p) => !suggest.remoteRegions.includes(p)), ...next] })}
              />
            </div>
          ) : null}
          {draft.remoteOk.length > 0 && <GroupedPlaces label="Selected remote regions" remote terms={draft.remoteOk} onChange={(remoteOk) => update({ remoteOk })} />}
        </Field>
      )}

      <MoreOptions summary={draft.remote && draft.remoteExclude.length ? `${draft.remoteExclude.length} remote limits skipped` : undefined}>
        <Toggle checked={withCities} onChange={setWithCities}>
          When I pick a country, also add its main cities
        </Toggle>
        {draft.remote && (
          <Field
            label="Skip remote jobs limited to"
            hint="For example “Remote (US only)”."
            action={<ClearButton count={draft.remoteExclude.length} noun={["remote limit", "remote limits"]} {...clearing(draft, update, { remoteExclude: [] })} />}
          >
            <ToggleChips
              label="Remote regions to skip"
              tone="bad"
              options={REMOTE_EXCLUDE_SUGGESTIONS}
              selected={draft.remoteExclude}
              onChange={(remoteExclude) => update({ remoteExclude })}
              format={termLabel}
              addPlaceholder="Add another…"
            />
          </Field>
        )}
      </MoreOptions>
    </div>
  );
}

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

import { COUNTRIES, countryTerms, groupPlaces, REGIONS, searchPlaces } from "@rawjobs/core/catalog/places";
import { Check, ChevronDown, Plus, X } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { Combobox, type ComboItem } from "../components/Combobox";
import { ToggleChips } from "../components/ToggleChips";
import { cx, Toggle } from "../components/ui";
import { displayPlace } from "../lib/format";
import type { Draft } from "../lib/setup";
import { REMOTE_EXCLUDE_SUGGESTIONS } from "./presets";
import { ClearButton, Field, MoreOptions, PickButton, RESUME_LABEL, clearing, type StepProps, union } from "./fields";

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

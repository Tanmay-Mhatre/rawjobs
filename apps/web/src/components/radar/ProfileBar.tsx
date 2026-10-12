import { INDUSTRY_BY_ID } from "@rawjobs/core/catalog/industries";
import { Check, Globe, LoaderCircle, MapPin, Pencil, UserRound } from "lucide-react";
import { useState } from "react";
import type { Profile } from "../../lib/data";
import { REMOTE } from "../../lib/filters";
import { displayPlace } from "../../lib/format";
import { Button, cx } from "../ui";

/**
 * What your profile searches for, always visible, with Edit. When the place or industry filters
 * differ from it: Reset, or Save to my profile (updates Settings and rescans).
 */
export function ProfileBar({
  profile,
  placeFilter,
  everywhere,
  onEverywhere,
  changed,
  onEdit,
  onReset,
  onSave,
}: {
  profile: Profile;
  /** The place filter your profile puts on the Radar ("Germany", "Remote"). */
  placeFilter: string[];
  /** "Show everywhere" is on: the place filter is off. */
  everywhere: boolean;
  onEverywhere: (on: boolean) => void;
  changed: boolean;
  onEdit: () => void;
  onReset: () => void;
  onSave?: () => Promise<string | null>;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const regions = profile.locations.remote_ok.filter((r) => r !== "remote");
  // The places you actually picked ("Berlin"), not the countries we filter by.
  const yourPlaces = profile.locations.include.map(displayPlace);
  const parts = [
    profile.titles.include.slice(0, 3).join(", ") + (profile.titles.include.length > 3 ? ` +${profile.titles.include.length - 3}` : ""),
    yourPlaces.length ? yourPlaces.slice(0, 4).join(", ") + (yourPlaces.length > 4 ? ` +${yourPlaces.length - 4}` : "") : null,
    profile.locations.remote_ok.length
      ? regions.length
        ? `Remote in ${regions
            .slice(0, 3)
            .map((r) => (r.length <= 4 ? r.toUpperCase() : displayPlace(r)))
            .join(", ")}`
        : "Remote"
      : null,
    profile.industries.length ? profile.industries.map((i) => INDUSTRY_BY_ID.get(i)?.label ?? i).join(", ") : null,
  ].filter(Boolean);

  const save = async () => {
    if (!onSave) return;
    setSaving(true);
    setError(null);
    const err = await onSave();
    setSaving(false);
    setError(err);
  };

  const places = placeFilter.map((c) => (c === REMOTE ? "Remote" : displayPlace(c))).join(", ");
  return (
    <div className={cx("rounded-md border px-3 py-2 type-small", changed ? "border-warning bg-warning-subtle" : "border-line bg-raised")}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <UserRound className="rj-icon hidden text-muted sm:block" aria-hidden />
        {/* One line: what your profile searches for, truncated; the full text is in Settings. On phones the
            buttons wrap below it. */}
        <p className="min-w-0 basis-full truncate sm:flex-1 sm:basis-0" title={parts.join(" · ")}>
          <span className="font-medium">Your profile:</span> <span className="text-muted">{parts.join(" · ")}</span>
        </p>
        {placeFilter.length > 0 && !changed && (
          <Button size="sm" variant="ghost" className="shrink-0" onClick={() => onEverywhere(!everywhere)} title={everywhere ? "Showing jobs everywhere" : `Showing your places: ${places}`}>
            {everywhere ? <MapPin className="rj-icon" aria-hidden /> : <Globe className="rj-icon" aria-hidden />}
            {everywhere ? "Only my places" : "Show everywhere"}
          </Button>
        )}
        <Button size="sm" variant="ghost" className="shrink-0" onClick={onEdit}>
          <Pencil className="rj-icon" aria-hidden /> Edit
        </Button>
      </div>
      {changed && (
        <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-hairline pt-2">
          <p className="min-w-0 flex-1 type-small text-ink">Your place filters differ from your profile. This only changes what you see here; your scans and alerts still use your profile.</p>
          <Button size="sm" variant="ghost" onClick={onReset} disabled={saving}>
            Reset to my profile
          </Button>
          {onSave && (
            <Button size="sm" variant="primary" onClick={() => void save()} disabled={saving}>
              {saving ? <LoaderCircle className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
              {saving ? "Saving…" : "Save to my profile"}
            </Button>
          )}
        </div>
      )}
      {error && <p className="mt-1.5 type-small text-danger-text">{error}</p>}
    </div>
  );
}

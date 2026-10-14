import type { Job } from "./data";

const DAY = 86_400_000;

export function timeAgo(iso: string | undefined, now = Date.now()): string {
  if (!iso) return "—";
  const ms = now - Date.parse(iso);
  if (Number.isNaN(ms)) return "—";
  if (ms < 60_000) return "just now";
  const mins = Math.round(ms / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(ms / DAY);
  if (days < 30) return `${days}d ago`;
  const months = Math.round(days / 30);
  return months < 12 ? `${months}mo ago` : `${Math.round(months / 12)}y ago`;
}

/** The age alone, for source tags: "2d", "3h", "now". */
export function shortAge(iso: string | undefined, now = Date.now()): string {
  const t = timeAgo(iso, now);
  return t === "just now" ? "now" : t.replace(/ ago$/, "");
}

export function ageDays(iso: string | undefined, now = Date.now()): number {
  return iso ? (now - Date.parse(iso)) / DAY : Infinity;
}

export function formatDate(iso: string | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export function formatDateTime(iso: string | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

const compact = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });

export function formatSalary(s: Job["salary"]): string | null {
  if (!s || (s.min == null && s.max == null)) return null;
  const range = s.min != null && s.max != null && s.min !== s.max ? `${compact.format(s.min)}–${compact.format(s.max)}` : compact.format((s.min ?? s.max)!);
  return `${s.currency ? `${s.currency} ` : ""}${range}${s.period ? ` / ${s.period}` : ""}`;
}

/** The date a job counts from: ATS posting date, else when we first saw it. */
export const postedOrSeen = (j: Job) => j.postedAt ?? j.firstSeen;

const SMALL_WORDS = new Set(["and", "of", "the", "de", "da", "do", "del", "la", "le", "am", "im", "an", "der", "upon", "on"]);
/**
 * Display form of a place or name the user typed or we matched in lowercase ("berlin" → "Berlin",
 * "united arab emirates" → "United Arab Emirates", "frankfurt am main" → "Frankfurt am Main").
 * Strings that already contain capitals are returned as is, so "UAE" or "NYC" stay intact.
 */
export function displayPlace(s: string): string {
  if (/[A-Z]/.test(s)) return s;
  return s
    .split(/(\s+|-)/)
    .map((w, i) => (i > 0 && SMALL_WORDS.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join("");
}

/** Directory-sized totals shown to people: "~21,000". Exact below 1,000. One rounding everywhere (see H9 in docs/design-review.md). */
export function roughCount(n: number): string {
  if (n < 1000) return n.toLocaleString();
  return `~${(Math.round(n / 1000) * 1000).toLocaleString()}`;
}

/** A count that fits a narrow column: exact below 10,000, then "12.2K" (locale-aware). Show the exact number nearby for screen readers. */
export function shortCount(n: number): string {
  return n < 10000 ? n.toLocaleString() : new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

/** One format for several places everywhere: "Berlin", or "Berlin +3" (L5). Cities lose their ", Country" suffix. */
export function placeSummary(places: string[], fallback = "Location not listed"): string {
  // ATS strings often pack several places: "Germany (remote); Portugal (remote); Berlin Office".
  const parts = places
    .flatMap((p) => p.split(/\s*[;|]\s*/))
    .map((p) =>
      p
        .replace(/\s*\([^)]*\)$/, "")
        .replace(/, [^,]+$/, "")
        .trim(),
    );
  const names = [...new Set(parts.filter(Boolean).map(displayPlace))];
  if (!names.length) return fallback;
  return names.length > 1 ? `${names[0]} +${names.length - 1}` : names[0]!;
}

import { safeUrl } from "@rawjobs/core/text";
import { ChevronDown, ExternalLink, EyeOff } from "lucide-react";
import { useState } from "react";
import { ATS_LABEL, SUPPORTED } from "../../lib/companies";
import type { CompanySuggestion } from "../../lib/companySuggest";
import { displayPlace } from "../../lib/format";
import { AddButton } from "../CompanyButtons";
import { StatusGlyph, type GlyphShape } from "../primitives";
import { Button, cx } from "../ui";

/** "Strong fit" and friends instead of a bare number: the score is relative, the label is what people act on. */
export function fitOf(score: number): { label: string; shape: GlyphShape } {
  if (score >= 70) return { label: "Strong fit", shape: "full" };
  if (score >= 45) return { label: "Good fit", shape: "half" };
  return { label: "Worth a look", shape: "empty" };
}

/** The fit as plain text with the score glyph (shape, not color, carries the band). */
export function FitLabel({ score, className }: { score: number; className?: string }) {
  const fit = fitOf(score);
  return (
    <span className={cx("inline-flex shrink-0 items-center gap-1.5 type-small text-ink", className)} title={`Score ${score} / 100`}>
      <StatusGlyph shape={fit.shape} />
      {fit.label}
    </span>
  );
}

/**
 * "Product Manager (United Kingdom; Brazil; …20 more)" -> "Product Manager · United Kingdom +21". Handles places that
 * carry their own brackets ("Designer (Germany (remote); Portugal (remote); Italy)" -> "Designer · Germany (remote) +2").
 */
export function shortExample(example: string): string {
  const text = example.trim();
  if (!text.endsWith(")")) return text;
  // Find the "(" that opens the last bracket group.
  let depth = 0;
  let open = -1;
  for (let i = text.length - 1; i >= 0; i--) {
    if (text[i] === ")") depth++;
    else if (text[i] === "(" && --depth === 0) {
      open = i;
      break;
    }
  }
  if (open <= 0) return text;
  const title = text.slice(0, open).trim();
  const parts = text
    .slice(open + 1, -1)
    .split(/\s*;\s*/)
    .filter(Boolean);
  const more = parts.reduce((n, p) => n + (Number(p.match(/(\d+) more/)?.[1]) || 0), 0);
  const places = parts.filter((p) => !/^…?\s*\d+ more$/.test(p));
  if (!places.length) return title;
  const extra = places.length - 1 + more;
  return `${title} · ${displayPlace(places[0]!)}${extra > 0 ? ` +${extra}` : ""}`;
}

/** Initials on a tinted square: no logo fetches (they'd tell a third party which companies you look at). */
const MONOGRAM_SIZE = { xs: "size-5 rounded-sm type-meta", sm: "size-7 rounded-sm type-meta", md: "size-10 rounded-sm type-label" };

export function Monogram({ name, size = "md" }: { name: string; size?: keyof typeof MONOGRAM_SIZE }) {
  const words = name
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
  const text = (words.length > 1 ? words[0]![0]! + words[1]![0]! : (words[0] ?? "?").slice(0, 2)).toUpperCase();
  // Neutral, like the feed's avatars: color is kept for scores and status.
  return (
    <span aria-hidden className={cx("inline-flex shrink-0 items-center justify-center border border-hairline bg-inset text-muted", MONOGRAM_SIZE[size])}>
      {text}
    </span>
  );
}

/** Reasons already said in the headline line, so chips don't repeat them. */
const HEADLINE = /^\d+ (open roles? (match|matches) you|new this week)$/;

type Props = {
  s: CompanySuggestion & { like?: string };
  added: boolean;
  onAdd: () => void;
  onRemove: () => void;
  onHide?: () => void;
};

/** One suggested company: why it fits, an example role, and Add / Don't suggest. */
export function SuggestionCard({ s, added, onAdd, onRemove, onHide }: Props) {
  const [open, setOpen] = useState(false);
  const soon = !SUPPORTED.has(s.ats);
  const headline = s.matches
    ? [`${s.matches} ${s.matches === 1 ? "role matches" : "roles match"} you`, s.new_matches > 0 && `${s.new_matches} new this week`].filter(Boolean).join(" · ")
    : s.near_misses
      ? `${s.near_misses} similar ${s.near_misses === 1 ? "role" : "roles"} nearby or remote`
      : null;
  const chips = s.reasons.filter((r) => !HEADLINE.test(r) && !r.startsWith("Like "));
  const like = s.reasons.find((r) => r.startsWith("Like "));
  return (
    <article className={cx("flex min-w-0 flex-col gap-3 rounded-md border bg-raised p-4 transition-colors", added ? "border-ink/40" : "border-line hover:border-muted/40")}>
      <header className="flex items-start gap-3">
        <Monogram name={s.name} />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 font-semibold leading-5">
            <span className="truncate">{s.name}</span>
            <a href={safeUrl(s.careers_url)} target="_blank" rel="noreferrer" className="shrink-0 text-muted hover:text-ink" aria-label={`${s.name} careers page`}>
              <ExternalLink className="size-3.5" />
            </a>
          </p>
          <p className="truncate type-small text-muted">
            {[`Hiring system: ${ATS_LABEL[s.ats] ?? s.ats}`, s.open_jobs ? `${s.open_jobs.toLocaleString()} open jobs` : null, soon && "not supported yet"].filter(Boolean).join(" · ")}
          </p>
        </div>
        <FitLabel score={s.score} />
      </header>

      {like && <p className="rounded-md bg-inset px-2.5 py-1.5 type-small text-ink">{like}</p>}
      {headline && <p className="type-label text-ink">{headline}</p>}
      {s.examples[0] && (
        <p className="truncate type-small text-muted" title={s.examples.join("\n")}>
          e.g. {shortExample(s.examples[0])}
        </p>
      )}
      {chips.length > 0 && <p className="type-small text-muted">{chips.slice(0, open ? chips.length : 2).join(" · ")}</p>}
      {open && (
        <div className="space-y-1 rounded-md border border-line p-2.5 type-small text-muted">
          <p>
            Score <b className="tabular text-ink">{s.score}</b> / 100 from your roles, places, industries and topics.
          </p>
          {s.examples.length > 0 && (
            <ul className="list-inside list-disc">
              {s.examples.map((e) => (
                <li key={e} className="truncate">
                  {shortExample(e)}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <footer className="mt-auto flex items-center gap-1.5 pt-1">
        <AddButton added={added} onAdd={onAdd} onRemove={onRemove} soon={soon} name={s.name} />
        {onHide && !added && (
          <Button
            size="sm"
            variant="ghost"
            onClick={onHide}
            className="text-muted"
            aria-label={`Don't suggest ${s.name}`}
            title="Hides this company: no more suggestions, and its jobs leave your Radar"
          >
            <EyeOff className="size-3.5" /> Don't suggest
          </Button>
        )}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label={`Why ${s.name}?`}
          className="ml-auto inline-flex min-h-8 items-center gap-0.5 type-label text-muted hover:text-ink"
        >
          Why? <ChevronDown className={cx("size-3.5 transition-transform", open && "rotate-180")} />
        </button>
      </footer>
    </article>
  );
}

/** A card-shaped placeholder while suggestions load: the kit's shimmer bars (design/components/Loading), not a pulse. */
export function CardSkeleton() {
  return (
    <div className="flex flex-col gap-3 rounded-md border border-line p-4" aria-hidden>
      <div className="flex gap-3">
        <span className="rj-skel size-10" />
        <div className="flex-1 space-y-2 pt-1">
          <span className="rj-skel h-3 w-2/3" />
          <span className="rj-skel h-2.5 w-1/3" />
        </div>
      </div>
      <span className="rj-skel h-3 w-1/2" />
      <span className="rj-skel h-2.5 w-5/6" />
      <span className="rj-skel mt-2 h-8 w-24" />
    </div>
  );
}

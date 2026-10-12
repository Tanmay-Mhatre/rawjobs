import { companyLabel } from "@rawjobs/core/display-name";
import { safeUrl } from "@rawjobs/core/text";
import { ExternalLink, EyeOff } from "lucide-react";
import { SUPPORTED } from "../../lib/companies";
import { type CompanySuggestion, whereTheyHire } from "../../lib/companySuggest";
import { AddButton } from "../CompanyButtons";
import { Button, cx } from "../ui";

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

type Props = {
  s: CompanySuggestion;
  added: boolean;
  onAdd: () => void;
  onRemove: () => void;
  onHide?: () => void;
  /** What only this card says (why it's like your past employer); the group's header says the rest. */
  note?: string;
  /** What an added one says ("Watching" in Not hiring yet). */
  addedText?: string;
};

/**
 * One suggested company: its name, careers page and where it hires, then Add / Hide. Why it's here
 * sits once in its group's header. No role counts, example roles or fit labels: a company's jobs are
 * read on the Radar.
 */
export function SuggestionCard({ s, added, onAdd, onRemove, onHide, note, addedText }: Props) {
  const soon = !SUPPORTED.has(s.ats);
  const where = whereTheyHire(s.hires_in);
  const name = companyLabel(s);
  return (
    <article className={cx("flex min-w-0 flex-col gap-3 rounded-md border bg-raised p-4 transition-colors", added ? "border-ink/40" : "border-line hover:border-muted/40")}>
      <header className="flex items-start gap-3">
        <Monogram name={name} />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 font-semibold leading-5">
            <span className="truncate">{name}</span>
            <a href={safeUrl(s.careers_url)} target="_blank" rel="noreferrer" className="shrink-0 text-muted hover:text-ink" aria-label={`${name} careers page`}>
              <ExternalLink className="size-3.5" />
            </a>
          </p>
          {(soon || where) && <p className="type-small text-muted">{soon ? "Not supported yet" : where}</p>}
        </div>
      </header>

      {note && <p className="type-small text-muted">{note}</p>}

      <footer className="mt-auto flex items-center gap-1.5 pt-1">
        <AddButton added={added} onAdd={onAdd} onRemove={onRemove} soon={soon} name={name} addedText={addedText} />
        {onHide && !added && (
          <Button size="sm" variant="ghost" onClick={onHide} className="text-muted" aria-label={`Hide ${name}`} title="No more suggestions, and its jobs leave your Radar">
            <EyeOff className="size-3.5" /> Hide
          </Button>
        )}
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

import { Link2, Search, X } from "lucide-react";
import type { ReactNode } from "react";
import { roughCount } from "../../lib/format";
import { Button, cx } from "../ui";

type Props = {
  /** The page's one search: your own companies on My companies, the directory elsewhere. */
  q: string;
  onQ: (q: string) => void;
  /** Companies in the directory (countCompanies), once loaded. */
  count?: number;
  /** Says what the search covers when it isn't the directory ("Search your 91 companies"). */
  placeholder?: string;
  /** "Add by link" panel state, and the id of that panel. */
  linkOpen: boolean;
  onToggleLink: () => void;
  linkPanelId: string;
  /** Right side of the header (the save status). */
  status?: ReactNode;
};

/**
 * The Companies page header: one search and one "Add by link" button. On My companies the search filters
 * your own list in place; elsewhere it searches the whole directory, in Browse all.
 */
export function QuickAdd({ q, onQ, count, placeholder, linkOpen, onToggleLink, linkPanelId, status }: Props) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <p className="type-small text-muted">Companies you add are checked on every scan and their jobs come first on your Radar.</p>
        {status}
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        {/* biome-ignore lint/a11y/useSemanticElements: an ARIA role on purpose: the native element (fieldset, output, input, hr, ul) would change layout or behaviour here */}
        <div role="search" className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-3 size-4 text-muted" aria-hidden />
          <input
            type="search"
            value={q}
            onChange={(e) => onQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Escape" || !q) return;
              e.preventDefault();
              onQ("");
            }}
            placeholder={placeholder ?? (count ? `Search ${roughCount(count)} companies…` : "Search companies…")}
            aria-label="Search companies"
            className="h-11 w-full rounded-md border border-line bg-raised pl-9 pr-10 type-small placeholder:text-muted [&::-webkit-search-cancel-button]:hidden"
          />
          {q && (
            <button
              type="button"
              aria-label="Clear search"
              title="Clear search"
              className="absolute right-1.5 top-1.5 inline-flex size-8 items-center justify-center rounded-md text-muted hover:bg-inset hover:text-ink"
              onClick={() => onQ("")}
            >
              <X className="size-4" />
            </button>
          )}
        </div>
        <Button className={cx("h-11 shrink-0", linkOpen && "border-ink bg-active text-ink")} onClick={onToggleLink} aria-expanded={linkOpen} aria-controls={linkPanelId}>
          <Link2 className="size-4" /> Add by link
        </Button>
      </div>
    </div>
  );
}

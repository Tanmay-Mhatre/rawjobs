import { INDUSTRIES, INDUSTRY_GROUPS } from "@rawjobs/core/catalog/industries";
import { isPlaceholderBoard, safeUrl } from "@rawjobs/core/text";
import { ChevronDown, CloudDownload, ExternalLink, Link2, LoaderCircle, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { ATS_LABEL, groupBoards, SUPPORTED, type CompanyRef } from "../lib/companies";
import { companyIndex, companyMatches, type CompanyIndex } from "../lib/companySearch";
import { canRunLocally } from "../lib/data";
import { DirectoryBar, updateDirectory } from "./DirectoryBar";
import { AddButton } from "./CompanyButtons";
import { FitLabel } from "./companies/SuggestionCard";
import { Button, cx, Pagination, Segmented, Select } from "./ui";

/** Directory entry served at data/catalog/directory.json (see scripts/catalog/publish.ts). */
export type DirCompany = CompanyRef & {
  key: string;
  tier: "curated" | "dump";
  /** unverified: a seed company on a hiring system RawJobs can't check yet. */
  status: "live" | "dormant" | "unverified";
  open_jobs: number | null;
  indexed: boolean;
  tags?: string[];
  title_tags?: string[];
  /** Found by you with "Add by link", or from the industry seed list. */
  origin?: "user" | "seed";
};

const BROWSE_PAGE = 25;

type Props = {
  /** Keys of the companies in your list (saved or not yet). */
  watched: Set<string>;
  /** Jobs for you right now per company key (from the Radar). */
  forYou: ReadonlyMap<string, number>;
  /** The directory, once loaded (shared with the rest of the page). */
  directory: DirCompany[] | null;
  directoryError: string | null;
  onAddMany: (list: CompanyRef[]) => string[];
  onRemove: (key: string) => void;
  /** Reload the directory (after an update, or to retry a failed load). */
  onDirectoryUpdated: () => void;
  /** Fit score per company key, from the suggestions (when worked out). */
  fit?: ReadonlyMap<string, number>;
  /** Your industries, offered first in the industry filter. */
  industries?: string[];
  /** The search from the page header (the page has one search box). */
  q: string;
  /** Open "Add by link" (for a company the directory doesn't have). */
  onAddByLink: () => void;
  /** The page's one company count (countCompanies), for the directory bar. */
  companyCount?: number;
};

/** Browse all: the whole directory, filtered by the header search, industry, hiring system or jobs for you. */
export function CompanyFinder({ watched, forYou, directory, directoryError, onAddMany, onRemove, onDirectoryUpdated, fit, industries, q, onAddByLink, companyCount }: Props) {
  return (
    <div className="space-y-4">
      <DirectoryBar onUpdated={onDirectoryUpdated} companies={companyCount} />
      <Browse
        all={directory}
        error={directoryError}
        forYou={forYou}
        fit={fit}
        mine={industries ?? []}
        watched={watched}
        onAdd={(c) => void onAddMany([c])}
        onRemove={onRemove}
        q={q}
        onAddByLink={onAddByLink}
        onReload={onDirectoryUpdated}
      />
    </div>
  );
}

// ---------- search the whole directory ----------

/**
 * Directory search, one row per company (its other careers pages fold under it). Browsing lists companies
 * with open jobs; a search finds any, and yours always show. The search forgives typos (companyMatches):
 * exact and starts-with names first, then close spellings; within each, companies hiring for you now,
 * then the best fit for your profile, then the biggest. Sandbox and test boards never show (unless one
 * is already in My companies).
 */
export function searchDirectory(
  all: readonly DirCompany[],
  o: {
    q: string;
    watched: ReadonlySet<string>;
    forYou: ReadonlyMap<string, number>;
    fit?: ReadonlyMap<string, number>;
    system?: "all" | "supported" | "soon";
    onlyForYou?: boolean;
    industry?: string;
    /** The directory's search index (companyIndex); built here when not given. */
    index?: CompanyIndex<DirCompany>;
  },
) {
  const s = o.q.trim().toLowerCase();
  const matches = s ? companyMatches(o.index ?? companyIndex(all), s) : undefined;
  const rank = (c: DirCompany) => matches?.get(c) ?? 0;
  const jobsFor = (c: DirCompany) => o.forYou.get(c.key) ?? 0;
  const system = o.system ?? "all";
  const sorted = all
    .filter((c) => o.watched.has(c.key) || !isPlaceholderBoard(c.name))
    .filter((c) => c.status === "live" || !!s || o.watched.has(c.key))
    .filter((c) => system === "all" || (system === "supported") === SUPPORTED.has(c.ats))
    .filter((c) => !o.onlyForYou || jobsFor(c) > 0)
    .filter((c) => !o.industry || !!c.tags?.includes(o.industry) || !!c.title_tags?.includes(o.industry))
    .filter((c) => !matches || matches.has(c))
    .sort(
      (a, b) =>
        rank(a) - rank(b) ||
        jobsFor(b) - jobsFor(a) ||
        (o.fit?.get(b.key) ?? 0) - (o.fit?.get(a.key) ?? 0) ||
        (b.open_jobs ?? 0) - (a.open_jobs ?? 0),
    );
  return groupBoards(sorted, new Set(o.watched));
}

/** The directory couldn't load: say so, and offer the fix (download it) and a retry. */
function DirectoryMissing({ onReload }: { onReload: () => void }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  return (
    <div role="alert" className="space-y-2 rounded-md bg-warning-subtle/50 p-4 type-small">
      <p className="font-medium">The company directory isn't available yet.</p>
      <p className="text-muted">
        {canRunLocally ? "It hasn't been downloaded to this computer. Download it to browse and search every company." : "It couldn't be loaded. Check your connection and try again."}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {canRunLocally && (
          <Button
            size="sm"
            variant="primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setNote(null);
              const r = await updateDirectory();
              setBusy(false);
              if (r.ok) onReload();
              else setNote(r.text);
            }}
          >
            {busy ? <LoaderCircle className="size-3.5 animate-spin" /> : <CloudDownload className="size-3.5" />} {busy ? "Updating…" : "Update directory"}
          </Button>
        )}
        <Button size="sm" onClick={onReload} disabled={busy}>
          <RefreshCw className="size-3.5" /> Try again
        </Button>
      </div>
      {note && <p className="type-small text-danger-text">{note}</p>}
    </div>
  );
}

function Browse({
  all,
  error,
  forYou,
  fit,
  mine,
  watched,
  onAdd,
  onRemove,
  q,
  onAddByLink,
  onReload,
}: {
  all: DirCompany[] | null;
  error: string | null;
  forYou: ReadonlyMap<string, number>;
  fit?: ReadonlyMap<string, number>;
  mine: string[];
  watched: Set<string>;
  onAdd: (c: DirCompany) => void;
  onRemove: (key: string) => void;
  q: string;
  onAddByLink: () => void;
  onReload: () => void;
}) {
  const [onlyForYou, setOnlyForYou] = useState(false);
  const [system, setSystem] = useState<"all" | "supported" | "soon">("all");
  const [industry, setIndustry] = useState("");
  const [page, setPage] = useState(1);
  const top = useRef<HTMLDivElement>(null);
  const jobsFor = (c: DirCompany) => forYou.get(c.key) ?? 0;

  const index = useMemo(() => (all ? companyIndex(all) : undefined), [all]);
  const results = useMemo(
    () => (all ? searchDirectory(all, { q, watched, forYou, fit, system, onlyForYou, industry, index }) : []),
    [all, index, q, onlyForYou, system, industry, watched, forYou, fit],
  );

  // Back to page 1 whenever the search or filters change.
  useEffect(() => setPage(1), [q, onlyForYou, system, industry]);
  const goTo = (p: number) => {
    setPage(p);
    top.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  };

  if (error) return <DirectoryMissing onReload={onReload} />;
  if (!all)
    return (
      <p role="status" className="flex items-center gap-2 py-6 type-small text-muted">
        <LoaderCircle className="size-4 animate-spin" /> Loading the directory…
      </p>
    );

  const hiring = all.filter((c) => jobsFor(c) > 0).length;
  const pageItems = results.slice((page - 1) * BROWSE_PAGE, page * BROWSE_PAGE);
  const from = (page - 1) * BROWSE_PAGE + 1;
  const to = Math.min(results.length, page * BROWSE_PAGE);
  const term = q.trim();

  return (
    <div className="space-y-3">
      <div ref={top} className="flex scroll-mt-20 flex-wrap items-center gap-2">
        <Segmented
          label="Hiring system"
          value={system}
          onChange={setSystem}
          options={[
            { value: "all", label: "All" },
            { value: "supported", label: "Can scan now" },
            { value: "soon", label: "Not supported yet" },
          ]}
        />
        <Select value={industry} onChange={(e) => setIndustry(e.target.value)} aria-label="Industry">
          <option value="">All industries</option>
          {mine.length > 0 && (
            <optgroup label="Your industries">
              {INDUSTRIES.filter((i) => mine.includes(i.id)).map((i) => (
                <option key={i.id} value={i.id}>
                  {i.label}
                </option>
              ))}
            </optgroup>
          )}
          {INDUSTRY_GROUPS.map((g) => (
            <optgroup key={g.id} label={g.label}>
              {INDUSTRIES.filter((i) => i.group === g.id && !mine.includes(i.id)).map((i) => (
                <option key={i.id} value={i.id}>
                  {i.label}
                </option>
              ))}
            </optgroup>
          ))}
        </Select>
        {hiring > 0 && (
          <label className="inline-flex items-center gap-2 type-small text-muted">
            <input type="checkbox" checked={onlyForYou} onChange={(e) => setOnlyForYou(e.target.checked)} className="size-4 accent-ink" />
            Only companies with jobs for you ({hiring.toLocaleString()})
          </label>
        )}
      </div>
      {/* Filtered counts stay exact, and say what they count (the directory size is the rounded-md one). */}
      <p role="status" className="tabular type-meta text-muted">
        {results.length === 0
          ? "No matching companies"
          : `Showing ${from.toLocaleString()}–${to.toLocaleString()} of ${results.length.toLocaleString()} matching ${results.length === 1 ? "company" : "companies"}${term ? ` for “${term}”` : ""}`}
      </p>
      <ul className="divide-y divide-line rounded-md border border-line">
        {pageItems.map((g) => (
          <BrowseRow
            key={g.lead.key}
            lead={g.lead}
            others={g.others}
            jobsFor={jobsFor}
            fitFor={(c) => fit?.get(c.key)}
            watched={watched}
            onAdd={onAdd}
            onRemove={onRemove}
          />
        ))}
        {results.length === 0 && (
          <li className="space-y-3 px-3 py-6 text-center type-small text-muted">
            <p>{term ? <>No company matches “{term}”. If you know its careers page, add it by link.</> : "No company matches these filters."}</p>
            {term ? (
              <Button size="sm" onClick={onAddByLink}>
                <Link2 className="size-3.5" /> Add by link
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={() => {
                  setSystem("all");
                  setIndustry("");
                  setOnlyForYou(false);
                }}
              >
                Clear filters
              </Button>
            )}
          </li>
        )}
      </ul>
      {results.length > BROWSE_PAGE && <Pagination page={page} pageSize={BROWSE_PAGE} total={results.length} onPage={goTo} />}
    </div>
  );
}

export type LineProps = {
  watched: Set<string>;
  jobsFor: (c: DirCompany) => number;
  fitFor: (c: DirCompany) => number | undefined;
  onAdd: (c: DirCompany) => void;
  onRemove: (key: string) => void;
};

function BoardLine({ c, watched, jobsFor, fitFor, onAdd, onRemove, sub }: LineProps & { c: DirCompany; sub?: boolean }) {
  const soon = !SUPPORTED.has(c.ats);
  const mine = jobsFor(c);
  const score = fitFor(c);
  return (
    <div className={cx("flex items-center gap-3", sub && "pl-4")}>
      <div className="min-w-0 flex-1">
        <p className={cx("flex items-center gap-1.5 type-small", sub ? "text-muted" : "font-semibold")}>
          <span className="truncate">{sub ? `${c.name} on ${ATS_LABEL[c.ats] ?? c.ats}` : c.name}</span>
          {score !== undefined && score >= 45 && <FitLabel score={score} className="font-normal" />}
          <a href={safeUrl(c.careers_url)} target="_blank" rel="noreferrer" className="shrink-0 text-muted hover:text-ink" aria-label={`${c.name} careers page`}>
            <ExternalLink className="size-3.5" />
          </a>
        </p>
        <p className="type-small text-muted">
          {mine > 0 && <span className="font-semibold text-ink">{mine === 1 ? "1 job for you · " : `${mine} jobs for you · `}</span>}
          {[
            !sub && `Hiring system: ${ATS_LABEL[c.ats] ?? c.ats}`,
            c.open_jobs ? `${c.open_jobs.toLocaleString()} open jobs` : c.status === "dormant" ? "no open jobs right now" : c.status === "unverified" ? "not checked yet" : null,
            c.origin === "user" && "added by you",
            soon && "not supported yet",
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>
      <AddButton added={watched.has(c.key)} onAdd={() => onAdd(c)} onRemove={() => onRemove(c.key)} soon={soon} name={c.name} />
    </div>
  );
}

/** A company and, folded under it, its other live careers pages (or ones in My companies). */
export function BrowseRow({ lead, others, ...line }: LineProps & { lead: DirCompany; others: DirCompany[] }) {
  const [open, setOpen] = useState(() => others.some((o) => line.watched.has(o.key)));
  return (
    <li className="space-y-2 px-3 py-2.5">
      <BoardLine c={lead} {...line} />
      {others.length > 0 && (
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="inline-flex items-center gap-1 type-label text-ink hover:text-muted">
          <ChevronDown className={cx("size-3.5 transition-transform", !open && "-rotate-90")} />
          {others.length} other careers page{others.length === 1 ? "" : "s"}
        </button>
      )}
      {open && others.map((o) => <BoardLine key={o.key} c={o} sub {...line} />)}
    </li>
  );
}

/** Load the directory (data/catalog/directory.json, plus companies added by link since the last publish). */
export function useDirectory(rev: number): { directory: DirCompany[] | null; error: string | null } {
  const [directory, setDirectory] = useState<DirCompany[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const get = (path: string) => fetch(path, { cache: "no-store" }).then((r) => (r.ok ? (r.json() as Promise<{ companies: DirCompany[] }>) : null));
    let live = true;
    setError(null);
    setDirectory(null);
    Promise.all([get("./catalog/directory.json"), get("./catalog/additions.json").catch(() => null)])
      .then(([dir, adds]) => {
        if (!dir) throw new Error("no directory");
        const known = new Set(dir.companies.map((c) => c.key));
        const extra = (adds?.companies ?? []).filter((c) => !known.has(c.key)).map((c): DirCompany => ({ ...c, tier: "dump", indexed: false, origin: "user" }));
        if (live) setDirectory([...dir.companies, ...extra]);
      })
      .catch(() => live && setError("The company directory isn't downloaded yet."));
    return () => {
      live = false;
    };
  }, [rev]);
  return { directory, error };
}

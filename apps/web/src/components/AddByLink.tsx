import { safeUrl } from "@rawjobs/core/text";
import { CircleAlert, ExternalLink, HelpCircle, Link2, LoaderCircle, MapPin, X } from "lucide-react";
import { useId, useState } from "react";
import { ATS_LABEL, keyOf, SUPPORTED, type CompanyRef } from "../lib/companies";
import { displayPlace } from "../lib/format";
import { checkCompanies, type CompanyCheck } from "../lib/setup";
import { AddAll, AddButton } from "./CompanyButtons";
import { Status } from "./primitives";
import { Button, cx } from "./ui";

type Result = CompanyCheck & { id: string };

let seq = 0;

/** A check result My companies can take: a real careers page, or a recognised "not supported yet" one with what it needs. */
const addable = (r: CompanyCheck) =>
  !!r.ats && !!r.slug && (r.status === "live" || r.status === "dormant" || (r.status === "soon" && (r.ats !== "workday" || !!r.site)));

const toRef = (r: CompanyCheck, name: string): CompanyRef => ({
  name: name.trim() || r.name || r.slug!,
  ats: r.ats!,
  slug: r.slug!,
  ...(r.region && r.region !== "global" ? { region: r.region } : {}),
  ...(r.shard ? { shard: r.shard } : {}), ...(r.site ? { site: r.site } : {}),
  careers_url: r.careers_url ?? r.input,
});

/** What a careers link looks like, shown with every "not recognised" result. */
const FORMATS = "Paste the link to the company's jobs page, e.g. jobs.lever.co/acme or boards.greenhouse.io/acme.";

/**
 * Paste careers links, see what each one is (the same details as the company directory, plus how
 * many jobs match you), then choose which to add to My companies. New careers pages are remembered in the directory.
 */
export function AddByLink({
  watched,
  onAddMany,
  onRemove,
  autoFocus,
}: {
  watched: Set<string>;
  onAddMany: (c: CompanyRef[]) => string[];
  onRemove: (key: string) => void;
  autoFocus?: boolean;
}) {
  const helpId = useId();
  const [text, setText] = useState("");
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [results, setResults] = useState<Result[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});

  const check = async (only?: string[]) => {
    const urls = only ?? [...new Set(text.split(/[\n\s,]+/).map((s) => s.trim()).filter(Boolean))];
    if (!urls.length) return;
    setChecking(true);
    setError(null);
    try {
      const found = await checkCompanies(urls);
      // Newest first; a link checked again replaces its old card.
      setResults((prev) => {
        const fresh = found.map((r) => ({ ...r, id: `c${seq++}` }));
        const keys = new Set(fresh.map((r) => r.key ?? r.input));
        return [...fresh, ...prev.filter((r) => !keys.has(r.key ?? r.input))];
      });
      if (!only) setText("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setChecking(false);
    }
  };

  const nameOf = (r: Result) => names[r.id] ?? r.name ?? "";
  const refs = results.filter(addable).map((r) => toRef(r, nameOf(r)));

  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <label htmlFor="careers-links" className="block type-small font-semibold">
          Paste careers page links
        </label>
        <textarea
          id="careers-links"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => (e.metaKey || e.ctrlKey) && e.key === "Enter" && void check()}
          rows={3}
          autoFocus={autoFocus}
          aria-describedby={`${helpId}-hint`}
          placeholder={"https://jobs.lever.co/company\nhttps://job-boards.greenhouse.io/another"}
          className="w-full resize-y rounded-md border border-line bg-raised p-3 font-mono type-small placeholder:text-muted"
        />
        <p id={`${helpId}-hint`} className="type-small text-muted">
          {FORMATS} One link per line.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary" onClick={() => void check()} disabled={!text.trim() || checking}>
            {checking ? <LoaderCircle className="size-4 animate-spin" /> : <Link2 className="size-4" />}
            {checking ? "Scanning…" : "Scan links"}
          </Button>
          <button
            type="button"
            className="inline-flex min-h-8 items-center gap-1 type-label text-ink underline underline-offset-2 hover:text-muted"
            onClick={() => setShowHelp((v) => !v)}
            aria-expanded={showHelp}
            aria-controls={helpId}
          >
            <HelpCircle className="size-4" /> Where do I find this link?
          </button>
        </div>
        {error && (
          <div role="alert" className="type-small text-danger-text">
            <p>
              Couldn't scan these links. Check your connection and{" "}
              <button type="button" className="font-medium underline" onClick={() => void check()}>
                try again
              </button>
              .
            </p>
            <details className="mt-1 type-meta text-muted">
              <summary className="cursor-pointer">Technical details</summary>
              {error}
            </details>
          </div>
        )}
        <p className="type-small text-muted">Supported hiring systems: {[...SUPPORTED].map((a) => ATS_LABEL[a] ?? a).join(", ")}</p>
        {showHelp && (
          <div id={helpId} className="rounded-md bg-inset p-3 type-small">
            <p>Open the company's careers page and click any job. If the address looks like one of these, paste it (anything after the company name is fine):</p>
            <ul className="mt-2 space-y-1 font-mono type-small text-muted">
              <li>job-boards.greenhouse.io/<b className="text-ink">company</b></li>
              <li>jobs.lever.co/<b className="text-ink">company</b></li>
              <li>jobs.ashbyhq.com/<b className="text-ink">company</b></li>
              <li>careers.smartrecruiters.com/<b className="text-ink">Company</b></li>
              <li>
                <b className="text-ink">company</b>.wd3.myworkdayjobs.com/en-US/<b className="text-ink">Site</b>
              </li>
              <li>apply.workable.com/<b className="text-ink">company</b></li>
              <li>
                <b className="text-ink">company</b>.recruitee.com, .bamboohr.com, .breezy.hr, .teamtailor.com, .jobs.personio.com
              </li>
              <li>
                <b className="text-ink">pod</b>.fa.<b className="text-ink">dc</b>.oraclecloud.com/hcmUI/CandidateExperience/en/sites/<b className="text-ink">CX_1</b>
              </li>
              <li>
                <b className="text-ink">host</b>.taleo.net/careersection/<b className="text-ink">section</b>/jobsearch.ftl
              </li>
            </ul>
          </div>
        )}
      </div>

      {results.length > 0 && (
        <section>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h3 className="type-small font-semibold">
              Checked links <span className="tabular font-normal text-muted">({results.length})</span>
            </h3>
            <div className="flex items-center gap-2">
              {refs.length > 1 && <AddAll items={refs} watched={watched} onAddMany={onAddMany} onRemoveMany={(keys) => keys.forEach(onRemove)} />}
              <Button size="sm" variant="ghost" onClick={() => setResults([])}>
                Clear
              </Button>
            </div>
          </div>
          <ul className="grid gap-3 lg:grid-cols-2">
            {results.map((r) => (
              <ResultCard
                key={r.id}
                r={r}
                name={nameOf(r)}
                onName={(n) => setNames((m) => ({ ...m, [r.id]: n }))}
                added={!!r.key && watched.has(keyOf(r))}
                onAdd={() => onAddMany([toRef(r, nameOf(r))])}
                onRemove={() => onRemove(keyOf(r))}
                onDismiss={() => setResults((list) => list.filter((x) => x.id !== r.id))}
                onRetry={() => void check([r.input])}
                onHelp={() => {
                  setShowHelp(true);
                  setTimeout(() => document.getElementById(helpId)?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 50);
                }}
              />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function ResultCard({
  r,
  name,
  onName,
  added,
  onAdd,
  onRemove,
  onDismiss,
  onRetry,
  onHelp,
}: {
  r: Result;
  name: string;
  onName: (n: string) => void;
  added: boolean;
  onAdd: () => void;
  onRemove: () => void;
  onDismiss: () => void;
  onRetry: () => void;
  onHelp: () => void;
}) {
  const ok = addable(r);
  const places = r.top_locations ?? [];
  // Board health as Status (shape + color + word); everything else is plain text with " · " between.
  const status =
    r.status === "live" ? (
      <Status state="healthy" />
    ) : r.status === "dormant" ? (
      <Status state="dormant" />
    ) : r.status === "soon" ? (
      <span className="text-muted">Not supported yet</span>
    ) : r.status === "unknown" ? (
      <span className="inline-flex items-center gap-1.5 text-danger-text">
        <CircleAlert className="size-4 shrink-0" aria-hidden /> This isn't a careers link RawJobs recognises
      </span>
    ) : (
      <Status state="broken" label="Couldn't open this careers page" />
    );
  const facts = [
    r.status === "live" && `${r.open_jobs?.toLocaleString()} open job${r.open_jobs === 1 ? "" : "s"}`,
    r.status === "dormant" && "No openings right now",
    r.matches !== undefined && r.matches > 0 && (r.matches === 1 ? "1 role matches you" : `${r.matches} roles match you`),
    ok && (r.in_directory ? "In the company directory" : r.status !== "soon" && "New: added to the directory"),
  ].filter(Boolean);

  return (
    <li className={cx("flex min-w-0 flex-col gap-2 rounded-md border p-3", added ? "border-ink/40 bg-inset" : ok ? "border-line" : "border-danger/40")}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          {ok && !added ? (
            <input
              value={name}
              onChange={(e) => onName(e.target.value)}
              aria-label="Company name"
              title="Edit the name if it's wrong"
              className="-ml-1.5 h-8 w-full max-w-72 rounded-md border border-transparent bg-transparent px-1.5 font-semibold hover:border-line"
            />
          ) : (
            <p className={cx("truncate font-semibold", !ok && "font-mono type-small")}>{ok ? name : r.input}</p>
          )}
          {r.ats && (
            <p className="flex min-w-0 items-center gap-1 type-small text-muted">
              <span className="shrink-0">Hiring system: {ATS_LABEL[r.ats] ?? r.ats}</span>
              {ok && r.careers_url && (
                <>
                  <span>·</span>
                  <a href={safeUrl(r.careers_url)} target="_blank" rel="noreferrer" className="inline-flex min-w-0 items-center gap-1 hover:text-ink">
                    <span className="truncate">{r.careers_url.replace(/^https:\/\//, "")}</span>
                    <ExternalLink className="size-3 shrink-0" />
                  </a>
                </>
              )}
            </p>
          )}
        </div>
        {ok && <AddButton added={added} onAdd={onAdd} onRemove={onRemove} soon={!SUPPORTED.has(r.ats!)} name={name} />}
        <button type="button" onClick={onDismiss} aria-label="Dismiss" title="Dismiss" className="rounded-md p-1.5 text-muted hover:text-ink">
          <X className="size-4" />
        </button>
      </div>

      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 type-small">
        {status}
        {facts.length > 0 && <span className="text-muted">{facts.map((f) => `· ${f}`).join(" ")}</span>}
      </p>

      {places.length > 0 && (
        <p className="flex items-center gap-1 type-small text-muted" title={places.join("; ")}>
          <MapPin className="size-3 shrink-0" />
          <span className="min-w-0 truncate">{places.slice(0, 2).map(displayPlace).join(", ")}</span>
          {places.length > 2 && <span className="shrink-0">+{places.length - 2}</span>}
        </p>
      )}
      {r.match_examples && r.match_examples.length > 0 ? (
        <ul className="space-y-0.5 type-small">
          {r.match_examples.map((e) => (
            <li key={e} className="truncate">
              • {e}
            </li>
          ))}
        </ul>
      ) : (
        r.sample_titles &&
        r.sample_titles.length > 0 && (
          <p className="truncate type-small text-muted">
            {r.matches === 0 ? "Nothing matching you today. Roles there now: " : "Roles there now: "}
            {r.sample_titles.join(", ")}
          </p>
        )
      )}
      {r.status === "dormant" && <p className="type-small text-muted">The careers page exists but has no openings. Add it and you'll see its jobs as soon as one appears.</p>}
      {r.status === "soon" && r.ats && (
        <p className="type-small text-muted">{ATS_LABEL[r.ats] ?? "This hiring system"} isn't supported yet. Add it now and it's scanned once support ships.</p>
      )}
      {!ok && r.status !== "soon" && (
        <div className="space-y-1.5 type-small text-muted">
          <p>
            {r.status === "unknown"
              ? FORMATS
              : "The page didn't answer, or the company name in the link is wrong. Open the link in your browser to check it, then try again."}
          </p>
          <div className="flex flex-wrap items-center gap-3">
            {r.status !== "unknown" && (
              <button type="button" className="min-h-8 font-medium text-ink underline underline-offset-2 hover:text-muted" onClick={onRetry}>
                Try again
              </button>
            )}
            <button type="button" className="inline-flex min-h-8 items-center gap-1 font-medium text-ink underline underline-offset-2 hover:text-muted" onClick={onHelp}>
              <HelpCircle className="size-3.5" /> Where do I find this link?
            </button>
          </div>
        </div>
      )}
      {r.error && (
        <details className="type-meta text-muted">
          <summary className="cursor-pointer">Technical details</summary>
          {r.error}
        </details>
      )}
    </li>
  );
}

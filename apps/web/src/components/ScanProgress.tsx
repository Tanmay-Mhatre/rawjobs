import { CircleAlert, CircleCheck, Clock, LoaderCircle, RefreshCw } from "lucide-react";
import { FAILING_HASH } from "../lib/companies";
import { atsLabel } from "../lib/filters";
import { progressRows, scanLine, type ScanState } from "../lib/scan";
import { SourceTag } from "./primitives";
import { Button, cx } from "./ui";

/** Rows listed under the progress bars: your companies, then directory ones that matched or failed. */
const MAX_ROWS = 60;

const toFailing = () => {
  location.hash = FAILING_HASH;
};

/** "Already up to date." from the directory update, in plain words. */
const syncLine = (sync: string) => (/already up to date/i.test(sync) ? "Company directory is up to date." : `Company directory: ${sync}`);

/** Live list of companies being scanned, then a one-line result. `onRetry` adds "Try again" to a failed scan. */
export function ScanProgress({ scan, onRetry }: { scan: ScanState; onRetry?: () => void }) {
  const s = scan.summary;
  const yours = new Set(scan.companies);
  const rows = [...scan.companies, ...Object.keys(scan.results).filter((n) => !yours.has(n))].slice(0, MAX_ROWS);
  const bars = progressRows(scan);
  return (
    <div className="space-y-3">
      {scan.phase === "running" && (
        <div className="space-y-3">
          <p className="type-small font-medium" role="status">
            {scanLine(scan)}
          </p>
          {bars.length > 0 && (
            // biome-ignore lint/a11y/useSemanticElements: an ARIA role on purpose: the native element (fieldset, output, input, hr, ul) would change layout or behaviour here
            <div className="rj-progress" role="group" aria-label="Scan progress">
              {bars.map((b) => (
                <div key={b.ats || "all"} className="rj-progress__row">
                  <SourceTag source={b.ats ? atsLabel(b.ats) : "All companies"} className="min-w-0 truncate" />
                  <span className="rj-progress__track">
                    <span className="rj-progress__fill" style={{ transform: `scaleX(${b.total ? b.done / b.total : 0})` }} />
                  </span>
                  <span className="rj-progress__count">
                    {b.done.toLocaleString()} / {b.total.toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {s && (
        <p className="rounded-md bg-inset p-3 type-small" role="status">
          Scanned <b className="tabular font-semibold text-ink">{s.jobsFound.toLocaleString()}</b> jobs and found <b className="tabular font-semibold text-ink">{s.matches}</b> match
          {s.matches === 1 ? "" : "es"}
          {s.strong > 0 && (
            <>
              , <b className="tabular font-semibold text-ink">{s.strong} strong</b>
            </>
          )}
          .
          {s.failed > 0 && (
            <>
              {" "}
              <span className="text-danger-text">
                {s.failed} compan{s.failed === 1 ? "y" : "ies"} couldn't be scanned
              </span>
              , usually because the careers page moved.{" "}
              <button type="button" className="font-medium text-ink underline underline-offset-2 hover:text-muted" onClick={toFailing}>
                Review failing companies
              </button>
            </>
          )}
          {s.stopped && <span className="text-muted"> Stopped early: the next scan of this type carries on where it stopped.</span>}
        </p>
      )}
      {s?.moves?.map((m) => (
        <p key={m.name} className="rounded-md bg-inset p-3 type-small">
          <b>{m.name}</b>'s careers page is gone. We may have found the new one: check it in{" "}
          <button type="button" className="font-medium text-ink underline underline-offset-2 hover:text-muted" onClick={toFailing}>
            My companies
          </button>
          .
        </p>
      ))}
      {scan.sync && scan.phase !== "running" && <p className="type-small text-muted">{syncLine(scan.sync)}</p>}
      {scan.feed && scan.phase !== "running" && <p className="type-small text-muted">{scan.feed}</p>}
      {scan.error && (
        <div className="rounded-md bg-danger-subtle/50 p-3 type-small" role="alert">
          <p className="font-medium text-danger-text">The scan stopped before it finished.</p>
          <p className="mt-0.5 text-muted">Check your internet connection and try again. If it keeps happening, restart RawJobs and scan again.</p>
          {onRetry && (
            <Button size="sm" className="mt-2" onClick={onRetry}>
              <RefreshCw className="size-3.5" /> Try again
            </Button>
          )}
          <details className="mt-2 type-meta text-muted">
            <summary className="cursor-pointer">Technical details</summary>
            <pre className="mt-1 whitespace-pre-wrap font-mono">{scan.error}</pre>
          </details>
        </div>
      )}
      {rows.length > 0 && (
        <ul className="max-h-72 divide-y divide-line overflow-y-auto rounded-md border border-line type-small">
          {rows.map((name) => {
            const h = scan.results[name];
            return (
              <li key={name} className="flex items-center gap-2.5 px-3 py-2">
                {!h ? (
                  scan.phase === "running" ? (
                    <LoaderCircle className="size-4 shrink-0 animate-spin text-muted" />
                  ) : (
                    <Clock className="size-4 shrink-0 text-muted" />
                  )
                ) : h.ok ? (
                  <CircleCheck className="size-4 shrink-0 text-success-text" />
                ) : h.unsupported ? (
                  <Clock className="size-4 shrink-0 text-warning-text" />
                ) : (
                  <CircleAlert className="size-4 shrink-0 text-danger-text" />
                )}
                <span className="min-w-0 flex-1 truncate font-medium">{name}</span>
                <span className={cx("tabular shrink-0", h && !h.ok && !h.unsupported ? "text-danger-text" : "text-muted")}>
                  {!h ? "" : h.ok ? `${h.jobsFound} jobs · ${h.matches} match${h.matches === 1 ? "" : "es"}` : h.unsupported ? "not supported yet" : "couldn't scan"}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

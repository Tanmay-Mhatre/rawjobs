import { Info, LoaderCircle, RefreshCw } from "lucide-react";
import { useState } from "react";
import { timeAgo } from "../../lib/format";
import { INDEX_MAX_AGE_DAYS } from "../../lib/filters";
import { Button } from "../primitives";

/** A job from the company directory nobody has scanned yet: what that means, and "Scan this company" to get the real job. */
export function NotCheckedYet({ indexGeneratedAt, onCheck }: { indexGeneratedAt?: string; onCheck?: () => Promise<string | null> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const check = async () => {
    if (!onCheck) return;
    setBusy(true);
    setError(await onCheck());
    setBusy(false);
  };
  return (
    <section className="rounded-md border border-line bg-inset p-3 type-small">
      <p className="flex items-start gap-2">
        <Info className="mt-0.5 size-4 shrink-0 text-muted" />
        <span className="min-w-0">
          <b>Not scanned yet.</b>{" "}
          <span className="text-muted">
            This job comes from the company directory{indexGeneratedAt ? ` (updated ${timeAgo(indexGeneratedAt)})` : ""}. The score is an estimate from the title, place and date only: topics need the
            description. The link opens the company's careers page. Scans cover the best of these companies a few at a time; unscanned jobs older than {INDEX_MAX_AGE_DAYS} days are hidden unless you
            ask for them.
          </span>
        </span>
      </p>
      {onCheck && (
        <div className="mt-2 flex flex-wrap items-center gap-2 pl-6">
          <Button size="sm" icon={busy ? <LoaderCircle className="rj-icon animate-spin" /> : <RefreshCw className="rj-icon" />} onClick={() => void check()} disabled={busy}>
            {busy ? "Scanning…" : "Scan this company"}
          </Button>
          {error && (
            <span role="alert" className="type-small text-danger-text">
              {error}
            </span>
          )}
        </div>
      )}
    </section>
  );
}

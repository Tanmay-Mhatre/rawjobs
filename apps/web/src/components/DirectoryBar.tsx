import { CloudDownload, Database, LoaderCircle } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { getJson } from "../lib/api";
import { canRunLocally } from "../lib/data";
import { roughCount, timeAgo } from "../lib/format";
import { Button, cx } from "./ui";

type Status = {
  local?: { version: string; companies: number; generated_at: string; updated_at: string; checked_at?: string };
  present: boolean;
  outbox: number;
  sharing: boolean;
  age_days: number | null;
};

/** A shared directory older than this is worth a word: it's normally rebuilt every week. */
const STALE_DAYS = 21;

/** "22 Oct", with the year only when it isn't this year. */
const shortDate = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", ...(d.getFullYear() === new Date().getFullYear() ? {} : { year: "numeric" }) });
};

export type DirectoryUpdate = { ok: boolean; updated: boolean; text: string };

/** Download the latest shared directory (local app only). Never throws. */
export async function updateDirectory(): Promise<DirectoryUpdate> {
  const r = await getJson("POST /api/directory/update");
  if (!r.ok || r.data.errors) return { ok: false, updated: false, text: "Couldn't update the directory. Check your internet connection and try again." };
  return { ok: true, updated: !!r.data.updated, text: r.data.updated ? "Directory updated." : "Directory up to date." };
}

/**
 * Where the company directory comes from and how fresh it is, with "Update directory". The shared
 * directory is rebuilt weekly online (public lists plus companies users add) and downloaded here.
 * `companies` is the page's one company count (see countCompanies), so every number matches.
 */
export function DirectoryBar({ onUpdated, companies }: { onUpdated: () => void; companies?: number }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);

  const load = useCallback(async () => {
    if (!canRunLocally) return;
    // No answer: the bar just stays hidden.
    const r = await getJson("GET /api/directory", { cache: "no-store" });
    if (r.ok) setStatus(r.data);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  if (!canRunLocally || !status) return null;

  const update = async () => {
    setBusy(true);
    setMessage(null);
    const r = await updateDirectory();
    setMessage({ tone: r.ok ? "ok" : "bad", text: r.text });
    if (r.updated) onUpdated();
    await load();
    setBusy(false);
  };

  const count = companies ?? status.local?.companies;
  // Checking finds nothing new most days (the shared directory is rebuilt weekly), so say both.
  const text = status.local
    ? `${count ? `${roughCount(count)} companies · ` : ""}checked ${timeAgo(status.local.checked_at ?? status.local.updated_at)} · version from ${shortDate(status.local.generated_at)}`
    : status.present
      ? `${count ? `${roughCount(count)} companies · ` : ""}built on this computer. Update to get everyone's additions`
      : "Not downloaded yet";
  const stale = !!status.local && Date.now() - Date.parse(status.local.generated_at) > STALE_DAYS * 86_400_000;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-md bg-inset/60 px-3 py-2 type-small">
      <Database className="size-4 shrink-0 text-muted" />
      <p className="min-w-0 flex-1 basis-60">
        <span className="font-medium">Company directory:</span> <span className="text-muted">{text}</span>
        {status.outbox > 0 && <span className="text-muted"> · {status.outbox} of your additions waiting to be shared</span>}
      </p>
      <Button size="sm" variant={status.present ? "ghost" : "primary"} onClick={() => void update()} disabled={busy}>
        {busy ? <LoaderCircle className="size-3.5 animate-spin" /> : <CloudDownload className="size-3.5" />}
        {busy ? "Updating…" : status.present ? "Update directory" : "Download directory"}
      </Button>
      {stale && (
        <p className="w-full text-warning-text">
          This version of the directory is more than 3 weeks old. It's normally updated every week, so some new companies may be missing until the next update.
        </p>
      )}
      <p role="status" className={cx("w-full type-small empty:hidden", message?.tone === "bad" ? "text-danger-text" : "text-muted")}>
        {message?.text}
      </p>
    </div>
  );
}

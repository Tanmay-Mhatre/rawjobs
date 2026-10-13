import { safeUrl } from "@rawjobs/core/text";
import { CircleAlert, ExternalLink, LoaderCircle } from "lucide-react";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { ATS_LABEL, type CompanyRef } from "../lib/companies";
import { canRunLocally } from "../lib/data";
import { checkCompanies } from "../lib/setup";
import { judgeLink, type LinkVerdict } from "../lib/updateLink";
import { Button } from "./ui";

const atsName = (ats: string) => ATS_LABEL[ats] ?? ats;
const short = (url: string) => url.replace(/^https?:\/\//, "").replace(/\/$/, "");

/**
 * "Update link" on a company whose careers page stopped working, opened in place under its row:
 * paste the new link, check it, see the old page next to the new one, and only "Use this link"
 * changes anything. Escape and Cancel close it without a change.
 */
export function UpdateLink({
  id,
  name,
  oldKey,
  oldUrl,
  yours,
  onUse,
  onClose,
}: {
  id: string;
  name: string;
  oldKey: string;
  oldUrl?: string;
  /** Your other companies, key → name, to catch a link that's already one of them. */
  yours: ReadonlyMap<string, string>;
  onUse: (to: CompanyRef, opts: { otherName?: string }) => void;
  onClose: () => void;
}) {
  const inputId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [checking, setChecking] = useState(false);
  const [failed, setFailed] = useState(false);
  const [verdict, setVerdict] = useState<LinkVerdict | null>(null);

  useEffect(() => input.current?.focus(), []);

  const check = async () => {
    const url = text.trim();
    if (!url) return;
    setChecking(true);
    setFailed(false);
    setVerdict(null);
    try {
      const [result] = await checkCompanies([url]);
      setVerdict(result ? judgeLink(result, { name, oldKey, yours }) : { kind: "unknown" });
    } catch {
      setFailed(true);
    } finally {
      setChecking(false);
    }
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: Escape closes the panel from any field inside it
    <div
      id={id}
      className="space-y-3 rounded-md border border-line bg-inset p-3 type-small"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      {!canRunLocally ? (
        <p className="text-muted">Can't check links right now. Start RawJobs on your computer and try again.</p>
      ) : (
        <form
          className="space-y-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            void check();
          }}
        >
          <label htmlFor={inputId} className="block font-semibold">
            New careers link for {name}
          </label>
          <div className="flex flex-wrap gap-2">
            <input
              ref={input}
              id={inputId}
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setVerdict(null);
                setFailed(false);
              }}
              placeholder="https://jobs.ashbyhq.com/company"
              className="h-9 min-w-0 flex-1 basis-60 rounded-md border border-line bg-raised px-3 font-mono type-small placeholder:text-muted"
            />
            <Button type="submit" size="sm" disabled={checking || !text.trim()}>
              {checking && <LoaderCircle className="size-3.5 animate-spin" />} Check link
            </Button>
          </div>
        </form>
      )}

      <div role="status" className="space-y-2">
        {failed && <p className="text-danger-text">Couldn't check this link. Check your connection and try again.</p>}
        {verdict && <Result verdict={verdict} name={name} oldUrl={oldUrl} />}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {verdict?.kind === "ok" && (
          <Button size="sm" variant="primary" onClick={() => onUse(verdict.to, { otherName: verdict.otherName })}>
            Use this link
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        {verdict?.kind === "ok" && <span className="text-muted">Past scans of the old link aren't kept.</span>}
      </div>
    </div>
  );
}

function Result({ verdict: v, name, oldUrl }: { verdict: LinkVerdict; name: string; oldUrl?: string }) {
  switch (v.kind) {
    case "same":
      return <Problem>That's the link that stopped working. Paste the company's new careers link.</Problem>;
    case "yours":
      return <Problem>That's {v.name} in your list already.</Problem>;
    case "needsSite":
      return <Problem>This Workday link is missing the career site. Open any job on the company's careers page and paste that link.</Problem>;
    case "unknown":
      return <Problem>This isn't a careers link RawJobs recognises. Paste the link to the company's jobs page, e.g. jobs.lever.co/acme.</Problem>;
    case "error":
      return <Problem>Couldn't open this careers page. Open the link in your browser to check it, then try again.</Problem>;
    case "ok": {
      const c = v.check;
      const href = safeUrl(v.to.careers_url);
      const facts =
        c.status === "live"
          ? c.open_jobs !== undefined
            ? `${c.open_jobs.toLocaleString()} open job${c.open_jobs === 1 ? "" : "s"}`
            : undefined
          : c.status === "dormant"
            ? "No openings right now"
            : "Not supported yet: scanned once support ships";
      return (
        <>
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
            <dt className="text-muted">Old</dt>
            <dd className="min-w-0 text-muted">
              {oldUrl && <span className="break-all font-mono line-through">{short(oldUrl)}</span>} <span className="text-danger-text">Not found</span>
            </dd>
            <dt className="text-muted">New</dt>
            <dd className="min-w-0">
              {href ? (
                <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 break-all font-mono text-ink underline underline-offset-2 hover:text-muted">
                  {short(v.to.careers_url)} <ExternalLink className="size-3 shrink-0" aria-hidden />
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>
              ) : (
                <span className="font-mono">{short(v.to.careers_url)}</span>
              )}{" "}
              <span className="text-muted">
                · {atsName(v.to.ats)}
                {facts && ` · ${facts}`}
              </span>
            </dd>
          </dl>
          {v.otherName && (
            <p className="flex items-start gap-1.5 text-danger-text">
              <CircleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <span>
                This board calls itself “{v.otherName}”, not {name}. Use it only if it's the same company.
              </span>
            </p>
          )}
        </>
      );
    }
  }
}

function Problem({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-start gap-1.5 text-danger-text">
      <CircleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
  );
}

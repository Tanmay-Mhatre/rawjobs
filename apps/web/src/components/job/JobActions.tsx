import { safeUrl } from "@rawjobs/core/text";
import { Bookmark, BookmarkCheck, Check, Copy, Ellipsis, ExternalLink, EyeOff, Plus, X } from "lucide-react";
import type { Job } from "../../lib/data";
import { companyName } from "../../lib/format";
import { type EntryPatch, quickStatus, STATUS_LABEL, type Status } from "../../lib/userState";
import { Button, buttonClass, Menu, Tooltip } from "../primitives";

/** The drawer's foot: Apply, Save (S), and More (Not interested, hide or add the company, copy the description). */
export function JobActions(p: {
  job: Job;
  status?: Status;
  source: string;
  /** The description is loaded and can be copied (C). */
  canCopy: boolean;
  copied: boolean;
  onCopy: () => void;
  onUpdate: (patch: EntryPatch) => void;
  setStatus: (next: Status | undefined) => void;
  onApply?: (job: Job) => void;
  onHideCompany?: (hidden: boolean) => void;
  companyHidden?: boolean;
  /** Add or remove the company from My companies. */
  onTrack?: () => void;
  yours?: boolean;
}) {
  const { job, status, source, copied } = p;
  const saved = status === "saved";
  // Further along than Saved (Applied, Interviewing…): Save shows where it is and doesn't move it back.
  const further = !!status && quickStatus(status, "saved") === null;
  const saveLabel = further && status ? STATUS_LABEL[status] : saved ? "Saved" : "Save";
  return (
    <footer className="rj-drawer__foot">
      <a
        href={safeUrl(job.url)}
        target="_blank"
        rel="noreferrer"
        onClick={() => p.onApply?.(job)}
        className={buttonClass("primary", "md", "rj-foot__apply")}
        title={job.estimated ? undefined : `Apply at ${companyName(job.company)}, opens the posting on ${source}`}
      >
        <ExternalLink className="rj-icon" />
        {/* A long company name ends in "…" rather than pushing the other actions to a second row. */}
        <span className="truncate">{job.estimated ? "Open careers page" : `Apply at ${companyName(job.company)}`}</span>
      </a>
      {/* Labelled everywhere: an icon alone beside Apply read as "close". */}
      <Button
        icon={saved || further ? <BookmarkCheck className="rj-icon" /> : <Bookmark className="rj-icon" />}
        shortcut="S"
        onClick={() => {
          const next = quickStatus(status, "saved");
          if (next !== null) p.onUpdate({ status: next });
        }}
        aria-pressed={saved || further}
        className="shrink-0 aria-pressed:border-ink aria-pressed:bg-active"
      >
        {saveLabel}
      </Button>
      <Menu
        label="More job actions"
        side="above"
        className="ml-auto shrink-0"
        trigger={(t) => (
          <button type="button" className={buttonClass("secondary", "md", "rj-btn--icon")} aria-label="More job actions" {...t}>
            {copied ? <Check className="rj-icon text-success-text" aria-hidden /> : <Ellipsis className="rj-icon" aria-hidden />}
            <Tooltip label="More" side="above" />
          </button>
        )}
        items={[
          {
            id: "dismiss",
            label: status === "dismissed" ? "Interested after all" : "Not interested",
            icon: <X className="rj-icon" aria-hidden />,
            shortcut: "X",
            onSelect: () => p.setStatus(status === "dismissed" ? undefined : "dismissed"),
          },
          ...(p.onHideCompany
            ? [
                {
                  id: "hide",
                  label: p.companyHidden ? `Show ${companyName(job.company)} again` : `Hide ${companyName(job.company)}`,
                  icon: <EyeOff className="rj-icon" aria-hidden />,
                  danger: !p.companyHidden,
                  onSelect: () => p.onHideCompany!(!p.companyHidden),
                },
              ]
            : []),
          ...(p.onTrack
            ? [
                {
                  id: "track",
                  label: p.yours ? "Remove from My companies" : "Add company to My companies",
                  icon: p.yours ? <Check className="rj-icon" aria-hidden /> : <Plus className="rj-icon" aria-hidden />,
                  onSelect: () => p.onTrack?.(),
                },
              ]
            : []),
          ...(p.canCopy ? [{ id: "copy", label: "Copy description", icon: <Copy className="rj-icon" aria-hidden />, shortcut: "C", onSelect: p.onCopy }] : []),
        ]}
      />
      {copied && (
        <span className="sr-only" role="status">
          Copied description
        </span>
      )}
    </footer>
  );
}

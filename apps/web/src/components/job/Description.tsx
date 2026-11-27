import { safeUrl } from "@rawjobs/core/text";
import { LoaderCircle } from "lucide-react";
import { Fragment, useMemo } from "react";
import type { Job } from "../../lib/data";
import { Button } from "../primitives";
import { cx } from "../ui";

/** Description text with the user's topic words highlighted. */
export function Highlighted({ text, terms, wide }: { text: string; terms: string[]; wide?: boolean }) {
  const parts = useMemo(() => {
    if (!terms.length) return [text];
    const re = new RegExp(`(?<![\\p{L}\\p{N}])(${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "[\\s-]+")).join("|")})(?![\\p{L}\\p{N}])`, "giu");
    return text.split(re);
  }, [text, terms]);
  return (
    <div className={cx("max-w-prose whitespace-pre-wrap break-words text-ink", wide ? "type-body leading-7" : "type-small leading-6")}>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: a fixed list rebuilt from the same input, never reordered: the index is a stable key
          <mark key={i} className="rounded-sm bg-inset px-0.5 text-ink">
            {part}
          </mark>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: a fixed list rebuilt from the same input, never reordered: the index is a stable key
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </div>
  );
}

/** Descriptions longer than this start as a preview. */
const PREVIEW_CHARS = 900;

/** "About the role": the description (a preview beside the list, all of it in the reader), or one quiet line with the way to read it. */
export function DescriptionSection(p: {
  job: Job;
  /** undefined while loading, null or "" when there's none. */
  description: string | null | undefined;
  expanded?: boolean;
  /** Shown past its preview, in place. */
  fullText: boolean;
  onFullText: () => void;
}) {
  const { job, description } = p;
  const preview = !p.expanded && !p.fullText && (description?.length ?? 0) > PREVIEW_CHARS;
  // No description: one quiet line with the way to read it, not a whole section.
  return description === null || description === "" ? (
    <p className="flex flex-wrap items-baseline gap-x-2 rounded-md border border-dashed border-line px-3 py-2 type-small text-muted">
      <span>
        {job.estimated ? "Not scanned yet, so no description." : job.why.gate ? "Description not stored for jobs that fail your filters." : "The hiring system didn't include a description."}
      </span>
      <a href={safeUrl(job.url)} target="_blank" rel="noreferrer" className="font-medium text-ink underline underline-offset-2 hover:text-muted">
        Open the job page
      </a>
    </p>
  ) : (
    <section className="rj-drawer__section">
      <h3 className="rj-sec-h">About the role</h3>
      {description === undefined ? (
        <p className="flex items-center gap-2 type-small text-muted">
          <LoaderCircle className="size-4 animate-spin" /> Loading…
        </p>
      ) : // A long description starts as a preview beside the list; the reader (F) always shows it all.
      preview ? (
        <>
          <div className="rj-preview">
            <Highlighted text={description} terms={job.why.keywords} wide={p.expanded} />
          </div>
          <Button size="sm" variant="quiet" className="justify-self-start" onClick={p.onFullText}>
            Read full description
          </Button>
        </>
      ) : (
        <Highlighted text={description} terms={job.why.keywords} wide={p.expanded} />
      )}
    </section>
  );
}

import { cx } from "../../lib/cx";

/**
 * design/components/SourceTag: the hiring system a job was read from and how old the posting is.
 * Plain text, never a logo. The new-this-scan dot is the only round shape in RawJobs.
 */
export function SourceTag({
  source,
  age,
  isNew,
  older,
  title,
  className,
}: {
  source: string;
  /** "2d" */
  age?: string;
  isNew?: boolean;
  /** Posted over two months ago: the age turns amber, as the job may be filled. */
  older?: boolean;
  /** Tooltip for the whole tag ("Still listed · checked 2h ago"). */
  title?: string;
  className?: string;
}) {
  return (
    <span className={cx("rj-source", className)} title={title}>
      {isNew && <span className="rj-dot" role="img" aria-label="New this scan" />}
      {source}
      {age && (
        <span className={cx("rj-source__age", older && "rj-source__age--older")} title={older ? "Posted over two months ago: it may already be filled" : undefined}>
          {age}
          {older && <span className="sr-only">, may be filled</span>}
        </span>
      )}
    </span>
  );
}

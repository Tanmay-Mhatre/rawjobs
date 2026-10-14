import { PACE_SHOWN_FROM, paceLabel, type HiringSummary } from "@rawjobs/core/activity";
import { cx } from "./ui";

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/** "2026-10" -> "October 2026". */
const monthName = (month: string) => `${MONTH_NAMES[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;

/**
 * The first line: "14 new roles in the last 30 days, about 3× their usual pace." Before 30 days are
 * recorded it counts roles posted (from posted dates) instead. Null when there's no count.
 */
export function hiringLine(s: HiringSummary): string | null {
  if (s.last30 === undefined) return null;
  if (s.basis === "posted") return `${s.last30} posted in the last 30 days.`;
  const roles = `${s.last30} new ${s.last30 === 1 ? "role" : "roles"} in the last 30 days`;
  // A pace against "usually none" (Infinity) says nothing: the surge tag's hover has the numbers.
  const pace = s.baselineReady && s.pace !== undefined && Number.isFinite(s.pace) && s.pace >= PACE_SHOWN_FROM ? `, about ${paceLabel(s.pace)} their usual pace` : "";
  return `${roles}${pace}.`;
}

/** Where the numbers come from, or, until they can be compared, when records started. */
export function hiringFootnote(s: HiringSummary): string {
  if (!s.baselineReady) return `Records started ${monthName(s.since.slice(0, 7))}. Comparisons show after 6 weeks.`;
  return s.source === "local" ? "New roles seen in your scans of their careers page." : "New roles seen in RawJobs' daily read of their careers page.";
}

/** "New roles per month: November 2025 no records, …, October 2026 14 (this month)." */
function spokenBars(s: HiringSummary): string {
  const last = s.months.length - 1;
  const parts = s.months.map((m, i) => `${monthName(m.month)} ${m.count === null ? "no records" : m.count}${i === last ? " (this month)" : ""}`);
  return `New roles per month: ${parts.join(", ")}.`;
}

/**
 * "Hiring at {company}" in the job drawer: new roles in the last 30 days against the usual pace, and
 * the last 12 months as bars (this month in ink; months before records started as a dashed baseline).
 * Never part of the score.
 */
export function HiringActivity({ company, summary }: { company: string; summary: HiringSummary }) {
  const line = hiringLine(summary);
  const max = Math.max(1, ...summary.months.map((m) => m.count ?? 0));
  const last = summary.months.length - 1;
  return (
    <section className="rj-drawer__section">
      <h3 className="rj-h">Hiring at {company}</h3>
      {line && <p className={cx("type-small", summary.surge && "font-medium")}>{line}</p>}
      <div className="mt-2 grid h-16 grid-cols-12 items-end gap-1" role="img" aria-label={spokenBars(summary)}>
        {summary.months.map((m, i) =>
          m.count === null ? (
            <span key={m.month} className="block border-b border-dashed border-line" />
          ) : (
            <span key={m.month} className={cx("block min-h-0.5 rounded-t-sm", i === last ? "bg-ink" : "bg-control")} style={{ height: `${(m.count / max) * 100}%` }} />
          ),
        )}
      </div>
      <div className="grid grid-cols-12 gap-1 text-center type-meta text-muted" aria-hidden>
        {summary.months.map((m) => (
          <span key={m.month}>{MONTH_NAMES[Number(m.month.slice(5, 7)) - 1]![0]}</span>
        ))}
      </div>
      <p className="type-small text-muted">{hiringFootnote(summary)}</p>
    </section>
  );
}

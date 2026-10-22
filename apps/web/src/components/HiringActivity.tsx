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

/**
 * "Hiring" in the job drawer's company section: new roles in the last 30 days against the usual pace,
 * and where the numbers come from. One line, no monthly chart: most people use RawJobs for weeks, not
 * the months a chart needs to say anything. Never part of the score.
 */
export function HiringActivity({ summary }: { summary: HiringSummary }) {
  const line = hiringLine(summary);
  return (
    <div className="grid gap-1">
      <h4 className="rj-sub-h">Hiring</h4>
      {line && <p className={cx("type-small", summary.surge && "font-medium")}>{line}</p>}
      <p className="type-meta text-muted">{hiringFootnote(summary)}</p>
    </div>
  );
}

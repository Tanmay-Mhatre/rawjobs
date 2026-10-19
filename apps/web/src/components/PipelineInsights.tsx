import { ChartNoAxesColumn } from "lucide-react";
import { pct, pipelineStats } from "../lib/pipelineStats";
import type { UserState } from "../lib/userState";

const input = "h-8 w-16 rounded-md border border-line bg-raised px-2 type-small text-ink tabular";

/**
 * How your search is going, worked out on this computer from your tracking: applications this week
 * against your goal, reply rate, time to reply, ghosting, and reply rate by fit score. Folded to one
 * line until opened.
 */
export function PipelineInsights({ user, goal, onGoal }: { user: UserState; goal?: number; onGoal: (goal: number | undefined) => void }) {
  const s = pipelineStats(user);
  if (!s.applied && !goal) return null;
  const stats = [
    { label: "Applied, last 30 days", value: String(s.applied30) },
    { label: "Reply rate", value: pct(s.replied, s.applied), hint: `${s.replied} of ${s.applied} answered` },
    { label: "Days to reply", value: s.medianDaysToReply === undefined ? "–" : String(s.medianDaysToReply), hint: "median" },
    { label: "No response", value: pct(s.ghosted, s.applied), hint: `${s.ghosted} closed as no response` },
  ];
  return (
    <details className="group mb-3 rounded-md border border-line bg-raised shadow-l1">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 type-small">
        <ChartNoAxesColumn className="size-4 text-muted" aria-hidden />
        <span className="font-semibold">This week</span>
        <span className="tabular text-muted">
          {s.appliedThisWeek}
          {goal ? ` of ${goal}` : ""} applied · {pct(s.replied, s.applied)} reply rate
        </span>
        {goal ? (
          <span className="ml-1 h-1.5 w-24 overflow-hidden rounded-sm bg-inset" aria-hidden>
            <span className="block h-full rounded-sm bg-ink" style={{ width: `${Math.min(100, (s.appliedThisWeek / goal) * 100)}%` }} />
          </span>
        ) : null}
        <span className="ml-auto type-meta text-muted group-open:hidden">Show insights</span>
      </summary>
      <div className="grid gap-4 border-t border-line p-3">
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {stats.map((x) => (
            <div key={x.label}>
              <dt className="type-meta text-muted">{x.label}</dt>
              <dd className="tabular type-subheading font-semibold">{x.value}</dd>
              {x.hint && <dd className="type-meta text-muted">{x.hint}</dd>}
            </div>
          ))}
        </dl>
        {s.bands.length > 0 && (
          <div>
            <h3 className="type-label">Reply rate by fit score</h3>
            <ul className="mt-1 grid gap-1 type-small">
              {s.bands.map((b) => (
                <li key={b.label} className="grid grid-cols-[7rem_1fr_6rem] items-center gap-2">
                  <span className="text-muted">{b.label}</span>
                  <span className="h-1.5 overflow-hidden rounded-sm bg-inset" aria-hidden>
                    <span className="block h-full rounded-sm bg-ink" style={{ width: pct(b.replied, b.applied).replace("–", "0%") }} />
                  </span>
                  <span className="tabular text-right">
                    {pct(b.replied, b.applied)} <span className="text-muted">of {b.applied}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <label className="flex items-center gap-2 type-small">
          Weekly goal
          <input
            type="number"
            min={1}
            max={100}
            defaultValue={goal ?? ""}
            placeholder="–"
            onBlur={(e) => {
              const n = Math.round(Number(e.target.value));
              onGoal(n >= 1 && n <= 100 ? n : undefined);
            }}
            className={input}
          />
          <span className="text-muted">applications a week</span>
        </label>
      </div>
    </details>
  );
}

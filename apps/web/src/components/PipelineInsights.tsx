import { ChartNoAxesColumn } from "lucide-react";
import { type ReactNode, type Ref, useId, useRef, useState } from "react";
import { PLAN_MAX, type WeeklyPlan } from "../lib/prefs";
import { FUNNEL_MIN, type Funnel, pct, pipelineStats, STREAK_MIN, type WeekBar } from "../lib/pipelineStats";
import type { UserState } from "../lib/userState";
import { Button } from "./ui";

const input = "h-8 w-16 rounded-md border border-control bg-raised px-2 type-small text-ink tabular";
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const shortDate = (d: Date) => d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
const dayLabel = (day: string, time?: string) => `${new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}${time ? `, ${time}` : ""}`;

/** A thin bar in ink for `value` of `max`, read out as a progress bar. */
function Progress({ value, max, label, className = "" }: { value: number; max: number; label: string; className?: string }) {
  return (
    <span
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={Math.min(value, max)}
      aria-valuetext={`${value} of ${max}`}
      className={`block h-1.5 overflow-hidden rounded-sm bg-inset ${className}`}
    >
      <span className="block h-full rounded-sm bg-ink" style={{ width: `${Math.min(100, (value / max) * 100)}%` }} />
    </span>
  );
}

function Tile({ label, value, goal, children }: { label: string; value: number; goal?: number; children?: ReactNode }) {
  return (
    <div className="grid content-start gap-1 rounded-md border border-line p-3">
      <dt className="type-meta text-muted">{label}</dt>
      <dd className="tabular type-subheading font-semibold">
        {value}
        {goal ? <span className="type-small font-normal text-muted"> of {goal}</span> : null}
      </dd>
      {goal ? (
        <dd>
          <Progress value={value} max={goal} label={`${label} against your plan`} />
        </dd>
      ) : null}
      {children}
    </div>
  );
}

/** Applications per week as bars in ink, the plan as a dashed line, and the same numbers as a hidden table. */
function WeeksChart({ weeks, goal }: { weeks: WeekBar[]; goal?: number }) {
  // Headroom above the tallest bar for its count and the plan label.
  const max = Math.max(1, goal ?? 0, ...weeks.map((w) => w.applied)) * 1.25;
  const label = (w: WeekBar, i: number) => (i === weeks.length - 1 ? "This week" : shortDate(w.start));
  return (
    <section aria-labelledby="pi-weeks">
      <h3 id="pi-weeks" className="type-label">
        Applications per week
      </h3>
      <div className="mt-2" aria-hidden>
        <div className="relative flex h-28 items-end gap-2 border-b border-line">
          {goal ? (
            <div className="pointer-events-none absolute inset-x-0 border-t border-dashed border-muted" style={{ bottom: `${(goal / max) * 100}%` }}>
              <span className="absolute right-0 -top-5 bg-raised pl-1 type-meta text-muted tabular">Plan {goal}</span>
            </div>
          ) : null}
          {weeks.map((w) => (
            <div key={w.start.getTime()} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
              <span className="type-meta tabular text-muted">{w.applied}</span>
              <span className="block w-full max-w-8 rounded-t-sm bg-ink" style={{ height: `${(w.applied / max) * 100}%` }} />
            </div>
          ))}
        </div>
        <div className="mt-1 flex gap-2">
          {weeks.map((w, i) => (
            <span key={w.start.getTime()} className="flex-1 truncate text-center type-meta text-muted">
              {label(w, i)}
            </span>
          ))}
        </div>
      </div>
      <table className="sr-only">
        <caption>Applications per week{goal ? `, plan ${goal}` : ""}</caption>
        <thead>
          <tr>
            <th scope="col">Week of</th>
            <th scope="col">Applications</th>
          </tr>
        </thead>
        <tbody>
          {weeks.map((w, i) => (
            <tr key={w.start.getTime()}>
              <th scope="row">{label(w, i)}</th>
              <td>{w.applied}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/** Where the last 30 days of applications went. */
function FunnelView({ f }: { f: Funnel }) {
  const rows = [
    { label: "Applied", n: f.applied },
    { label: "Heard back", n: f.heardBack, share: true },
    { label: "Interviewed", n: f.interviewed },
    { label: "Offer", n: f.offer },
  ];
  return (
    <section aria-labelledby="pi-funnel">
      <h3 id="pi-funnel" className="type-label">
        Where applications go, last 30 days
      </h3>
      {f.applied < FUNNEL_MIN ? (
        <p className="mt-1 type-small text-muted">Shows once you have {FUNNEL_MIN} applications in 30 days.</p>
      ) : (
        <ul className="mt-2 grid gap-1.5 type-small">
          {rows.map((r) => (
            <li key={r.label} className="grid grid-cols-[7rem_1fr_5rem] items-center gap-2">
              <span className="text-muted">{r.label}</span>
              <span className="h-1.5 overflow-hidden rounded-sm bg-inset" aria-hidden>
                <span className="block h-full rounded-sm bg-ink" style={{ width: `${(r.n / f.applied) * 100}%` }} />
              </span>
              <span className="tabular text-right">
                {r.n}
                {r.share ? <span className="text-muted"> ({pct(r.n, f.applied)})</span> : null}
              </span>
            </li>
          ))}
          <li className="mt-1 grid grid-cols-[1fr_5rem] items-center gap-2 border-t border-line pt-2">
            <span className="text-muted">No response (closed)</span>
            <span className="tabular text-right">{f.noResponse}</span>
          </li>
        </ul>
      )}
    </section>
  );
}

/** One weekly goal: 1 to PLAN_MAX, or empty for none. Saved when you leave the field; keyed by its value so a plan that arrives later (disk sync) refills it. */
function PlanField({ label, value, onSave, inputRef }: { label: string; value?: number; onSave: (n?: number) => void; inputRef?: Ref<HTMLInputElement> }) {
  const id = useId();
  const [error, setError] = useState(false);
  return (
    <div className="grid content-start gap-1">
      <label htmlFor={id} className="type-small">
        {label}
      </label>
      <input
        id={id}
        ref={inputRef}
        type="number"
        inputMode="numeric"
        min={1}
        max={PLAN_MAX}
        defaultValue={value ?? ""}
        aria-invalid={error || undefined}
        aria-describedby={error ? `${id}-err` : undefined}
        onChange={() => setError(false)}
        onBlur={(e) => {
          // Text the number field can't read ("1e", "-") reads as empty: refuse it instead of clearing the goal.
          if (e.target.validity.badInput) return setError(true);
          const raw = e.target.value.trim();
          if (!raw) return onSave(undefined);
          const n = Number(raw);
          if (!Number.isInteger(n) || n < 1 || n > PLAN_MAX) return setError(true);
          onSave(n);
        }}
        className={input}
      />
      {error && (
        <span id={`${id}-err`} className="type-meta text-danger-text">
          Enter 1 to {PLAN_MAX}, or leave it empty.
        </span>
      )}
    </div>
  );
}

/**
 * Your week against your plan, worked out on this computer from your tracking: applications, follow-ups,
 * outreach and interviews; applications over the last 8 weeks; and where the last 30 days of applications
 * went. Folded to one line until opened.
 */
export function PipelineInsights({ user, plan, onPlan }: { user: UserState; plan: WeeklyPlan; onPlan: (plan: WeeklyPlan) => void }) {
  const s = pipelineStats(user, plan);
  const firstGoal = useRef<HTMLInputElement>(null);
  const hasPlan = Boolean(plan.applications || plan.followUps || plan.outreach);
  if (!s.everApplied && !hasPlan && !s.followUps && !s.outreach && !s.upcoming) return null;
  const goal = plan.applications;
  const set = (k: keyof WeeklyPlan) => (n?: number) => {
    if (n === plan[k]) return;
    const p = { ...plan };
    if (n) p[k] = n;
    else delete p[k];
    onPlan(p);
  };
  return (
    <details className="group mb-3 rounded-md border border-line bg-raised shadow-l1">
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2 type-small">
        <ChartNoAxesColumn className="size-4 text-muted" aria-hidden />
        <span className="font-semibold">This week</span>
        <span className="tabular text-muted">
          · {goal ? `${s.applied} of ${goal} applications` : plural(s.applied, "application", "applications")} · {plural(s.followUps, "follow-up", "follow-ups")} ·{" "}
          {plural(s.upcoming, "interview", "interviews")} coming up
        </span>
        {goal ? <Progress value={s.applied} max={goal} label="Applications this week" className="ml-1 w-24" /> : null}
        <span className="ml-auto type-meta text-muted group-open:hidden">Show insights</span>
        <span className="ml-auto hidden type-meta text-muted group-open:inline">Hide insights</span>
      </summary>
      <div className="grid gap-5 border-t border-line p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="type-label">
            Week of {shortDate(s.week.start)} to {shortDate(s.week.end)}
          </h2>
          {goal && s.streak >= STREAK_MIN ? <p className="type-small tabular text-muted">{s.streak} weeks in a row you hit your plan</p> : null}
          {!hasPlan && (
            <Button size="sm" onClick={() => firstGoal.current?.focus()}>
              Set a plan
            </Button>
          )}
        </div>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Tile label="Applications" value={s.applied} goal={plan.applications} />
          <Tile label="Follow-ups sent" value={s.followUps} goal={plan.followUps} />
          <Tile label="Outreach and referrals" value={s.outreach} goal={plan.outreach} />
          <Tile label="Interviews" value={s.interviewsThisWeek}>
            <dd className="type-meta text-muted">{s.next ? `Next: ${dayLabel(s.next.on, s.next.time)}` : "None booked"}</dd>
          </Tile>
        </dl>
        <WeeksChart weeks={s.weeks} goal={goal} />
        <FunnelView f={s.funnel} />
        <section aria-labelledby="pi-plan">
          <h3 id="pi-plan" className="type-label">
            Your weekly plan
          </h3>
          <p className="type-meta text-muted">A goal for each week, from 1 to {PLAN_MAX}. Leave one empty to go without.</p>
          <div className="mt-2 flex flex-wrap gap-4">
            <PlanField key={`applications-${plan.applications ?? ""}`} label="Applications" value={plan.applications} onSave={set("applications")} inputRef={firstGoal} />
            <PlanField key={`followUps-${plan.followUps ?? ""}`} label="Follow-ups" value={plan.followUps} onSave={set("followUps")} />
            <PlanField key={`outreach-${plan.outreach ?? ""}`} label="Outreach and referrals" value={plan.outreach} onSave={set("outreach")} />
          </div>
        </section>
      </div>
    </details>
  );
}

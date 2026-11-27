import { INDUSTRY_BY_ID } from "@rawjobs/core/catalog/industries";
import { matchesTitle } from "@rawjobs/core/text";
import { ChevronDown, ChevronUp, CircleCheck, CircleHelp, Info, X } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import type { Job, Profile } from "../../lib/data";
import { type FitFix, fitFixes, fixApplied, useProfileFix } from "../../lib/profileFix";
import { load, save } from "../../lib/storage";
import { settingsHash } from "../settings/registry";
import { Button, IconButton, ScoreBadge, scoreBandOf, scoreParts } from "../primitives";
import { toast } from "../Toast";
import { cx } from "../ui";

const BAND_WORD = { strong: "Strong", fair: "Fair", weak: "Weak" } as const;

/** Whether "Why it matched" shows its rows; folded by default so the description starts higher. */
const WHY_OPEN_KEY = "rawjobs.whyOpen";

/** The score and its band against your threshold; unfolds to a row per scored part (points and reason) and the requirements. */
export function WhyItMatches({ job, profile, yours }: { job: Job; profile: Profile; yours: boolean }) {
  const [open, setOpen] = useState(() => load<boolean>(WHY_OPEN_KEY, false));
  /** "How the score works", behind the ⓘ. */
  const [info, setInfo] = useState(false);
  const toggle = () => {
    save(WHY_OPEN_KEY, !open);
    setOpen(!open);
  };
  const w = job.why;
  const band = BAND_WORD[scoreBandOf(job.score, profile.min_score)];
  // The include term the scorer matched, read the same way ("Sr. PM" is "product manager").
  const titleTerm = useMemo(() => profile.titles.include.find((t) => matchesTitle(job.title, [t])), [job.title, profile]);
  // Topics you listed vs the ones your industries added; and your own topics the posting doesn't mention.
  // A topic found through a word that proves it says which: "payments (as PSP)".
  const named = (k: string) => (w.via?.[k] ? `${k} (as ${w.via[k]})` : k);
  // Topics read from your résumé (you set none yourself) count as yours.
  const fromResume = w.topicsFrom === "resume";
  const own = fromResume ? (w.ownTopics ?? []) : w.keywords.filter((k) => k in profile.keywords);
  const added = w.keywords.filter((k) => !own.includes(k));
  const checked = !job.estimated && job.hasDescription;
  const missing =
    checked && fromResume
      ? (w.missing ?? [])
      : checked
        ? Object.entries(profile.keywords)
            .filter(([k]) => !w.keywords.includes(k))
            .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
            .map(([k]) => k)
        : [];
  // Scores from before `level` existed carried it in the title points (30 / 25).
  const lv = w.level ?? (w.title === 30 ? 10 : w.title === 25 ? 5 : 0);
  const level = lv === 10 ? ", at your level" : lv === 5 ? ", one level from yours" : profile.seniority_boost.length ? ", not near your level" : "";
  // Pay, visa, must-haves and years: met, missed, or unknown when the posting doesn't say (never shown as a pass).
  const eligibility = (w.checks ?? []).filter((c) => c.id !== "place" && c.id !== "level");
  // One-click fixes for checks your profile got wrong, when your profile can be saved from here.
  const fixer = useProfileFix();
  const fixes = fixer ? fitFixes(job).filter((f) => !fixApplied(f, fixer.draft)) : [];
  const fixFor = (check: string) => fixes.find((f) => f.check === check);
  // `part` ties a check to its score part (scoreParts' label); checks without one are requirements, worth no points.
  const items: { ok: boolean; unknown?: boolean; text: ReactNode; fix?: FitFix; part?: string }[] = [
    {
      part: "Title",
      ok: w.title > 0,
      fix: fixFor("level"),
      text:
        w.title > 0 ? (
          <>
            Title matches <b>{titleTerm ?? "your roles"}</b>
            {level}
          </>
        ) : (
          "Title isn't one of your roles"
        ),
    },
    {
      part: "Place",
      ok: w.location > 0,
      text:
        w.location === 20 ? (
          <>
            In one of your places
            {job.countries.length ? (
              <>
                {" "}
                (<b>{job.countries.join(", ")}</b>)
              </>
            ) : null}
          </>
        ) : w.location === 15 ? (
          "Remote, open to your regions"
        ) : (
          (w.locationNote ?? "Not in one of your places")
        ),
    },
    ...(w.scale
      ? []
      : [
          {
            part: "Keywords",
            ok: own.length > 0 || added.length > 0,
            text: own.length ? (
              <>
                {w.topicsFrom === "resume" ? "Mentions topics from your résumé" : "Mentions your topics"}: <b>{own.map(named).join(", ")}</b>
                {added.length ? <>; also {added.map(named).join(", ")} from your industries</> : null}
              </>
            ) : added.length ? (
              <>
                Mentions topics from your industries: <b>{added.map(named).join(", ")}</b>
              </>
            ) : checked ? (
              "Doesn't mention your topics"
            ) : (
              "Topics not checked yet: the full posting hasn't been fetched"
            ),
          },
        ]),
    // One year short of the years asked is close enough to count.
    ...eligibility.map((c) => ({ ok: c.status === "met" || (c.id === "experience" && c.status === "near"), unknown: c.status === "unknown", text: c.note, fix: fixFor(c.id) })),
    w.industry === undefined
      ? { part: "Fresh", ok: (w.freshness ?? 0) >= 6, text: w.freshness === 10 ? "Posted in the last 3 days" : w.freshness === 6 ? "Posted this week" : "Posted more than a week ago" }
      : { part: "Industry", ok: w.industry === 10, unknown: w.industry === 5, text: industryText(w.industry, job, profile, yours) },
  ];
  const min = profile.min_score;
  const cutOff = job.score > min ? `above your ${min} cut-off` : job.score === min ? `at your ${min} cut-off` : `below your ${min} cut-off`;
  const parts = scoreParts(w);
  // The level sits inside the title line (a pass); folded, its fix gets a pill of its own.
  const levelFix = fixFor("level");
  const misses = [
    ...items.filter((it) => !it.ok && !it.unknown),
    ...(levelFix && w.title > 0 ? [{ text: w.checks?.find((c) => c.id === "level")?.note ?? "Not near your level", fix: levelFix }] : []),
  ];
  const unknowns = items.filter((it) => it.unknown);
  // The verdict in a few words: which parts of the score it earned ("Matches on title, place and keywords").
  const earned = parts.filter((x) => x.earned > 0).map((x) => (x.label === "Fresh" ? "posting date" : x.label.toLowerCase()));
  const matchesOn = earned.length ? `Matches on ${earned.length > 1 ? `${earned.slice(0, -1).join(", ")} and ${earned.at(-1)}` : earned[0]}` : "Matches none of what you asked for";
  // Open: one row per scored part with its check; the other checks (pay, visa, years, must-haves) are requirements.
  const reqs = items.filter((it) => !it.part);
  const sum = (key: "earned" | "max") => Math.round(parts.reduce((n, x) => n + x[key], 0) * 10) / 10;
  return (
    <section aria-label="Why it matched" className={cx("rj-drawer__section", open && "gap-4")}>
      {/* On a phone the toggle drops under the verdict rather than squeezing it. */}
      <div className="flex flex-wrap items-center gap-3">
        <ScoreBadge score={job.score} threshold={min} estimated={job.estimated} word />
        <div className="min-w-[11rem] flex-1">
          <h3 className="rj-h">{band} match</h3>
          <p className="type-small text-muted">
            {matchesOn}, {cutOff}. {job.estimated ? "Estimated from title, place and industry." : null}{" "}
            {!open && (
              <span className="sr-only">
                {items.filter((it) => it.ok).length} of {items.length} checks pass.
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center">
          <IconButton label="How the score works" size="sm" onClick={() => setInfo(!info)} aria-expanded={info} aria-controls={`score-info-${job.id}`}>
            <Info className="rj-icon" />
          </IconButton>
          <Button size="sm" variant="quiet" onClick={toggle} aria-expanded={open} aria-controls={`why-${job.id}`} icon={open ? <ChevronUp className="rj-icon" /> : <ChevronDown className="rj-icon" />}>
            {open ? "Hide why" : "Why"}
          </Button>
        </div>
      </div>
      {info && (
        <div id={`score-info-${job.id}`} className="grid gap-1 rounded-md bg-inset p-3 type-small text-muted">
          <p>The score is how well the job fits what you asked for, not your odds of an interview.</p>
          {/* A gate or a dealbreaker changes the score past the sum: their own lines say how. */}
          {w.scale && !w.gate && !w.dealbreakers?.length && (
            <p>
              You have no topics yet, so title, place and industry make up the whole score: {sum("earned")} of {sum("max")} points, shown as {job.score} out of 100.
            </p>
          )}
          <p>Best match also lists newer jobs{yours ? " and your companies" : ""} higher. The score itself doesn't change.</p>
        </div>
      )}
      {/* Folded: only what didn't fit or isn't known, each with its fix. The points are in the rows. */}
      {!open && misses.length + unknowns.length > 0 && (
        <ul className="rj-pills">
          {misses.map((it, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: a fixed list rebuilt from the same input, never reordered: the index is a stable key
            <li key={i} className="rj-pill rj-pill--miss">
              <X className="size-4 shrink-0" aria-hidden />
              <span>{it.text}</span>
              {it.fix && <FixButton fix={it.fix} />}
            </li>
          ))}
          {unknowns.map((it, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: a fixed list rebuilt from the same input, never reordered: the index is a stable key
            <li key={`u${i}`} className="rj-pill">
              <CircleHelp className="size-4 shrink-0 text-muted" aria-label="Not stated:" />
              <span>{it.text}</span>
              {it.fix && <FixButton fix={it.fix} />}
            </li>
          ))}
        </ul>
      )}
      {w.gate && <p className="type-small text-warning-text">Failed your {w.gate} filter, so the score is 0.</p>}
      {w.heldBack && !w.dealbreakers?.length && (
        <p className="type-small text-warning-text">Adds up to a strong match, but kept just under your cut-off: {w.heldBack.charAt(0).toLowerCase() + w.heldBack.slice(1)}.</p>
      )}
      {!!w.dealbreakers?.length && (
        <div className="type-small text-warning-text" data-dealbreakers>
          <p>
            Breaks {w.dealbreakers.length === 1 ? "one of your dealbreakers" : `${w.dealbreakers.length} of your dealbreakers`}, so the score is at most half what its parts add up to, and under your
            threshold:
          </p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {w.dealbreakers.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
        </div>
      )}
      {open && (
        <div id={`why-${job.id}`} className="grid gap-4">
          <div className="rj-fit-rows">
            {parts.map((x) => {
              const label = x.label === "Keywords" ? "Topics" : x.label;
              const it = items.find((i) => i.part === x.label);
              const fill = x.max ? Math.min(1, Math.max(0, x.earned / x.max)) : 0;
              return (
                <div key={x.label} className="rj-fit-row">
                  <span className="font-medium">{label}</span>
                  <span className={cx("rj-meter", it?.unknown && "rj-meter--soft")} role="img" aria-label={`${label}: ${Math.round(x.earned)} of ${x.max} points`}>
                    <i style={{ width: `${fill * 100}%` }} />
                  </span>
                  <span className="tabular text-right font-medium" aria-hidden>
                    {Math.round(x.earned)}
                    <span className="font-normal text-muted">/{x.max}</span>
                  </span>
                  {it && (
                    <p className="rj-fit-row__why flex items-start gap-2 type-small text-muted">
                      <CheckIcon it={it} />
                      <span className="min-w-0 flex-1">
                        {it.text}
                        {x.label === "Keywords" && missing.length > 0 && <span className="block">Not found: {missing.join(", ")}.</span>}
                      </span>
                      {it.fix && <FixButton fix={it.fix} />}
                    </p>
                  )}
                </div>
              );
            })}
            {/* No topics: say so where their points would be, with the way to add some. */}
            {w.scale && (
              <div className="rj-fit-row">
                <span className="font-medium text-muted">Topics</span>
                <span className="type-small text-muted">Not set, so the three others make the score</span>
                <a href={`#${settingsHash("keywords")}`} className="text-right type-small font-medium text-ink underline underline-offset-2 hover:text-muted">
                  Add
                </a>
              </div>
            )}
          </div>
          {reqs.length > 0 && (
            <div className="grid gap-1">
              <h4 className="rj-sec-h">
                Requirements <span className="font-normal text-muted">· don't add points</span>
              </h4>
              <ul className="space-y-1.5 type-small">
                {reqs.map((it, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: a fixed list rebuilt from the same input, never reordered: the index is a stable key
                  <li key={i} className="flex items-start gap-2">
                    <CheckIcon it={it} />
                    <span className={cx("min-w-0 flex-1", !it.ok && "text-muted")}>{it.text}</span>
                    {it.fix && <FixButton fix={it.fix} />}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/** A check's mark: met, not stated, or missed. */
function CheckIcon({ it }: { it: { ok: boolean; unknown?: boolean } }) {
  if (it.ok) return <CircleCheck className="mt-0.5 size-4 shrink-0 text-success-text" aria-label="Met:" />;
  if (it.unknown) return <CircleHelp className="mt-0.5 size-4 shrink-0 text-muted" aria-label="Not stated:" />;
  return <X className="mt-0.5 size-4 shrink-0 text-muted" aria-label="Missed:" />;
}

/** A fix beside a check: saves one word to your profile (re-scored on the next scan), or opens the setting. */
function FixButton({ fix }: { fix: FitFix }) {
  const fixer = useProfileFix();
  const [saving, setSaving] = useState(false);
  if (!("field" in fix))
    return (
      <a href={`#${settingsHash(fix.section)}`} className="ml-auto shrink-0 font-medium text-ink underline underline-offset-2 hover:text-muted">
        {fix.label}
      </a>
    );
  const apply = async () => {
    if (!fixer) return;
    setSaving(true);
    const error = await fixer.add(fix.field, fix.value);
    setSaving(false);
    toast({ message: error ?? `${fix.done} Scores update on the next scan.` });
  };
  return (
    <button type="button" onClick={apply} disabled={saving} className="ml-auto shrink-0 font-medium text-ink underline underline-offset-2 hover:text-muted disabled:opacity-60">
      {saving ? "Saving…" : fix.label}
    </button>
  );
}

/** Why the industry part is what it is, without claiming more than the score knows. */
function industryText(points: number, job: Job, profile: Profile, yours: boolean): ReactNode {
  if (points === 5) return "Company's industry not known";
  if (points === 0) return "Not one of your industries";
  const shared = (job.industries ?? []).filter((i) => profile.industries.includes(i)).map((i) => INDUSTRY_BY_ID.get(i)?.label ?? i);
  if (shared.length)
    return (
      <>
        In one of your industries: <b>{shared.join(", ")}</b>
      </>
    );
  if (yours) return "One of your companies, so its industry counts";
  if (!profile.industries.length) return "No industries picked, so every company counts";
  return "In one of your industries";
}

import { ExternalLink, Star } from "lucide-react";
import { useEffect, useState } from "react";
import type { RunSummary } from "../lib/data";
import { load, save } from "../lib/storage";
import { REPO_URL } from "../lib/update";
import type { UserState } from "../lib/userState";
import { firstSeenFrom, RUNS_KEPT, STAR_KEY, starDue, starFacts, type StarPrompt as Saved } from "../lib/starPrompt";
import { Dialog } from "./Dialog";
import { buttonClass } from "./primitives";
import { Button, Card } from "./ui";

/** What the Radar knows that the question needs: your tracking and the scans so far (meta.json). */
export type StarInput = { state: UserState; runs: readonly RunSummary[] };

/**
 * "Is RawJobs helping your search?": once you've used it for a week and applied to a job or run a few
 * scans, a popup asks for a star on GitHub. Star or "Don't ask again" ends it; "Remind me later" (or
 * Escape) asks once more a month on. It opens the GitHub page and can't tell whether you starred.
 */
export function StarPrompt({ state, runs }: StarInput) {
  const [saved, setSaved] = useState<Saved>(() => load<Saved>(STAR_KEY, {}));
  const [open, setOpen] = useState(true);
  // People who used RawJobs before this question: date the first use from what's already there.
  useEffect(() => {
    if (saved.firstSeen) return;
    const next = { ...saved, firstSeen: firstSeenFrom(state, runs, Date.now()) };
    save(STAR_KEY, next);
    setSaved(next);
  }, [saved, state, runs]);

  const now = Date.now();
  const facts = starFacts(saved, state, runs, now);
  if (!open || !saved.firstSeen || !starDue(saved, facts, now)) return null;

  const close = (answer: "starred" | "never" | "later") => {
    const next: Saved = answer === "later" ? { ...saved, later: [...(saved.later ?? []), new Date().toISOString()] } : { ...saved, answer };
    save(STAR_KEY, next);
    setSaved(next);
    setOpen(false);
  };
  const chips = [
    { n: facts.days, one: "day", many: "days", more: false },
    { n: facts.scans, one: "scan", many: "scans", more: facts.scans >= RUNS_KEPT },
    { n: facts.applied, one: "job applied", many: "jobs applied", more: false },
  ].filter((c) => c.n > 0);

  return (
    <Dialog open onClose={() => close("later")} labelledBy="star-title" describedBy="star-body" initialFocus="[data-autofocus]" placement="bottom">
      <Card className="p-5 shadow-l3 sm:p-6">
        <div className="flex items-start gap-4">
          <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-md border border-hairline bg-inset text-accent-mark sm:size-12">
            <Star className="size-5 fill-current sm:size-6" />
          </span>
          <div className="min-w-0 flex-1 space-y-3">
            <div className="space-y-2">
              <h2 id="star-title" className="type-subheading font-semibold text-balance">
                Is RawJobs helping your search?
              </h2>
              <p id="star-body" className="type-small text-ink">
                RawJobs is free and open source. A star on GitHub helps other job seekers find it, and takes one click.
              </p>
            </div>
            {chips.length > 0 && (
              <ul aria-label="Your RawJobs so far" className="flex flex-wrap gap-1.5">
                {chips.map((c) => (
                  <li key={c.one} className="rounded-sm border border-hairline bg-inset px-2 py-1 type-meta text-muted tabular-nums">
                    <b className="font-semibold text-ink">
                      {c.n}
                      {c.more && "+"}
                    </b>{" "}
                    {c.n === 1 ? c.one : c.many}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button onClick={() => close("later")}>Remind me later</Button>
          <a href={REPO_URL} target="_blank" rel="noreferrer" data-autofocus onClick={() => close("starred")} className={buttonClass("primary")}>
            Star on GitHub <ExternalLink className="size-3.5" aria-hidden />
          </a>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-hairline pt-3">
          <p className="type-meta text-muted">Opens github.com in your browser. You'll need a GitHub account.</p>
          <button type="button" onClick={() => close("never")} className="type-meta font-medium text-muted underline underline-offset-2 hover:text-ink">
            Don't ask again
          </button>
        </div>
      </Card>
    </Dialog>
  );
}

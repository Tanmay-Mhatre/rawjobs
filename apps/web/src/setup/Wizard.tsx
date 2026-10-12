import { groupPlaces } from "@rawjobs/core/catalog/places";
import { configToYaml } from "@rawjobs/core/yaml-writer";
import { ArrowLeft, ArrowRight, ChevronDown, CircleAlert, Download, FileText } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { Button, Card, cx } from "../components/ui";
import { canRunLocally } from "../lib/data";
import { draftToConfig, officePlaces, saveBlockers, saveConfig, STEP, STEP_COUNT, stepBlocker, STEPS, type Draft, type SetupProgress } from "../lib/setup";
import { buildSuggestions } from "../lib/suggest";
import { ResumeStep } from "./ResumeStep";
import { HeadingLevel, IndustriesStep, industryLabel, LocationsStep, placeLabel, RolesStep, THRESHOLDS, ThresholdPicker } from "./steps";

type Props = {
  step: number;
  goStep: (n: number) => void;
  draft: Draft;
  update: (patch: Partial<Draft>) => void;
  /** A personal config already exists (re-running setup). */
  existing: boolean;
  configErrors?: string;
  startScan: () => Promise<void>;
  onSaved: () => Promise<void>;
  onFinish: () => void;
  /** Leave setup for the app; the draft is kept. */
  onExit: () => void;
  /** Welcome's primary button (marks the welcome as seen). */
  onStart: () => void;
  onStartOver: () => void;
  progress: SetupProgress;
  resumeText: string;
  saveResume: (text: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  removeResume: () => Promise<{ ok: true } | { ok: false; error: string }>;
};

const COPY: Record<number, { title: string; intro: string }> = {
  [STEP.resume]: { title: "Start with your resume", intro: "Optional. It fills in the next steps for you." },
  [STEP.roles]: { title: "What roles are you looking for?", intro: "Pick a job family, then the titles you want." },
  [STEP.locations]: { title: "Where do you want to work?", intro: "Jobs in other places are hidden." },
  [STEP.industries]: { title: "Which industries interest you?", intro: "Optional. Companies in these industries are scanned and suggested." },
  [STEP.review]: { title: "Review and save", intro: "Save to start finding your jobs." },
};

export function Wizard(props: Props) {
  const { step, goStep, draft, update, existing, configErrors, startScan, onSaved, onFinish, onExit, onStart, onStartOver, progress, resumeText, saveResume, removeResume } = props;
  const suggest = useMemo(() => buildSuggestions(resumeText, draft.aiProfile), [resumeText, draft.aiProfile]);
  const heading = useRef<HTMLHeadingElement>(null);

  // Each step is a new "page": name it in the tab title and move focus to its heading.
  useEffect(() => {
    const label = STEPS.find((s) => s.id === step)?.label;
    document.title = label ? `RawJobs · Setup · ${label}` : "RawJobs · Setup";
    heading.current?.focus();
  }, [step]);

  // Someone with a working setup has nothing to read on the Welcome: go straight to Review.
  const skipWelcome = step <= 0 && existing && !configErrors;
  useEffect(() => {
    if (skipWelcome) goStep(STEP.review);
  }, [skipWelcome, goStep]);
  if (skipWelcome) return null;

  if (step <= 0) {
    return <Welcome headingRef={heading} existing={existing} configErrors={configErrors} progress={progress} onStart={onStart} onStartOver={onStartOver} onExit={onExit} />;
  }

  const blocker = stepBlocker(step, draft);
  const optionalEmpty = step === STEP.industries && draft.industries.length === 0;
  return (
    <div className="mx-auto max-w-2xl">
      <Progress step={step} goStep={goStep} draft={draft} />
      <Card className="mt-4 p-5 sm:p-7">
        <h1 ref={heading} tabIndex={-1} className="type-heading font-semibold tracking-tight outline-none sm:type-title">
          {COPY[step]?.title}
        </h1>
        <p className="mt-1 type-small text-muted">{COPY[step]?.intro}</p>
        <HeadingLevel.Provider value={2}>
          <div className="mt-6">
            {step === STEP.resume && (
              <ResumeStep
                draft={draft}
                update={update}
                resumeText={resumeText}
                saveResume={saveResume}
                removeResume={removeResume}
                onSkip={() => goStep(STEP.roles)}
                onNext={() => goStep(STEP.roles)}
                footer={(primary) => <StepFooter onBack={() => goStep(step - 1)}>{primary}</StepFooter>}
              />
            )}
            {step === STEP.roles && <RolesStep draft={draft} update={update} suggest={suggest} />}
            {step === STEP.locations && <LocationsStep draft={draft} update={update} suggest={suggest} />}
            {step === STEP.industries && <IndustriesStep draft={draft} update={update} suggest={suggest} />}
            {step === STEP.review && (
              <Review
                draft={draft}
                update={update}
                goStep={goStep}
                startScan={startScan}
                onSaved={onSaved}
                onFinish={onFinish}
                hasResume={!!resumeText}
                footer={(primary) => <StepFooter onBack={() => goStep(step - 1)}>{primary}</StepFooter>}
              />
            )}
          </div>
        </HeadingLevel.Provider>
        {step > STEP.resume && step < STEP.review && (
          <StepFooter onBack={() => goStep(step - 1)} blocker={blocker}>
            <Button variant="primary" className="h-11 px-5 sm:h-10" onClick={() => goStep(step + 1)} disabled={!!blocker} aria-describedby={blocker ? "step-blocker" : undefined}>
              {optionalEmpty ? "Skip for now" : "Continue"} <ArrowRight className="size-4" />
            </Button>
          </StepFooter>
        )}
      </Card>
    </div>
  );
}

function StepFooter({ onBack, blocker, children }: { onBack: () => void; blocker?: string | null; children: ReactNode }) {
  return (
    // Sticky, so Continue is always on screen however long the step is.
    <footer className="sticky bottom-0 z-10 -mx-5 -mb-5 mt-8 flex items-center justify-between gap-3 rounded-b-md border-t border-line bg-raised/95 px-5 py-3 backdrop-blur sm:-mx-7 sm:-mb-7 sm:px-7 sm:py-4">
      <Button variant="ghost" className="h-11 sm:h-9" onClick={onBack}>
        <ArrowLeft className="size-4" /> Back
      </Button>
      <div className="flex min-w-0 flex-col items-end gap-1 sm:flex-row sm:items-center sm:gap-3">
        {blocker && (
          <span id="step-blocker" className="text-right type-small text-muted">
            {blocker}
          </span>
        )}
        {children}
      </div>
    </footer>
  );
}

function Progress({ step, goStep, draft }: { step: number; goStep: (n: number) => void; draft: Draft }) {
  // A step is reachable once every step before it is complete.
  const reachable = (n: number) => STEPS.filter((s) => s.id < n).every((s) => !stepBlocker(s.id, draft));
  return (
    <nav aria-label="Setup progress">
      <p className="text-right type-meta font-medium text-muted">
        Step {step} of {STEP_COUNT}
      </p>
      <ol className="mt-2 grid gap-1.5" style={{ gridTemplateColumns: `repeat(${STEPS.length}, minmax(0, 1fr))` }}>
        {STEPS.map((s) => (
          <li key={s.id}>
            <button
              type="button"
              disabled={!reachable(s.id)}
              onClick={() => goStep(s.id)}
              aria-current={s.id === step ? "step" : undefined}
              aria-label={`Step ${s.id}: ${s.label}`}
              className="group w-full text-left disabled:cursor-not-allowed"
            >
              <span className={cx("block h-1.5 rounded-0 transition-colors", s.id <= step ? "bg-ink" : "bg-line group-enabled:group-hover:bg-muted/40")} />
              <span className={cx("mt-1.5 block truncate type-small", s.id === step ? "font-semibold text-ink" : "text-muted")}>{s.label}</span>
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}

function Welcome({
  headingRef,
  existing,
  configErrors,
  progress,
  onStart,
  onStartOver,
  onExit,
}: {
  headingRef: RefObject<HTMLHeadingElement | null>;
  existing: boolean;
  configErrors?: string;
  progress: SetupProgress;
  onStart: () => void;
  onStartOver: () => void;
  onExit: () => void;
}) {
  const resuming = !existing && progress.started;
  return (
    <div className="mx-auto max-w-xl">
      <Card className="p-6 sm:p-9">
        <h1 ref={headingRef} tabIndex={-1} className="type-title font-semibold tracking-tight outline-none sm:type-title">
          {existing ? "Fix your setup" : resuming ? "Welcome back" : "Let's set up your job radar"}
        </h1>
        <p className="mt-2 text-muted">
          {existing
            ? "Walk through the steps and save to fix it."
            : resuming
              ? "Your answers are saved. Pick up where you left off."
              : "Pick the roles and places you want, and RawJobs finds matching jobs across thousands of companies. About a minute."}
        </p>
        {configErrors && (
          <div className="mt-5 rounded-md border border-warning/40 bg-warning-subtle/50 p-3 type-small">
            <p className="font-medium text-warning-text">Some saved settings couldn't be read. Everything readable is loaded.</p>
            <details className="mt-1">
              <summary className="cursor-pointer type-meta font-medium text-muted">Technical details</summary>
              <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap font-mono type-meta text-muted">{configErrors}</pre>
            </details>
          </div>
        )}
        <div className="mt-8 flex flex-wrap items-center gap-2">
          <Button variant="primary" className="h-11 px-5 type-body" onClick={onStart}>
            {existing ? "Review my setup" : resuming ? `Continue · step ${progress.nextStep} of ${STEP_COUNT}` : "Start setup"} <ArrowRight className="size-4" />
          </Button>
          {resuming && (
            <Button variant="ghost" className="h-11" onClick={onStartOver}>
              Start over
            </Button>
          )}
          <Button variant="ghost" className="h-11 sm:ml-auto" onClick={onExit}>
            {existing ? "Back to Radar" : "Skip for now"}
          </Button>
        </div>
      </Card>
    </div>
  );
}

const EDIT_LABEL: Record<number, string> = {
  [STEP.resume]: "resume",
  [STEP.roles]: "roles",
  [STEP.locations]: "places",
  [STEP.industries]: "industries",
};

const WORK_STYLE: Record<string, string> = { onsite: "on-site", hybrid: "hybrid" };
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Up to `max` names in bold, then "+N more". */
function some(names: string[], max = 4): ReactNode {
  return (
    <>
      <b>{names.slice(0, max).join(", ")}</b>
      {names.length > max && ` +${names.length - max} more`}
    </>
  );
}

function Review({
  draft,
  update,
  goStep,
  startScan,
  onSaved,
  onFinish,
  hasResume,
  footer,
}: {
  draft: Draft;
  update: (p: Partial<Draft>) => void;
  goStep: (n: number) => void;
  startScan: () => Promise<void>;
  onSaved: () => Promise<void>;
  onFinish: () => void;
  hasResume: boolean;
  footer: (primary: ReactNode) => ReactNode;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const blockers = saveBlockers(draft);
  const places = groupPlaces(officePlaces(draft)).map((g) => placeLabel(g.name));
  const remote = groupPlaces(draft.remoteOk).map((g) => (g.name === "remote" ? "anywhere" : placeLabel(g.name)));

  // biome-ignore lint/correctness/useExhaustiveDependencies: any change to the draft clears the last error
  useEffect(() => setError(null), [draft]);

  const saveAndScan = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await saveConfig(draftToConfig(draft));
      if (!res.ok) {
        setError(res.errors);
        setSaving(false);
        return;
      }
      await onSaved();
      // The scan runs in the background: the Radar shows its progress and fills in as jobs are found.
      void startScan();
      onFinish();
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
    }
  };

  const download = () => {
    const blob = new Blob([configToYaml(draftToConfig(draft))], { type: "text/yaml" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "rawjobs.config.local.yaml";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const lines: [number, ReactNode][] = [
    [
      STEP.resume,
      hasResume ? (
        <>
          <FileText className="mr-1 inline size-4 text-muted" aria-hidden />
          Using your <b>master resume</b> for suggestions.
        </>
      ) : (
        <span key="no-resume" className="text-muted">
          No resume added.
        </span>
      ),
    ],
    [
      STEP.roles,
      <>
        Look for {some(draft.include)}
        {draft.exclude.length > 0 && (
          <span className="text-muted">
            , never {draft.exclude.slice(0, 3).join(", ")}
            {draft.exclude.length > 3 && "…"}
          </span>
        )}
        .
      </>,
    ],
    [
      STEP.locations,
      <>
        {places.length > 0 && (
          <>
            {capitalize(draft.office.map((o) => WORK_STYLE[o]).join(" or "))} in {some(places)}
          </>
        )}
        {draft.remote && remote.length > 0 && (
          <>
            {places.length > 0 ? ", or remote" : "Remote"} in {some(remote, 3)}
          </>
        )}
        .
      </>,
    ],
    [
      STEP.industries,
      draft.industries.length ? (
        <>Also scan companies in {some(draft.industries.map(industryLabel), 6)}.</>
      ) : (
        <span key="no-industries" className="text-muted">
          No industries. Jobs are found by your roles and places.
        </span>
      ),
    ],
  ];

  return (
    <div className="space-y-6">
      <ul className="divide-y divide-line rounded-md border border-line">
        {lines.map(([n, text]) => (
          <li key={n} className="flex items-start gap-3 p-3 type-small">
            <span className="min-w-0 flex-1 leading-6">{text}</span>
            <Button size="sm" variant="ghost" onClick={() => goStep(n)} aria-label={`Edit ${EDIT_LABEL[n] ?? "this step"}`}>
              Edit
            </Button>
          </li>
        ))}
      </ul>

      <details className="group rounded-md border border-line">
        <summary className="flex cursor-pointer list-none items-center gap-2 p-3 type-label">
          <ChevronDown className="size-4 text-muted transition-transform group-open:rotate-180" />
          Match strictness
          <span className="ml-auto font-normal text-muted">{THRESHOLDS.find((t) => t.value === draft.minScore)?.label ?? `${draft.minScore}+`}</span>
        </summary>
        <div className="space-y-2 border-t border-line p-3">
          <p className="type-small text-muted">Strong matches are highlighted and sent in alerts.</p>
          <ThresholdPicker draft={draft} update={update} />
        </div>
      </details>

      {blockers.length > 0 && (
        <div className="rounded-md border border-warning/40 bg-warning-subtle/40 p-3 type-small">
          <p className="font-medium">Needed before you can save:</p>
          <ul className="mt-2 space-y-1.5">
            {blockers.map((b) => (
              <li key={b.step} className="flex items-center gap-2">
                <CircleAlert className="size-4 shrink-0 text-warning-text" />
                <span className="flex-1">{b.message}</span>
                <Button size="sm" variant="ghost" onClick={() => goStep(b.step)}>
                  Fix
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {error && (
        <div role="alert" className="rounded-md bg-danger-subtle/50 p-3 type-small text-danger-text">
          <p className="font-medium">Couldn't save your setup. Check the steps above, then try again.</p>
          <details className="mt-1">
            <summary className="cursor-pointer type-meta font-medium">Technical details</summary>
            <pre className="mt-1 whitespace-pre-wrap font-mono type-meta">{error}</pre>
          </details>
        </div>
      )}

      {!canRunLocally && (
        <p className="type-small text-muted">
          This dashboard is hosted, so it can't save files. Download the config and save it in the app's folder as <code className="font-mono type-small">rawjobs.config.local.yaml</code>. It stays on
          your computer; don't commit it.
        </p>
      )}

      {footer(
        canRunLocally ? (
          <Button variant="primary" className="h-11 px-5 type-body sm:h-10" onClick={() => void saveAndScan()} disabled={saving || blockers.length > 0}>
            {saving ? "Saving…" : "Save & find my jobs"} <ArrowRight className="size-4" />
          </Button>
        ) : (
          <Button onClick={download}>
            <Download className="size-4" /> Download config file
          </Button>
        ),
      )}
    </div>
  );
}

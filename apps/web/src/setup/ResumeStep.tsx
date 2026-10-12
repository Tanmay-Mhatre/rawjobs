import { parseAiAnswer, type AiProfile, type ParsedAnswer } from "@rawjobs/core/resume-parse";
import { ArrowRight, Check, ClipboardCopy, ExternalLink, FileText, Files, LoaderCircle, SkipForward, Sparkles, TriangleAlert, Upload, Wand2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Dialog } from "../components/Dialog";
import { Kbd } from "../components/primitives";
import { Button, Card, cx } from "../components/ui";
import { copyText } from "../lib/clipboard";
import { canRunLocally } from "../lib/data";
import { extractResumeText } from "../lib/extract";
import { displayPlace } from "../lib/format";
import { STEP, type Draft } from "../lib/setup";
import { buildSuggestions, prefillDraft } from "../lib/suggest";
import { MASTER_RESUME_PROMPT } from "./prompt";
import { ClearButton, industryLabel } from "./steps";

type Mode = "single" | "ai" | null;
type SaveResult = { ok: true } | { ok: false; error: string };

type Props = {
  draft: Draft;
  update: (patch: Partial<Draft>) => void;
  resumeText: string;
  saveResume: (text: string) => Promise<SaveResult>;
  /** Delete the saved resume. Without it there's no Remove button. */
  removeResume?: () => Promise<SaveResult>;
  /** Skip ahead to the manual steps (wizard only). */
  onSkip?: () => void;
  onNext?: () => void;
  /** In Settings there's nowhere to skip to. */
  hideSkip?: boolean;
  /**
   * Wizard only: renders the step footer around this step's primary button ("Save & continue", "Continue" or
   * "Skip for now"), and resume suggestions fill still-empty steps automatically. Without it (Settings)
   * saving stays in the panel and prefilling is a button.
   */
  footer?: (primary: ReactNode) => ReactNode;
};

const MIN_WORDS = 30;
const MIN_WORDS_HINT_ID = "resume-min-words";
const words = (s: string) => (s.trim() ? s.trim().split(/\s+/).length : 0);

const FILL_LABELS: [keyof Draft, string][] = [
  ["include", "roles"],
  ["places", "places"],
  ["remoteOk", "remote regions"],
  ["industries", "industries"],
  ["keywords", "topics"],
  ["pastEmployers", "past employers"],
];
/** "roles, places and topics" for the steps a prefill patch fills. */
function filledText(patch: Partial<Draft>): string {
  const names = FILL_LABELS.filter(([k]) => k in patch).map(([, l]) => l);
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : (names[0] ?? "");
}

export function ResumeStep({ draft, update, resumeText, saveResume, removeResume, onSkip, onNext, hideSkip, footer }: Props) {
  const wizard = !!footer;
  const [mode, setMode] = useState<Mode>(null);
  const [replacing, setReplacing] = useState(false);
  const [text, setText] = useState("");
  const [answer, setAnswer] = useState("");
  const { saving, error, run } = useSaving();
  /** What the automatic prefill filled ("roles, places and topics"), once it ran. */
  const [filled, setFilled] = useState<string | null>(null);
  const prefilled = useRef(false);
  const hasResume = !!resumeText && !replacing;
  const parsed = useMemo(() => (answer.trim().length > 50 ? parseAiAnswer(answer) : null), [answer]);

  /** Wizard: fill the steps that are still empty from this resume. Never overwrites a choice. */
  const prefill = (resume: string, aiProfile: AiProfile | undefined, base: Draft) => {
    prefilled.current = true;
    const patch = prefillDraft({ ...base, aiProfile }, buildSuggestions(resume, aiProfile));
    update(patch);
    setFilled(filledText(patch));
  };

  const saveSingle = async (): Promise<SaveResult> => {
    const res = await saveResume(text);
    if (res.ok) {
      update({ aiProfile: undefined });
      if (wizard) prefill(text, undefined, draft);
      setReplacing(false);
    }
    return res;
  };
  const saveAi = async (p: ParsedAnswer): Promise<SaveResult> => {
    const res = await saveResume(p.resume);
    if (res.ok) {
      update({ aiProfile: p.profile });
      if (wizard) prefill(p.resume, p.profile, draft);
      setReplacing(false);
    }
    return res;
  };

  // What's typed or pasted but not saved yet.
  const pending =
    mode === "single" && text.trim()
      ? { ok: words(text) >= MIN_WORDS, save: saveSingle }
      : mode === "ai" && answer.trim()
        ? { ok: !!parsed && words(parsed.resume) >= MIN_WORDS, save: () => saveAi(parsed!) }
        : null;
  const tooShort = mode === "single" && !!text.trim() && words(text) < MIN_WORDS;

  let primary: ReactNode = null;
  if (wizard) {
    if (pending) {
      primary = (
        <Button
          variant="primary"
          className="h-11 px-5 sm:h-10"
          disabled={!pending.ok || saving}
          aria-describedby={tooShort ? MIN_WORDS_HINT_ID : undefined}
          onClick={() =>
            void run(async () => {
              const res = await pending.save();
              if (res.ok) onNext?.();
              return res;
            })
          }
        >
          {saving ? <LoaderCircle className="size-4 animate-spin" /> : null}
          {saving ? "Saving…" : "Save & continue"} <ArrowRight className="size-4" />
        </Button>
      );
    } else {
      const skip = !resumeText;
      primary = (
        <Button variant="primary" className="h-11 px-5 sm:h-10" onClick={skip ? onSkip : onNext}>
          {skip ? "Skip for now" : "Continue"} <ArrowRight className="size-4" />
        </Button>
      );
    }
  }

  return (
    <div className="space-y-6">
      {hasResume ? (
        <SavedResume
          text={resumeText}
          draft={draft}
          update={update}
          onReplace={() => {
            setReplacing(true);
            setMode(null);
            setFilled(null);
            prefilled.current = false;
          }}
          onRemove={
            removeResume &&
            (async () => {
              const res = await removeResume();
              if (res.ok) {
                // The AI profile came from this resume; answers it filled in stay.
                update({ aiProfile: undefined });
                setMode(null);
                setText("");
                setAnswer("");
                setFilled(null);
                prefilled.current = false;
              }
              return res;
            })
          }
          auto={wizard}
          filled={filled}
          // First time through the wizard with a resume saved earlier: prefill once on arrival.
          onArrive={() => {
            if (wizard && !prefilled.current && (draft.furthestStep ?? 0) <= STEP.resume) prefill(resumeText, draft.aiProfile, draft);
          }}
        />
      ) : (
        <>
          <div className={cx("grid gap-3", hideSkip ? "sm:grid-cols-2" : "sm:grid-cols-3")}>
            <ModeCard
              active={mode === "single"}
              icon={<FileText className="size-5" />}
              title="I have one resume"
              body="Choose a PDF or Word file, or paste the text."
              onClick={() => setMode("single")}
            />
            <ModeCard
              active={mode === "ai"}
              icon={<Files className="size-5" />}
              title="I have several resumes"
              body="Merge them into one master resume with Claude or ChatGPT."
              onClick={() => setMode("ai")}
            />
            {!hideSkip && onSkip && <ModeCard active={false} icon={<SkipForward className="size-5" />} title="Skip for now" body="Fill in your roles and places yourself." onClick={onSkip} />}
          </div>
          {mode === "single" && (
            <SinglePath
              text={text}
              setText={setText}
              tooShort={tooShort}
              // Settings saves in the panel; the wizard saves from its footer.
              save={wizard ? undefined : { saving, error, onSave: () => void run(saveSingle) }}
            />
          )}
          {mode === "ai" && <AiPath answer={answer} setAnswer={setAnswer} parsed={parsed} save={wizard ? undefined : { saving, error, onSave: () => parsed && void run(() => saveAi(parsed)) }} />}
          {wizard && error && (
            <p role="alert" className="type-small text-danger-text">
              Couldn't save your resume. {error}
            </p>
          )}
          {resumeText && replacing && (
            <button
              type="button"
              className="type-label text-ink underline underline-offset-2 hover:text-muted"
              onClick={() => {
                setReplacing(false);
                setMode(null);
                setText("");
                setAnswer("");
              }}
            >
              Keep my saved resume instead
            </button>
          )}
        </>
      )}
      <p className="type-small text-muted">{canRunLocally ? "Your resume stays on this computer. It's never uploaded." : "Your resume is kept in this browser only. It's never uploaded."}</p>
      {footer?.(primary)}
    </div>
  );
}

function ModeCard({ active, icon, title, body, onClick }: { active: boolean; icon: ReactNode; title: string; body: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cx("flex flex-col items-start gap-2 rounded-md border p-4 text-left transition-colors", active ? "border-ink bg-active" : "border-line hover:bg-inset")}
    >
      <span className={cx("flex size-9 items-center justify-center rounded-md", active ? "bg-ink text-raised" : "bg-inset text-muted")}>{icon}</span>
      <span className="type-small font-semibold">{title}</span>
      <span className="type-small text-muted">{body}</span>
    </button>
  );
}

function useSaving() {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<SaveResult>) => {
    setSaving(true);
    setError(null);
    try {
      const res = await fn();
      if (!res.ok) setError(res.error);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };
  return { saving, error, run };
}

/** In-panel save button (Settings only; the wizard saves from its footer). */
type PanelSave = { saving: boolean; error: string | null; onSave: () => void };

function SinglePath({ text, setText, tooShort, save }: { text: string; setText: (t: string) => void; tooShort: boolean; save?: PanelSave }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<{ state: "idle" | "reading" | "done" | "error"; name?: string; message?: string }>({ state: "idle" });

  const onFile = async (f: File | undefined) => {
    if (fileRef.current) fileRef.current.value = "";
    if (!f) return;
    setFile({ state: "reading", name: f.name });
    try {
      const { text: extracted, note } = await extractResumeText(f);
      setText(extracted);
      setFile({ state: "done", name: f.name, message: note });
    } catch (err) {
      setFile({ state: "error", name: f.name, message: (err as Error).message });
    }
  };

  return (
    <div className="space-y-3 rounded-md border border-line p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="type-small font-semibold">Paste your resume</p>
        <Button size="sm" onClick={() => fileRef.current?.click()} disabled={file.state === "reading"}>
          {file.state === "reading" ? <LoaderCircle className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
          {file.state === "reading" ? "Reading…" : "Choose a file (PDF, Word or text)"}
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,application/pdf,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.doc,.md,.markdown,.txt,text/plain,text/markdown"
          className="hidden"
          aria-label="Choose a resume file"
          onChange={(e) => void onFile(e.target.files?.[0])}
        />
      </div>
      <p className="type-small text-muted">PDF, Word (.docx), Markdown or text. The file is read on this computer and never uploaded.</p>
      {file.state === "error" && <p className="rounded-md bg-warning-subtle/50 p-2.5 type-small text-warning-text">{file.message}</p>}
      {file.state === "done" && (
        <p className="rounded-md bg-success-subtle p-2.5 type-small text-success-text">
          <Check className="mr-1 inline size-4" aria-hidden />
          Read <b>{file.name}</b>.{file.message ? ` ${file.message}` : ` Check the text below, then save.`}
        </p>
      )}
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={10}
        aria-label="Your resume"
        aria-describedby={tooShort ? MIN_WORDS_HINT_ID : undefined}
        placeholder={"Paste your full resume here, or choose a file above.\n\nPlain text or Markdown both work."}
        className="w-full resize-y rounded-md border border-line bg-raised p-3 font-mono type-small placeholder:font-sans placeholder:text-muted"
      />
      <div className="flex flex-wrap items-center gap-3">
        {save && (
          <Button variant="primary" onClick={save.onSave} disabled={save.saving || words(text) < MIN_WORDS} aria-describedby={tooShort ? MIN_WORDS_HINT_ID : undefined}>
            {save.saving ? <LoaderCircle className="size-4 animate-spin" /> : <Check className="size-4" />} Save resume
          </Button>
        )}
        <span className="type-meta text-muted">{words(text) ? `${words(text)} words` : ""}</span>
        <ClearButton count={text.trim() ? 1 : 0} noun={["pasted text", "pasted text"]} message="Cleared the pasted text." onClear={() => setText("")} onUndo={() => setText(text)} />
        {tooShort && (
          <span id={MIN_WORDS_HINT_ID} className="type-small text-muted">
            Add a bit more: at least {MIN_WORDS} words are needed to suggest roles.
          </span>
        )}
        {save?.error && <span className="type-small text-danger-text">{save.error}</span>}
      </div>
    </div>
  );
}

function AiPath({ answer, setAnswer, parsed, save }: { answer: string; setAnswer: (a: string) => void; parsed: ParsedAnswer | null; save?: PanelSave }) {
  const [copied, setCopied] = useState<"no" | "yes" | "manual">("no");
  const [showPrompt, setShowPrompt] = useState(false);
  const promptRef = useRef<HTMLTextAreaElement>(null);

  const copy = async () => {
    if (await copyText(MASTER_RESUME_PROMPT)) {
      setCopied("yes");
      setTimeout(() => setCopied("no"), 2000);
      return;
    }
    // Clipboard blocked: show the prompt selected so Ctrl/Cmd+C works.
    setCopied("manual");
    setShowPrompt(true);
    setTimeout(() => {
      promptRef.current?.focus();
      promptRef.current?.select();
    }, 50);
  };

  return (
    <ol className="space-y-4 rounded-md border border-line p-4">
      <Step n={1} title="Copy the prompt">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" onClick={() => void copy()}>
            {copied === "yes" ? <Check className="size-4" /> : <ClipboardCopy className="size-4" />}
            {copied === "yes" ? "Copied" : "Copy prompt"}
          </Button>
          <button type="button" className="type-label text-ink underline underline-offset-2 hover:text-muted" onClick={() => setShowPrompt((v) => !v)} aria-expanded={showPrompt}>
            {showPrompt ? "Hide the prompt" : "See the prompt"}
          </button>
        </div>
        {copied === "manual" && (
          <p className="mt-2 type-small text-warning-text">
            Your browser blocked copying. The prompt is selected below: press <Kbd>Ctrl</Kbd> <Kbd>C</Kbd> (<Kbd>⌘</Kbd> <Kbd>C</Kbd> on Mac).
          </p>
        )}
        {showPrompt && (
          <textarea
            ref={promptRef}
            readOnly
            value={MASTER_RESUME_PROMPT}
            rows={10}
            aria-label="The prompt"
            onFocus={(e) => e.currentTarget.select()}
            className="mt-2 w-full resize-y rounded-md border border-line bg-inset p-3 font-mono type-small text-muted"
          />
        )}
      </Step>
      <Step n={2} title="Run it in your own AI assistant">
        <p className="type-small text-muted">Open one in a new tab, attach all your resumes (PDF and Word are fine), paste the prompt and send.</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <a href="https://claude.ai/new" target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-1.5 rounded-md border border-line px-3 type-label hover:bg-inset">
            Open Claude <ExternalLink className="size-3.5" />
          </a>
          <a href="https://chatgpt.com/" target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-1.5 rounded-md border border-line px-3 type-label hover:bg-inset">
            Open ChatGPT <ExternalLink className="size-3.5" />
          </a>
        </div>
      </Step>
      <Step n={3} title="Paste the whole answer here">
        <textarea
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          rows={8}
          aria-label="The AI's answer"
          placeholder="Paste everything it wrote, including the JSON block at the end."
          className="w-full resize-y rounded-md border border-line bg-raised p-3 font-mono type-small placeholder:font-sans placeholder:text-muted"
        />
        {parsed && (
          <div className="mt-2 rounded-md bg-inset/60 p-3 type-small">
            <p className="font-medium">
              <Wand2 className="mr-1 inline size-4 text-muted" aria-hidden />
              Found: master resume ({words(parsed.resume).toLocaleString()} words)
              {parsed.profile ? (
                <>
                  {" "}
                  · {parsed.profile.target_titles.length} target titles · {parsed.profile.locations.length} places · {Object.keys(parsed.profile.keywords).length} topics
                </>
              ) : (
                " · no profile block (details are suggested from the text)"
              )}
            </p>
            {parsed.warnings.map((w) => (
              <p key={w} className="mt-1 type-small text-warning-text">
                {w}
              </p>
            ))}
          </div>
        )}
        {save && (
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Button variant="primary" onClick={save.onSave} disabled={!parsed || save.saving || words(parsed.resume) < MIN_WORDS}>
              {save.saving ? <LoaderCircle className="size-4 animate-spin" /> : <Check className="size-4" />} Save master resume
            </Button>
            {save.error && <span className="type-small text-danger-text">{save.error}</span>}
          </div>
        )}
      </Step>
    </ol>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-sm bg-inset type-label text-ink">{n}</span>
      <div className="min-w-0 flex-1">
        <p className="mb-1.5 type-small font-semibold">{title}</p>
        {children}
      </div>
    </li>
  );
}

function SavedResume({
  text,
  draft,
  update,
  onReplace,
  onRemove,
  auto,
  filled,
  onArrive,
}: {
  text: string;
  draft: Draft;
  update: (p: Partial<Draft>) => void;
  onReplace: () => void;
  onRemove?: () => Promise<SaveResult>;
  /** Wizard: suggestions were (or are about to be) applied automatically. */
  auto: boolean;
  filled: string | null;
  onArrive: () => void;
}) {
  const [applied, setApplied] = useState(false);
  const suggest = useMemo(() => buildSuggestions(text, draft.aiProfile), [text, draft.aiProfile]);
  const patch = useMemo(() => prefillDraft(draft, suggest), [draft, suggest]);
  const fills = Object.keys(patch).filter((k) => k !== "remoteExclude");
  // Topics alone are shown in Settings; with no titles, places or industries there is nothing to show here.
  const nothing = !suggest.titles.length && !suggest.places.length && !suggest.industries.length && !(suggest.remote && suggest.remoteRegions.length);
  const firstLine =
    text
      .split("\n")
      .find((l) => l.trim())
      ?.replace(/^#+\s*/, "") ?? "Resume";

  useEffect(() => onArrive(), []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 rounded-md border border-line p-4">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-inset text-muted">
          <FileText className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{firstLine}</p>
          <p className="type-small text-muted">
            Master resume saved · {words(text).toLocaleString()} words{draft.aiProfile ? " · with AI profile" : ""}
          </p>
          <details className="mt-1 type-small">
            <summary className="cursor-pointer font-medium text-ink underline underline-offset-2 hover:text-muted">View</summary>
            <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded-md bg-inset p-3 font-mono type-small text-muted">{text}</pre>
          </details>
        </div>
        <div className="flex shrink-0 flex-col gap-1 sm:flex-row">
          <Button size="sm" onClick={onReplace}>
            Replace
          </Button>
          {onRemove && <RemoveResume onRemove={onRemove} />}
        </div>
      </div>

      {suggest.template ? (
        <div role="status" className="flex items-start gap-2 rounded-md bg-warning-subtle/50 p-3 type-small text-warning-text">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p>
            This looks like an empty resume template (it still has placeholders like {suggest.template.slice(0, 2).join(" and ")}), so nothing is filled in from it. Replace it with your filled-in
            resume, or pick everything yourself in the next steps.
          </p>
        </div>
      ) : nothing ? (
        <p className="type-small text-muted">Couldn't find job titles or places in this resume. You'll pick them in the next steps.</p>
      ) : (
        <div className="rounded-md border border-line bg-inset p-4">
          <p className="flex items-center gap-1.5 type-small font-semibold">
            <Sparkles className="size-4 text-muted" aria-hidden /> {suggest.source === "ai" ? "From your master resume" : "Suggested from your resume"}
          </p>
          <dl className="mt-2 grid gap-x-4 gap-y-1.5 type-small sm:grid-cols-[110px_1fr]">
            <Row label="Titles" items={suggest.titles} />
            <Row label="Places" items={suggest.places.map(displayPlace)} />
            {suggest.remote && <Row label="Remote" items={suggest.remoteRegions.map(displayPlace)} />}
            <Row label="Industries" items={suggest.industries.map(industryLabel)} />
            <Row label="Topics" items={suggest.keywords.map(([k]) => k)} />
          </dl>
          {auto ? (
            <p role="status" className="mt-3 flex items-start gap-1.5 type-label text-ink">
              <Check className="mt-0.5 size-4 shrink-0" />
              {filled ? `Pre-filled ${filled} from your resume. You can change anything.` : "Suggestions appear next to each step. Nothing you chose is overwritten."}
            </p>
          ) : applied ? (
            <p className="mt-3 flex items-center gap-1.5 type-label text-ink">
              <Check className="size-4" /> Added. You can review and change everything below.
            </p>
          ) : fills.length ? (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button
                variant="primary"
                onClick={() => {
                  update(patch);
                  setApplied(true);
                }}
              >
                <Wand2 className="size-4" /> Fill empty sections from my resume
              </Button>
              <span className="type-small text-muted">Nothing you chose is overwritten.</span>
            </div>
          ) : (
            <p className="mt-3 type-small text-muted">Suggestions appear next to each step for you to add.</p>
          )}
        </div>
      )}
    </div>
  );
}

function Row({ label, items }: { label: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <>
      <dt className="text-muted">{label}</dt>
      <dd className="text-ink">
        {items.slice(0, 10).join(" · ")}
        {items.length > 10 && <span className="text-muted"> · +{items.length - 10} more</span>}
      </dd>
    </>
  );
}

/** "Remove" for the saved resume, behind a confirmation: the file can't be brought back. */
function RemoveResume({ onRemove }: { onRemove: () => Promise<SaveResult> }) {
  const [asking, setAsking] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = async () => {
    setWorking(true);
    setError(null);
    const res = await onRemove();
    setWorking(false);
    if (res.ok) setAsking(false);
    else setError(res.error);
  };

  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setAsking(true)}>
        Remove
      </Button>
      <Dialog open={asking} onClose={() => !working && setAsking(false)} labelledBy="remove-resume-title" initialFocus="[data-autofocus]">
        <Card className="p-5 shadow-l3 sm:p-6">
          <h2 id="remove-resume-title" className="type-subheading font-semibold">
            Remove your saved resume?
          </h2>
          <p className="mt-1 type-small text-muted">The resume is deleted from {canRunLocally ? "this computer" : "this browser"}. Roles, places and other answers it filled in stay as they are.</p>
          {error && (
            <p role="alert" className="mt-2 type-small text-danger-text">
              Couldn't remove the resume. {error}
            </p>
          )}
          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="ghost" onClick={() => setAsking(false)} disabled={working} data-autofocus>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => void confirm()} disabled={working}>
              {working ? "Removing…" : "Remove resume"}
            </Button>
          </div>
        </Card>
      </Dialog>
    </>
  );
}

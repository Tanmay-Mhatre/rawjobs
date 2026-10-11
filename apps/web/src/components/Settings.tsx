import { INDUSTRY_BY_ID } from "@rawjobs/core/catalog/industries";
import { groupPlaces } from "@rawjobs/core/catalog/places";
import { ArrowRight, Download, RefreshCw, RotateCcw, Save, Upload, X } from "lucide-react";
import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { canRunLocally, useDirectorySize } from "../lib/data";
import { displayPlace, roughCount } from "../lib/format";
import { draftToConfig, officePlaces, saveBlockers, saveConfig, type Draft } from "../lib/setup";
import type { Suggestions } from "../lib/suggest";
import { ResumeStep } from "../setup/ResumeStep";
import { offerWhat, ruleKey, ruleLabel, type HideRule } from "../lib/notForMe";
import type { Prefs } from "../lib/prefs";
import { MAX_AGE_CHOICES, setDensityChoice, setMaxAgeChoice, useDensity, useMaxAge, useTheme, type Density, type MaxAge, type ThemeChoice } from "../lib/theme";
import { exportState, readStateFile, type UserState } from "../lib/userState";
import { IndustriesStep, KeywordsStep, LocationsStep, RolesStep, ThresholdPicker } from "../setup/steps";
import { Dialog } from "./Dialog";
import { ScanPrefsPicker } from "./ScanButton";
import { ScheduledScans } from "./ScheduledScans";
import { TelegramAlerts } from "./TelegramAlerts";
import { Button, Card, cx, IconButton, Segmented, Toggle } from "./ui";

type Props = {
  draft: Draft;
  update: (patch: Partial<Draft>) => void;
  /** Throw away unsaved edits (reload from the saved config). */
  revert: () => void;
  dirty: boolean;
  onSaved: () => Promise<void>;
  onScan: () => void;
  scanning: boolean;
  user: UserState;
  prefs: Prefs;
  onImport: (s: UserState, prefs?: Partial<Prefs>) => void;
  /** Stop a Not interested rule hiding jobs. */
  onRemoveRule?: (rule: HideRule) => void;
  suggest: Suggestions;
  resumeText: string;
  saveResume: (text: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  removeResume: () => Promise<{ ok: true } | { ok: false; error: string }>;
  toCompanies: () => void;
  /** Clear the saved setup and open the wizard again; an error message, or null. Only on a saved local setup. */
  onStartOver?: () => Promise<string | null>;
};

/** The sticky section nav. Each group is `#settings-{id}`; "#settings?section=…" deep-links to a group or a section in it. */
const GROUPS = [
  { id: "profile", label: "Profile" },
  { id: "my-companies", label: "My companies" },
  { id: "scans", label: "Scans & alerts" },
  { id: "data", label: "Your data" },
  { id: "appearance", label: "Appearance" },
] as const;
type GroupId = (typeof GROUPS)[number]["id"];

/** "a, b, c +2", or "" when empty. */
const list = (xs: string[], n = 3) => (xs.length ? xs.slice(0, n).join(", ") + (xs.length > n ? ` +${xs.length - n}` : "") : "");

const sectionFromHash = () => new URLSearchParams(location.hash.split("?")[1] ?? "").get("section");
const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** Edit any part of the setup after the wizard, then save (and scan). */
export function Settings({ draft, update, revert, dirty, onSaved, onScan, scanning, user, prefs, onImport, onRemoveRule, suggest, resumeText, saveResume, removeResume, toCompanies, onStartOver }: Props) {
  const [status, setStatus] = useState<{ tone: "ok" | "bad"; text: string; detail?: string; retry?: boolean } | null>(null);
  const [saving, setSaving] = useState(false);
  const lastSave = useRef(false);
  const blockers = saveBlockers(draft).map((b) => b.message);
  const directorySize = useDirectorySize();

  // One-line summaries for the Profile sections; an empty one starts open so there's something to fill in.
  const summaries: Record<string, string> = {
    resume: resumeText.trim() ? "Saved" : "",
    roles: list(draft.include),
    locations: list([...groupPlaces(officePlaces(draft)).map((g) => displayPlace(g.name)), ...(draft.remote ? ["Remote"] : [])]),
    industries: list(draft.industries.map((id) => INDUSTRY_BY_ID.get(id)?.label ?? id)),
    keywords: list(Object.keys(draft.keywords)),
  };
  const [open, setOpen] = useState<Set<string>>(() => new Set(Object.keys(summaries).filter((k) => !summaries[k])));
  const toggle = (id: string) =>
    setOpen((o) => {
      const next = new Set(o);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const active = useActiveGroup();
  // "#settings?section=schedule" (from the Radar's checklist): open and scroll to that section.
  useEffect(() => {
    const go = () => {
      const id = sectionFromHash();
      if (!id) return;
      if (id in summaries) setOpen((o) => new Set(o).add(id));
      // After the tab has rendered (and anything that scrolls to the top on a tab change).
      setTimeout(() => document.getElementById(`settings-${id}`)?.scrollIntoView({ block: "start" }), 60);
    };
    go();
    window.addEventListener("hashchange", go);
    return () => window.removeEventListener("hashchange", go);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (dirty) setStatus(null);
  }, [dirty]);

  const save = async (thenScan: boolean) => {
    lastSave.current = thenScan;
    setSaving(true);
    try {
      const res = await saveConfig(draftToConfig(draft));
      if (!res.ok) return setStatus({ tone: "bad", text: "Couldn't save your settings. Check the sections above, then try again.", detail: res.errors, retry: true });
      await onSaved();
      setStatus({ tone: "ok", text: thenScan ? "Saved. Scanning with your new settings…" : "Saved. Changes apply from the next scan." });
      if (thenScan) onScan();
    } catch (err) {
      setStatus({ tone: "bad", text: "Couldn't save your settings. Make sure RawJobs is still running on this computer, then try again.", detail: (err as Error).message, retry: true });
    } finally {
      setSaving(false);
    }
  };

  const profile = (id: string, title: string, hint: string, children: ReactNode) => (
    <Section id={id} title={title} hint={hint} summary={summaries[id] || "Not set"} expanded={open.has(id)} onToggle={() => toggle(id)}>
      {children}
    </Section>
  );

  return (
    <div className="md:grid md:grid-cols-[11rem_minmax(0,1fr)] md:items-start md:gap-6">
      <SettingsNav active={active} />
      <div className="space-y-8">
        <Group id="profile" label="Profile">
          {profile("resume", "Master resume", "Saved on this computer only.", <ResumeStep draft={draft} update={update} resumeText={resumeText} saveResume={saveResume} removeResume={removeResume} hideSkip />)}
          {profile("roles", "Roles", "Only jobs whose title matches are shown.", <RolesStep draft={draft} update={update} suggest={suggest} />)}
          {profile("locations", "Locations", "Jobs outside these places are hidden.", <LocationsStep draft={draft} update={update} suggest={suggest} />)}
          {profile("industries", "Industries", "Industries decide which companies are scanned and suggested.", <IndustriesStep draft={draft} update={update} suggest={suggest} />)}
          {profile("keywords", "Topics", "Topics rank jobs higher when they mention them.", <KeywordsStep draft={draft} update={update} suggest={suggest} resumeText={resumeText} />)}
        </Group>

        <Group id="my-companies" label="My companies">
          <Section id="companies" title="My companies" hint="Companies you'd love to work at: scanned every time, starred on your Radar, and their newest jobs shown on top.">
            <div className="flex flex-wrap items-center gap-3">
              <p className="type-small">
                You've picked <b className="tabular">{draft.companies.length}</b> compan{draft.companies.length === 1 ? "y" : "ies"}
                {draft.muted.length > 0 && <> and hidden {draft.muted.length}</>}.
              </p>
              <Button size="sm" onClick={toCompanies}>
                Manage in Companies tab <ArrowRight className="size-3.5" />
              </Button>
            </div>
          </Section>
        </Group>

        <Group id="scans" label="Scans & alerts">
          <Section id="threshold" title="Strong match threshold" hint="Strong matches get a highlighted score on your Radar and are sent in Telegram alerts.">
            <ThresholdPicker draft={draft} update={update} />
          </Section>
          {canRunLocally && (
            <>
              <Section id="schedule" title="Scheduled scans" hint="Scan automatically every day at the times you pick. Saved right away.">
                <ScheduledScans />
              </Section>
              <Section id="alerts" title="Telegram alerts" hint="Get new jobs from scheduled scans on your phone. Saved right away.">
                <TelegramAlerts onChanged={onSaved} />
              </Section>
            </>
          )}
          <Section
            id="directory"
            title="How scans work"
            hint={`The shared company directory lists ${directorySize ? roughCount(directorySize) : "~21,000"} companies and where each one posts jobs. Jobs are always fetched live by your own scans; nothing about you is sent.`}
          >
            <div className="space-y-3">
              <ul className="space-y-1.5 type-small">
                <li>
                  <b>{draft.industries.length ? "My companies + my industries" : "My companies"}</b>
                  <span className="text-muted">
                    {draft.industries.length ? ": My companies, plus every company in the directory tagged with your industries. A few minutes." : ": the companies you've added. Add industries above to scan more. A few minutes."}
                  </span>
                </li>
                <li>
                  <b>All companies</b>
                  <span className="text-muted">: every company in the directory that RawJobs can scan. The daily job feed skips companies with nothing for you, so usually minutes; up to 2 hours without it. Stop any time and it carries on later.</span>
                </li>
              </ul>
              <p className="type-small text-muted">Every scan first updates the company directory, so new companies and moved careers pages are picked up.</p>
              <ScanPrefsPicker />
              <Toggle checked={draft.directory.auto_update} onChange={(v) => update({ directory: { ...draft.directory, auto_update: v } })}>
                Also update the company directory in the background when the app starts
              </Toggle>
            </div>
          </Section>
        </Group>

        <Group id="data" label="Your data">
          <TrackingData user={user} prefs={prefs} onImport={onImport} onRemoveRule={onRemoveRule} />
          <Section id="sharing" title="Sharing" hint="Help everyone find more companies. On by default; turn it off here.">
            <div className="space-y-2">
              <Toggle checked={draft.directory.share_additions} onChange={(v) => update({ directory: { ...draft.directory, share_additions: v } })}>
                Share companies I add by link with everyone
              </Toggle>
              <p className="type-small text-muted">
                Only the careers link is shared: the company's name, its hiring system and its board name. Never your profile, resume, searches or which jobs you look at.{" "}
                <a href="https://github.com/Tanmay-Mhatre/rawjobs/blob/main/PRIVACY.md" target="_blank" rel="noreferrer" className="font-medium text-ink underline underline-offset-2 hover:text-muted">
                  What is sent, and where
                </a>
              </p>
            </div>
          </Section>
          {onStartOver && (
            <Section
              id="reset"
              title="Start setup over"
              hint="Clears your setup answers: profile, roles, places, keywords and companies. Your tracked jobs, notes, saved views, resume and Telegram alerts stay."
            >
              <StartOver onStartOver={onStartOver} />
            </Section>
          )}
        </Group>

        <Group id="appearance" label="Appearance">
          <AppearanceSection />
        </Group>

        {canRunLocally && (dirty || status) && (
          <div className="sticky bottom-16 z-10 rounded-md border border-line bg-raised/95 p-3 shadow-l2 backdrop-blur md:bottom-4">
            {status && (
              <div role={status.tone === "bad" ? "alert" : "status"} className="mb-2 type-small">
                <p className={status.tone === "ok" ? "text-success-text" : "text-danger-text"}>{status.text}</p>
                {status.detail && (
                  <details className="mt-1 type-meta text-muted">
                    <summary className="cursor-pointer">Technical details</summary>
                    <pre className="mt-1 whitespace-pre-wrap font-mono">{status.detail}</pre>
                  </details>
                )}
                {status.retry && !dirty && (
                  <Button size="sm" variant="ghost" className="mt-1" onClick={() => void save(lastSave.current)} disabled={saving}>
                    <RefreshCw className="size-3.5" /> Try again
                  </Button>
                )}
              </div>
            )}
            {dirty && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="mr-auto type-small text-muted">{blockers[0] ?? "You have unsaved changes."}</span>
                <Button variant="ghost" onClick={revert} disabled={saving}>
                  Discard
                </Button>
                <Button onClick={() => void save(false)} disabled={saving || blockers.length > 0}>
                  <Save className="size-4" /> Save
                </Button>
                <Button variant="primary" onClick={() => void save(true)} disabled={saving || scanning || blockers.length > 0}>
                  <RefreshCw className="size-4" /> Save & scan
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** Which group is at the top of the screen, for aria-current in the nav. */
function useActiveGroup(): GroupId {
  const [active, setActive] = useState<GroupId>("profile");
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const visible = new Set<string>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const id = e.target.id.replace(/^settings-/, "");
          if (e.isIntersecting) visible.add(id);
          else visible.delete(id);
        }
        const first = GROUPS.find((g) => visible.has(g.id));
        if (first) setActive(first.id);
      },
      // A band just below the sticky header: whichever group crosses it is "current".
      { rootMargin: "-140px 0px -55% 0px" },
    );
    for (const g of GROUPS) {
      const el = document.getElementById(`settings-${g.id}`);
      if (el) io.observe(el);
    }
    return () => io.disconnect();
  }, []);
  return active;
}

function SettingsNav({ active }: { active: GroupId }) {
  const jump = (e: MouseEvent, id: GroupId) => {
    e.preventDefault();
    const el = document.getElementById(`settings-${id}`);
    if (!el) return;
    // Keep the tab in the URL (a bare "#settings-…" would leave the Settings tab).
    history.replaceState(null, "", `#settings?section=${id}`);
    el.scrollIntoView({ block: "start", behavior: reducedMotion() ? "auto" : "smooth" });
    el.focus({ preventScroll: true });
  };
  return (
    <nav
      aria-label="Settings sections"
      className="sticky top-14 z-20 -mx-4 mb-4 border-b border-line bg-canvas/95 px-4 py-2 backdrop-blur md:top-20 md:mx-0 md:mb-0 md:border-0 md:bg-transparent md:p-0 md:backdrop-blur-none"
    >
      {/* Phones: a scrollable chip row that fades at the edges. Desktop: a vertical list. */}
      <ul className="flex gap-2 overflow-x-auto [mask-image:linear-gradient(to_right,black_calc(100%-1.5rem),transparent)] md:flex-col md:gap-0.5 md:overflow-visible md:[mask-image:none]">
        {GROUPS.map((g) => (
          <li key={g.id} className="shrink-0">
            <a
              href={`#settings?section=${g.id}`}
              aria-current={active === g.id ? "location" : undefined}
              onClick={(e) => jump(e, g.id)}
              className={cx(
                "flex h-9 items-center whitespace-nowrap rounded-sm border px-3 type-label md:rounded-md md:border-0",
                active === g.id ? "border-ink bg-ink text-raised md:bg-active md:text-ink" : "border-line bg-raised text-muted hover:text-ink md:bg-transparent md:hover:bg-inset",
              )}
            >
              {g.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Theme and contrast: saved in this browser and applied at once, so they're not part of Save. */
function AppearanceSection() {
  const { theme, contrast, setTheme, setContrast } = useTheme();
  const density = useDensity();
  const maxAge = useMaxAge();
  return (
    <>
    <Section id="theme" title="Theme" hint="Follows your system's light or dark setting unless you pick one.">
      <div className="space-y-3">
        <Segmented<ThemeChoice>
          label="Theme"
          value={theme}
          onChange={setTheme}
          options={[
            { value: "system", label: "System" },
            { value: "light", label: "Light" },
            { value: "dark", label: "Dark" },
          ]}
        />
        <div>
          <Toggle checked={contrast === "more"} onChange={(on) => setContrast(on ? "more" : "system")}>
            Increase contrast
          </Toggle>
          <p className="mt-1 type-small text-muted">Darker text and stronger borders. Turns on by itself when your system asks for more contrast.</p>
        </div>
      </div>
    </Section>
    <Section id="density" title="Job list" hint="How the Radar shows your jobs.">
      <div className="space-y-4">
        <div>
          <p className="mb-1.5 type-small font-medium text-ink">Density</p>
          <Segmented<Density>
            label="Job list density"
            value={density}
            onChange={setDensityChoice}
            options={[
              { value: "comfortable", label: "Comfortable" },
              { value: "compact", label: "Compact" },
            ]}
          />
        </div>
        <div>
          <p className="mb-1.5 type-small font-medium text-ink">Hide jobs older than</p>
          <Segmented<MaxAge>
            label="Hide jobs older than"
            value={maxAge}
            onChange={setMaxAgeChoice}
            options={MAX_AGE_CHOICES.map((d) => ({ value: d, label: d === 0 ? "Never hide" : d === 30 ? "1 month" : `${d / 30} months` }))}
          />
          <p className="mt-1 type-small text-muted">
            Most roles are filled within two months, so older postings are often still listed but no longer hiring. Jobs you saved or applied to always show.
          </p>
        </div>
      </div>
    </Section>
    </>
  );
}

function Group({ id, label, children }: { id: GroupId; label: string; children: ReactNode }) {
  return (
    <div id={`settings-${id}`} tabIndex={-1} role="group" aria-labelledby={`g-${id}`} className="scroll-mt-32 space-y-4 outline-none md:scroll-mt-20">
      <h2 id={`g-${id}`} className="type-subheading text-ink">
        {label}
      </h2>
      {children}
    </div>
  );
}

/**
 * One settings card. With `summary`, it collapses to a one-line summary and an Edit button; the step
 * component stays mounted while collapsed (just hidden) so nothing it holds is lost.
 */
function Section({
  id,
  title,
  hint,
  summary,
  expanded = true,
  onToggle,
  children,
}: {
  id: string;
  title: string;
  hint: string;
  summary?: string;
  expanded?: boolean;
  onToggle?: () => void;
  children: ReactNode;
}) {
  const collapsible = summary !== undefined && !!onToggle;
  return (
    <Card id={`settings-${id}`} className="scroll-mt-32 p-5 sm:p-6 md:scroll-mt-20">
      <div>
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h3 id={`h-${id}`} className="type-body font-semibold">
              {title}
            </h3>
            {collapsible && !expanded ? <p className="mt-0.5 truncate type-small text-muted">{summary}</p> : <p className="mt-0.5 type-small text-muted">{hint}</p>}
          </div>
          {collapsible && (
            <Button size="sm" variant={expanded ? "ghost" : "outline"} aria-expanded={expanded} aria-controls={`body-${id}`} aria-label={`${expanded ? "Done editing" : "Edit"} ${title.toLowerCase()}`} onClick={onToggle}>
              {expanded ? "Done" : "Edit"}
            </Button>
          )}
        </div>
        <div id={`body-${id}`} hidden={collapsible && !expanded} className="mt-5">
          {children}
        </div>
      </div>
    </Card>
  );
}

function TrackingData({
  user,
  prefs,
  onImport,
  onRemoveRule,
}: {
  user: UserState;
  prefs: Prefs;
  onImport: (s: UserState, prefs?: Partial<Prefs>) => void;
  onRemoveRule?: (rule: HideRule) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<{ tone: "ok" | "bad"; text: string; detail?: string } | null>(null);
  /** A file read and waiting for "Replace N jobs". */
  const [pending, setPending] = useState<Awaited<ReturnType<typeof readStateFile>> | null>(null);
  const tracked = Object.keys(user).length;

  const apply = (next: Awaited<ReturnType<typeof readStateFile>>) => {
    onImport(next.state, next.prefs);
    setMsg({ tone: "ok", text: `Imported ${Object.keys(next.state).length} tracked jobs.` });
  };

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    try {
      const next = await readStateFile(f);
      // Replacing can't be undone, so ask first when there's something to lose.
      if (tracked) setPending(next);
      else apply(next);
    } catch (err) {
      setMsg({ tone: "bad", text: "Couldn't import that file. Pick a file made with Export in RawJobs.", detail: (err as Error).message });
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <Card id="settings-tracking" className="scroll-mt-32 p-5 sm:p-6 md:scroll-mt-20">
      <h3 className="type-body font-semibold">Your tracking data</h3>
      <p className="mt-0.5 type-small text-muted">
        Statuses and notes for <b className="tabular text-ink">{tracked}</b> jobs, plus your saved Radar views, hidden companies and Not interested rules, are saved{" "}
        {canRunLocally ? "on this computer" : "in this browser only"}. Export a backup or move them to another device.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button onClick={() => exportState(user, prefs)} disabled={!tracked && !prefs.views.length && !prefs.hiddenCompanies.length && !prefs.hideRules.length}>
          <Download className="size-4" /> Export
        </Button>
        <Button onClick={() => fileRef.current?.click()}>
          <Upload className="size-4" /> Import
        </Button>
        <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
      </div>
      {prefs.hideRules.length > 0 && (
        <div className="mt-4">
          <h4 className="type-label">Not interested rules</h4>
          <p className="mt-0.5 type-small text-muted">You turned these on after saying why a job wasn't for you. They hide jobs from the Radar, never ones you saved or applied to. To see them anyway, turn on &ldquo;Include hidden jobs and companies&rdquo; under More on the Radar.</p>
          <ul className="mt-2 divide-y divide-line rounded-md border border-line">
            {prefs.hideRules.map((r) => (
              <li key={ruleKey(r)} className="flex items-center justify-between gap-2 px-3 py-1.5 type-small">
                <span className="min-w-0">{ruleLabel(r)}</span>
                {onRemoveRule && (
                  <Button size="sm" variant="ghost" onClick={() => onRemoveRule(r)} aria-label={`Remove the rule hiding ${offerWhat({ kind: "rule", rule: r })}`}>
                    Remove
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {msg && (
        <div role={msg.tone === "bad" ? "alert" : "status"} className="mt-2 type-small">
          <p className={msg.tone === "ok" ? "text-success-text" : "text-danger-text"}>{msg.text}</p>
          {msg.detail && (
            <details className="mt-1 type-meta text-muted">
              <summary className="cursor-pointer">Technical details</summary>
              <p className="mt-1 whitespace-pre-wrap font-mono">{msg.detail}</p>
            </details>
          )}
        </div>
      )}

      <Dialog open={!!pending} onClose={() => setPending(null)} labelledBy="import-title" initialFocus="[data-autofocus]">
        <Card className="p-5 shadow-l3 sm:p-6">
          <div className="flex items-start gap-3">
            <h2 id="import-title" className="min-w-0 flex-1 type-subheading font-semibold">
              Replace your tracked jobs?
            </h2>
            <IconButton label="Close" className="-mr-2 -mt-1" onClick={() => setPending(null)}>
              <X className="size-4" />
            </IconButton>
          </div>
          <p className="mt-1 type-small text-muted">
            This replaces statuses and notes for {tracked} job{tracked === 1 ? "" : "s"} with the ones in the file
            {pending ? ` (${Object.keys(pending.state).length})` : ""}.
          </p>
          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="ghost" onClick={() => setPending(null)} data-autofocus>
              Keep mine
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                if (pending) apply(pending);
                setPending(null);
              }}
            >
              Replace {tracked} job{tracked === 1 ? "" : "s"}
            </Button>
          </div>
        </Card>
      </Dialog>
    </Card>
  );
}

export function StartOver({ onStartOver }: { onStartOver: () => Promise<string | null> }) {
  const [asking, setAsking] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = async () => {
    setWorking(true);
    setError(null);
    const err = await onStartOver();
    setWorking(false);
    if (err) setError(err);
    else setAsking(false);
  };

  return (
    <>
      <Button variant="danger" onClick={() => setAsking(true)}>
        <RotateCcw className="size-4" /> Start setup over
      </Button>
      <Dialog open={asking} onClose={() => !working && setAsking(false)} labelledBy="start-over-title" initialFocus="[data-autofocus]">
        <Card className="p-5 shadow-l3 sm:p-6">
          <div className="flex items-start gap-3">
            <h2 id="start-over-title" className="min-w-0 flex-1 type-subheading font-semibold">
              Start setup over?
            </h2>
            <IconButton label="Close" className="-mr-2 -mt-1" onClick={() => setAsking(false)} disabled={working}>
              <X className="size-4" />
            </IconButton>
          </div>
          <p className="mt-1 type-small text-muted">
            Your profile, roles, places, keywords and companies are cleared and setup opens from the start. Tracked jobs, notes, your resume and Telegram
            alerts stay. A copy of your old setup is kept in <span className="font-mono">rawjobs.config.local.backup.yaml</span>.
          </p>
          {error && (
            <p role="alert" className="mt-2 type-small text-danger-text">
              {error}
            </p>
          )}
          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="ghost" onClick={() => setAsking(false)} disabled={working} data-autofocus>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => void confirm()} disabled={working}>
              {working ? "Clearing…" : "Clear setup"}
            </Button>
          </div>
        </Card>
      </Dialog>
    </>
  );
}

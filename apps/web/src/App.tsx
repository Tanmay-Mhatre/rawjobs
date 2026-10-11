import { ArrowRight, Building2, Keyboard, KanbanSquare, LoaderCircle, Radar as RadarIcon, RefreshCw, Settings as SettingsIcon, TriangleAlert, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CompaniesTab } from "./components/CompaniesTab";
import { Dialog } from "./components/Dialog";
import { SetupBanner } from "./components/EmptyState";
import { checklistItems, ConfigProblemCard, FailingBanner, FirstScanCard, NoMatches, SetupChecklist, SetupHero } from "./components/Guidance";
import { ApplyPrompt } from "./components/ApplyPrompt";
import { JobDrawer } from "./components/JobDrawer";
import { NotForMeProvider, useNotForMeApi } from "./components/NotForMe";
import { Pipeline } from "./components/Pipeline";
import { FeedSkeleton } from "./components/radar/FeedSkeleton";
import { RadarPage } from "./components/radar/RadarPage";
import { NotifyBell, NotifyFailed, notifyLine, telegramReady } from "./components/NotifyWhenDone";
import { ScanButton, ScanChooser } from "./components/ScanButton";
import { Settings } from "./components/Settings";
import { toast, Toaster } from "./components/Toast";
import { Button, Card, cx, IconButton, Kbd } from "./components/ui";
import { FAILING_HASH, jobCompanyKey, keyOf, refOfJob, toRow } from "./lib/companies";
import { telegramStatus, type TelegramStatus } from "./lib/automation";
import { canRunLocally, useData, useOtherJobs, type Job } from "./lib/data";
import { newSinceLastVisit } from "./lib/newSince";
import { usePrefs } from "./lib/prefs";
import { scanPrefs, useScan } from "./lib/scan";
import { useResume } from "./lib/resume";
import { profileFromPicks, type FilterPicks } from "./lib/profileSync";
import { checkNow, draftFromConfig, draftToConfig, emptyDraft, rebaseDraft, resetSetup, saveConfig, setupProgress, STEP, STEP_COUNT, useSetupStatus, type Draft } from "./lib/setup";
import { buildSuggestions } from "./lib/suggest";
import { load, save } from "./lib/storage";
import { timeAgo } from "./lib/format";
import { hasNewTag } from "./lib/filters";
import { ignoreShortcut, useGoToKeys } from "./lib/keys";
import { useTheme } from "./lib/theme";
import { useUserState, type Status } from "./lib/userState";
import wordmarkInk from "./design/logos/rawjobs-wordmark-ink.svg";
import wordmarkPaper from "./design/logos/rawjobs-wordmark-paper.svg";
import { Wizard } from "./setup/Wizard";

const TABS = [
  { id: "radar", label: "Radar", icon: RadarIcon },
  { id: "pipeline", label: "Pipeline", icon: KanbanSquare },
  { id: "companies", label: "Companies", icon: Building2 },
  { id: "settings", label: "Settings", icon: SettingsIcon },
] as const;
type Tab = (typeof TABS)[number]["id"];
type Route = { tab: Tab } | { setup: number };

function parseHash(): Route {
  // "#radar?posted=7…" carries the Radar's filters after the tab name.
  const h = location.hash.slice(1).split("?")[0]!;
  const m = h.match(/^setup(?:\/(\d))?$/);
  if (m) return { setup: Math.min(STEP_COUNT, Number(m[1] ?? 0)) };
  return { tab: (TABS.some((t) => t.id === h) ? h : "radar") as Tab };
}

const DRAFT_KEY = "rawjobs.setupDraft.v1";
/** The first-visit Welcome has been answered (Start or Skip); never auto-open it again. */
const WELCOME_SEEN_KEY = "rawjobs.welcomeSeen";
const sameConfig = (a: Draft, b: Draft) => JSON.stringify(draftToConfig(a)) === JSON.stringify(draftToConfig(b));

export function App() {
  const { state, reload } = useData();
  const setup = useSetupStatus();
  const user = useUserState();
  const prefs = usePrefs();
  /** The job whose apply page was just opened, to ask "Did you apply?" on return. */
  const [applying, setApplying] = useState<Job | null>(null);
  const [route, setRoute] = useState<Route>(parseHash);
  const [openId, setOpenId] = useState<string | null>(null);
  // Keeps data-theme in step with the system while Settings > Appearance is on System.
  useTheme();
  const [showKeys, setShowKeys] = useState(false);

  const status = setup.status;
  const meta = state.kind === "ready" ? state.meta : undefined;
  const personal = !!status?.isPersonal;
  /** none: no personal config yet · invalid: config file broken · configured (also the hosted build, which can't run setup). */
  const setupState = status === null ? "configured" : !status ? "loading" : !status.isPersonal ? "none" : !status.valid ? "invalid" : "configured";
  const notSetUp = setupState === "none";

  // ----- the saved setup, and the working copy the wizard / Settings edit -----
  const saved = useMemo<Draft>(() => {
    if (status?.config) return draftFromConfig(status.config);
    if (status?.raw) return draftFromConfig(status.raw);
    if (status === null && meta) return draftFromConfig({ profile: meta.profile, companies: meta.companies });
    return emptyDraft();
  }, [status, meta]);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const appliedRef = useRef<string>("");
  /** The saved setup the draft was last based on, so a newer save can be merged under unsaved edits. */
  const baseRef = useRef<Draft | null>(null);
  useEffect(() => {
    if (status === undefined) return;
    const key = JSON.stringify(draftToConfig(saved));
    if (key === appliedRef.current) return;
    appliedRef.current = key;
    const base = baseRef.current;
    baseRef.current = saved;
    // The config was saved from elsewhere (the Companies page saves itself): keep unsaved edits.
    if (personal && base) return setDraft((d) => rebaseDraft(d, base, saved));
    // First-time setup resumes an unfinished draft from this browser.
    const stored = !personal && status !== null ? load<Draft | null>(DRAFT_KEY, null) : null;
    setDraft(stored ? { ...emptyDraft(), ...stored } : saved);
  }, [saved, status, personal]);
  useEffect(() => {
    if (status && !status.isPersonal) save(DRAFT_KEY, draft);
  }, [draft, status]);
  const update = useCallback((patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch })), []);
  const dirty = !sameConfig(draft, saved);
  const { resume, saveResume, removeResume } = useResume();
  const progress = setupProgress(draft, !!resume.text);
  const suggest = useMemo(() => buildSuggestions(resume.text, draft.aiProfile), [resume.text, draft.aiProfile]);

  const afterScan = useCallback(async () => {
    await Promise.all([reload(), setup.refresh()]);
  }, [reload, setup.refresh]);
  const { scan, start: startScan, stop: stopScan, notify: notifyScan } = useScan(afterScan);
  /** The "which scan?" pop-up. */
  const [choosing, setChoosing] = useState(false);
  /** A "Scan now" click: ask which scan, or run your default if you said not to ask. */
  const requestScan = useCallback(() => {
    const p = scanPrefs();
    if (p.ask) setChoosing(true);
    else void startScan(p.scope);
  }, [startScan]);
  const closeChooser = useCallback(() => setChoosing(false), []);
  const scanning = scan.phase === "running";

  // ----- Telegram: with it connected, every scan started here sends a message when it finishes -----
  /** undefined: not asked yet (or can't run scans here) · null: couldn't tell. */
  const [tg, setTg] = useState<TelegramStatus | null | undefined>(undefined);
  const refreshTg = useCallback(async () => setTg(await telegramStatus().catch(() => null)), []);
  // Checked again as each scan starts: it may have been set up in Settings since.
  useEffect(() => {
    if (canRunLocally && (scanning || tg === undefined)) void refreshTg();
  }, [scanning, refreshTg]); // eslint-disable-line react-hooks/exhaustive-deps
  const [notifyFailed, setNotifyFailed] = useState(false);
  const notifyAsked = useRef(false);
  useEffect(() => {
    if (!scanning) {
      notifyAsked.current = false;
      return;
    }
    // After the "start" event: the scan clears any earlier request just before it starts.
    if (notifyAsked.current || scan.notify?.asked || !scan.total || !telegramReady(tg)) return;
    notifyAsked.current = true;
    setNotifyFailed(false);
    void notifyScan().then((ok) => setNotifyFailed(!ok));
  }, [scanning, scan.total, scan.notify, tg, notifyScan]);
  // A message that went out is a toast; one that didn't stays on the page (NotifyFailed).
  useEffect(() => {
    if (!scanning && scan.notify?.result === "sent") toast({ message: <>Sent the results to Telegram{tg?.bot ? <> ({tg.bot})</> : null}.</> });
  }, [scanning, scan.notify?.result]); // eslint-disable-line react-hooks/exhaustive-deps
  /** Setup just saved and started the first scan: say how it went when it ends. */
  const announceScan = useRef(false);
  useEffect(() => {
    if (!announceScan.current || (scan.phase !== "done" && scan.phase !== "error")) return;
    announceScan.current = false;
    // A failed scan is explained inline by the scan progress bar; a toast only confirms what worked.
    if (scan.phase === "error") return;
    const m = scan.summary?.matches ?? 0;
    toast({ message: m ? <>Scan done: <b>{m.toLocaleString()}</b> matching {m === 1 ? "job" : "jobs"}.</> : "Scan done. No matches yet: see why below." });
  }, [scan.phase, scan.summary]);

  /** Radar "Save to my profile": its place and industry picks become your profile, then a rescan. */
  const saveProfileFromRadar = useCallback(
    async (picks: FilterPicks): Promise<string | null> => {
      const result = profileFromPicks(saved, picks);
      if ("error" in result) return result.error;
      const res = await saveConfig(draftToConfig({ ...saved, ...result.patch }));
      if (!res.ok) return res.errors;
      await setup.refresh();
      save(DRAFT_KEY, null);
      void startScan();
      return null;
    },
    [saved, setup, startScan],
  );

  // ----- your companies, from the Radar: add, remove, mute, check now -----
  const canSave = canRunLocally && personal && setupState === "configured";
  /** Your companies' keys: from your config, or (hosted build) from the last scan. */
  const yourKeys = useMemo(() => new Set((status?.config?.companies ?? meta?.companies ?? []).map(keyOf)), [status, meta]);
  const isYours = useCallback((j: Job) => yourKeys.has(jobCompanyKey(j)), [yourKeys]);
  const saveCompanies = useCallback(
    async (patch: (d: Draft) => Partial<Draft>): Promise<string | null> => {
      const res = await saveConfig(draftToConfig({ ...saved, ...patch(saved) }));
      if (!res.ok) return res.errors;
      await setup.refresh();
      return null;
    },
    [saved, setup],
  );
  const trackJob = useCallback(
    (job: Job, on: boolean) => {
      const ref = refOfJob(job);
      const key = keyOf(ref);
      return saveCompanies((d) => ({
        companies: on ? (d.companies.some((r) => keyOf(r) === key) ? d.companies : [...d.companies, toRow(ref)]) : d.companies.filter((r) => keyOf(r) !== key),
        muted: d.muted.filter((k) => k !== key),
      }));
    },
    [saveCompanies],
  );
  /** Hide a company's jobs here, and (local app) stop scans from checking it: mute it in your config. */
  const hideCompany = useCallback(
    (company: string, hidden: boolean) => {
      prefs.setCompanyHidden(company, hidden);
      const job = state.kind === "ready" ? state.jobs.find((j) => j.company === company) : undefined;
      if (!canSave || !job) return;
      const key = jobCompanyKey(job);
      void saveCompanies((d) => ({ muted: hidden ? [...new Set([...d.muted, key])] : d.muted.filter((k) => k !== key) }));
    },
    [prefs, state, canSave, saveCompanies],
  );
  const checkJob = useCallback(
    async (job: Job): Promise<string | null> => {
      const e = await checkNow([jobCompanyKey(job)]);
      if (e.type === "error") return e.message;
      await reload();
      return null;
    },
    [reload],
  );

  // ----- routing -----
  useEffect(() => {
    const onHash = () => setRoute(parseHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  const go = useCallback((r: Route) => {
    location.hash = "tab" in r ? r.tab : r.setup ? `setup/${r.setup}` : "setup";
    setRoute(r);
    window.scrollTo({ top: 0 });
  }, []);
  const goStep = useCallback((n: number) => go(n > 0 ? { setup: n } : { setup: 0 }), [go]);
  /** "1 failing" and the failing banner: My companies, sorted by Needs attention. */
  const goFailing = useCallback(() => {
    location.hash = FAILING_HASH;
    setRoute({ tab: "companies" });
    window.scrollTo({ top: 0 });
  }, []);

  // Only the very first visit opens the Welcome; after Start or Skip, setup is reached through CTAs.
  useEffect(() => {
    if (!status || status.isPersonal || "setup" in route) return;
    if (!load(WELCOME_SEEN_KEY, false)) go({ setup: 0 });
  }, [status]); // eslint-disable-line react-hooks/exhaustive-deps

  // Remember how far the wizard got, so "Continue setup" resumes there.
  const wizardStep = "setup" in route ? route.setup : 0;
  useEffect(() => {
    if (notSetUp && wizardStep > (draft.furthestStep ?? 0)) update({ furthestStep: wizardStep });
  }, [notSetUp, wizardStep, draft.furthestStep, update]);

  /** Settings "Start setup over": the config goes to a backup file, then the Welcome opens on an empty setup. */
  const startOver = useCallback(async (): Promise<string | null> => {
    const res = await resetSetup();
    if (!res.ok) return res.errors;
    save(DRAFT_KEY, null);
    save(WELCOME_SEEN_KEY, null);
    baseRef.current = null;
    await setup.refresh();
    setDraft(emptyDraft());
    go({ setup: 0 });
    return null;
  }, [setup, go]);
  const exitSetup = useCallback(() => {
    save(WELCOME_SEEN_KEY, true);
    go({ tab: "radar" });
  }, [go]);
  const goCompanies = useCallback(() => go({ tab: "companies" }), [go]);
  /** Where a "set up" CTA should take the user right now. */
  const toSetup = useCallback(
    () => goStep(setupState === "invalid" ? 0 : progress.started ? progress.nextStep : STEP.resume),
    [goStep, setupState, progress],
  );

  const jobs = state.kind === "ready" ? state.jobs : [];
  const jobsById = useMemo(() => new Map(jobs.map((j) => [j.id, j])), [jobs]);
  const openJob = openId ? jobsById.get(openId) : undefined;
  // Not interested, with an optional reason: X (row button or key) asks why in a toast; the drawer asks inline.
  const notForMe = useNotForMeApi({ user: user.state, update: user.update, prefs: prefs.prefs, setRule: prefs.setRule, hideCompany, jobs });
  const { askWhy } = notForMe;
  const onStatus = useCallback(
    (job: Job, s: Status) => {
      const prev = user.state[job.id]?.status;
      user.toggleStatus(job, s);
      if (s === "dismissed" && prev !== "dismissed") askWhy(job, prev);
    },
    [user, askWhy],
  );
  const onOpen = useCallback((job: Job) => setOpenId(job.id), []);
  const onApply = useCallback((job: Job) => setApplying(job), []);

  const inSetup = "setup" in route;
  const tab = "tab" in route ? route.tab : null;

  // ----- per-view title and heading; focus moves to the heading when you switch views (not on first load) -----
  const viewLabel = tab ? TABS.find((t) => t.id === tab)!.label : null;
  const headingRef = useRef<HTMLHeadingElement>(null);
  const lastTab = useRef<Tab | null>(tab);
  useEffect(() => {
    // Setup routes set their own title.
    if (viewLabel) document.title = `RawJobs · ${viewLabel}`;
    if (tab && lastTab.current !== tab) headingRef.current?.focus({ preventScroll: true });
    lastTab.current = tab;
  }, [tab, viewLabel]);

  // Global keys: Esc closes, ? shows shortcuts, R scans now, 1-4 switch sections (the Radar uses 1-6 for
  // its views instead), and "g" then r/p/c/s goes to a section from anywhere. Dialogs close themselves on
  // Escape too.
  const canScanNow = canRunLocally && setupState === "configured" && !scanning;
  const onPage = !openId && !showKeys && !inSetup;
  useGoToKeys((section) => go({ tab: section }), () => onPage && !document.querySelector("dialog[open]"));
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (ignoreShortcut(e)) return;
      if (e.key === "Escape") {
        setOpenId(null);
        setShowKeys(false);
        return;
      }
      if (e.key === "?") return setShowKeys((v) => !v);
      // The rest only on the page itself, not under a dialog (a job, the scan chooser, "Did you apply?").
      if (openId || showKeys || inSetup || document.querySelector("dialog[open]")) return;
      if (e.key === "r" && canScanNow) requestScan();
      else if (tab !== "radar" && /^[1-4]$/.test(e.key)) go({ tab: TABS[Number(e.key) - 1]!.id });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openId, showKeys, inSetup, tab, canScanNow, requestScan, go]);

  const lastRun = meta?.runs[0];
  // Only your companies: the extra ones a scan checks aren't yours to fix.
  const failing = lastRun?.health.filter((h) => !h.ok && !h.unsupported && yourKeys.has(keyOf(h))).length ?? 0;
  const matched = jobs.filter((j) => !j.why.gate && j.status === "open").length;
  /** The Radar list is showing: on laptops and up the page then fits the window (no page scroll). */
  const radarFits = !inSetup && tab === "radar" && state.kind === "ready" && (matched > 0 || !lastRun);
  // "Why no matches?" needs the jobs that failed the filters too; fetched only then.
  const otherJobs = useOtherJobs(state.kind === "ready" && !!lastRun && matched === 0);
  const items = checklistItems(notSetUp ? draftToConfig(draft) : status?.config, meta, !!resume.text);

  return (
    <NotForMeProvider value={notForMe}>
    <div className="min-h-dvh">
      <a href="#main" onClick={(e) => (e.preventDefault(), document.getElementById("main")?.focus())} className="sr-only-focusable fixed left-3 top-3 z-[70] rounded-md bg-raised px-3 py-2 type-label shadow-l3">
        Skip to content
      </a>
      <header className="sticky top-0 z-30 border-b border-line bg-raised/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4">
          <a href="#radar" onClick={() => go({ tab: "radar" })} className="flex shrink-0 items-center rounded-sm" aria-label="RawJobs, go to Radar">
            {/* The wordmark at every width, 100px (the minimum is 96px): ink on light themes, paper on dark.
                The app mark is for the favicon and app icon only (design/logos). The link names it. */}
            <img src={wordmarkInk} alt="" className="rj-wordmark-ink h-auto w-25" />
            <img src={wordmarkPaper} alt="" className="rj-wordmark-paper h-auto w-25" />
          </a>
          {inSetup ? (
            <span className="type-small text-muted">· Setup</span>
          ) : (
            <nav className="ml-2 hidden items-center gap-1 md:flex" aria-label="Sections">
              {TABS.map((t) => (
                <TabLink key={t.id} tab={t} active={tab === t.id} onClick={() => go({ tab: t.id })} />
              ))}
            </nav>
          )}
          <div className="ml-auto flex items-center gap-1.5">
            {inSetup ? (
              <Button size="sm" variant="ghost" onClick={exitSetup}>
                <X className="size-4" /> Exit setup
              </Button>
            ) : (
              <>
                {lastRun && (
                  <span className="hidden type-meta text-muted lg:inline" title={lastRun.startedAt}>
                    Last scan {timeAgo(lastRun.startedAt)}
                  </span>
                )}
                {state.kind === "ready" && failing > 0 && (
                  <button
                    type="button"
                    onClick={goFailing}
                    title="Review failing companies: usually the careers page moved"
                    className="hidden h-7 items-center gap-1.5 rounded-md border border-warning/40 bg-warning-subtle/40 px-2 type-label text-warning-text hover:bg-warning-subtle/60 lg:inline-flex"
                  >
                    <TriangleAlert className="size-3.5" aria-hidden />
                    {failing} failing<span className="sr-only">: {failing === 1 ? "1 company" : `${failing} companies`} couldn't be scanned last time. Review failing companies</span>
                  </button>
                )}
                {canRunLocally && (setupState === "none" || setupState === "invalid") && (
                  <Button size="sm" variant="primary" onClick={toSetup}>
                    {setupState === "invalid" ? "Fix setup" : progress.started ? "Finish setup" : "Set up radar"} <ArrowRight className="size-3.5" />
                  </Button>
                )}
                {canRunLocally && setupState === "configured" && (
                  <ScanButton
                    scan={scan}
                    onRequest={requestScan}
                    onChoose={() => setChoosing(true)}
                    onStop={() => void stopScan()}
                    notifyLine={notifyLine(tg, scan, notifyFailed)}
                    notify={(openDetails) => (
                      <NotifyBell
                        tg={tg}
                        scan={scan}
                        failed={notifyFailed}
                        onDetails={openDetails}
                        onSaved={() => setup.refresh()}
                        onConnected={() => {
                          void refreshTg();
                          void notifyScan().then((ok) => setNotifyFailed(!ok));
                          notifyAsked.current = true;
                        }}
                      />
                    )}
                  />
                )}
                <span className="hidden sm:contents">
                  <IconButton label="Keyboard shortcuts (?)" onClick={() => setShowKeys((v) => !v)}>
                    <Keyboard className="size-4" />
                  </IconButton>
                </span>
              </>
            )}
          </div>
        </div>
      </header>

      <main
        id="main"
        tabIndex={-1}
        className={cx(
          "mx-auto max-w-6xl px-4 pt-5 outline-none",
          inSetup ? "pb-10" : "pb-24 md:pb-10",
          // The Radar fits the window on laptops and up: the feed and the job scroll inside their panels,
          // the page itself never does, and Apply stays in view.
          radarFits && "lg:flex lg:h-[calc(100dvh-3.5rem)] lg:flex-col lg:pb-4",
        )}
      >
        {status === undefined || state.kind === "loading" ? (
          <FeedSkeleton />
        ) : inSetup ? (
          <Wizard
            step={(route as { setup: number }).setup}
            goStep={goStep}
            draft={draft}
            update={update}
            existing={personal}
            configErrors={status?.valid === false ? status.errors : undefined}
            startScan={startScan}
            onSaved={async () => {
              await setup.refresh();
              save(DRAFT_KEY, null);
              save(WELCOME_SEEN_KEY, true);
            }}
            onFinish={() => {
              announceScan.current = true;
              go({ tab: "radar" });
            }}
            onExit={exitSetup}
            progress={progress}
            resumeText={resume.text}
            saveResume={saveResume}
            removeResume={removeResume}
            onStart={() => {
              save(WELCOME_SEEN_KEY, true);
              goStep(!personal && progress.started ? progress.nextStep : STEP.resume);
            }}
            onStartOver={() => {
              save(WELCOME_SEEN_KEY, true);
              setDraft(emptyDraft());
              goStep(STEP.resume);
            }}
          />
        ) : (
          <div className={cx("flex flex-col gap-4", radarFits && "lg:min-h-0 lg:flex-1 lg:gap-3")}>
            {viewLabel && (
              <h1 ref={headingRef} tabIndex={-1} className="sr-only">
                {viewLabel}
              </h1>
            )}
            {state.kind === "error" && <ErrorState message={state.message} onRetry={() => void reload()} />}
            {/* A scan in progress shows in the header (Scan now becomes its status); a Telegram message that failed shows here. */}
            <NotifyFailed scan={scan} />

            {tab === "radar" && (
              <>
                {notSetUp && <SetupHero items={items} started={progress.started} nextStep={progress.nextStep} onStep={goStep} onCompanies={goCompanies} />}
                {setupState === "invalid" && <ConfigProblemCard errors={status?.errors} onFix={() => goStep(0)} />}
                {setupState === "configured" && personal && (
                  <SetupChecklist items={items} onStep={goStep} onScan={requestScan} onCompanies={goCompanies} />
                )}
                {setupState === "configured" && personal && state.kind === "empty" && <FirstScanCard scan={scan} onScan={requestScan} />}
                {/* Laptops show this as a chip next to "Last scan" in the header, so the jobs start higher. */}
                {state.kind === "ready" && failing > 0 && <FailingBanner className="lg:hidden" count={failing} onOpen={goFailing} />}
                {state.kind === "ready" && lastRun && matched === 0 && <NoMatches jobs={otherJobs ? [...jobs, ...otherJobs] : jobs} onStep={goStep} onCompanies={goCompanies} />}
                {state.kind === "ready" && (matched > 0 || !lastRun) && (
                  <RadarPage
                    jobs={state.jobs}
                    meta={state.meta}
                    user={user.state}
                    prefs={prefs.prefs}
                    onOpenOverlay={onOpen}
                    overlayOpen={!!openJob}
                    onStatus={onStatus}
                    onUpdate={(job, patch) => user.update(job, patch)}
                    onApply={onApply}
                    onSaveView={prefs.saveView}
                    onRenameView={prefs.renameView}
                    onDeleteView={prefs.deleteView}
                    onRestoreView={prefs.restoreView}
                    onHideCompany={hideCompany}
                    onSetRule={prefs.setRule}
                    isYours={isYours}
                    companyCount={yourKeys.size}
                    indexGeneratedAt={state.indexGeneratedAt}
                    onCompanies={goCompanies}
                    onTrack={canSave ? trackJob : undefined}
                    onCheck={canSave ? checkJob : undefined}
                    profile={status?.config?.profile}
                    onEditProfile={() => go({ tab: "settings" })}
                    onSaveProfile={canRunLocally && personal && setupState === "configured" ? saveProfileFromRadar : undefined}
                  />
                )}
              </>
            )}
            {tab === "pipeline" && (
              <Pipeline
                user={user.state}
                jobsById={jobsById}
                min={meta?.profile.min_score ?? 70}
                onOpen={onOpen}
                onMove={(id, entry, s) => user.update({ id, ...entry.snapshot, ...pick(jobsById.get(id)) }, { status: s })}
                onSetup={notSetUp ? toSetup : undefined}
                goRadar={() => go({ tab: "radar" })}
              />
            )}
            {tab === "companies" && (
              <CompaniesTab
                configured={setupState === "configured" && personal}
                meta={meta}
                jobs={jobs}
                hiddenNames={prefs.prefs.hiddenCompanies}
                onUnhideName={(name) => prefs.setCompanyHidden(name, false)}
                draft={draft}
                saved={saved}
                update={update}
                onSaved={async () => {
                  await setup.refresh();
                }}
                onScan={() => {
                  go({ tab: "radar" });
                  requestScan();
                }}
                scanning={scanning}
                toSetup={toSetup}
              />
            )}
            {tab === "settings" && notSetUp && (
              <SetupBanner
                action={
                  <Button variant="primary" size="sm" onClick={toSetup}>
                    {progress.started ? "Continue setup" : "Start setup"} <ArrowRight className="size-3.5" />
                  </Button>
                }
              >
                <b>You haven't finished setup.</b> <span className="text-muted">The guided setup is the quickest way, or fill in the sections below.</span>
              </SetupBanner>
            )}
            {tab === "settings" && setupState === "invalid" && <ConfigProblemCard errors={status?.errors} onFix={() => goStep(0)} />}
            {tab === "settings" && (
              <Settings
                toCompanies={goCompanies}
                draft={draft}
                update={update}
                revert={() => setDraft(saved)}
                dirty={dirty}
                onSaved={async () => {
                  await setup.refresh();
                  save(DRAFT_KEY, null);
                }}
                onScan={() => {
                  go({ tab: "radar" });
                  requestScan();
                }}
                scanning={scanning}
                user={user.state}
                prefs={prefs.prefs}
                onImport={(state, p) => {
                  user.replaceAll(state);
                  if (p) prefs.replacePrefs(p);
                }}
                onRemoveRule={(rule) => prefs.setRule(rule, false)}
                suggest={suggest}
                resumeText={resume.text}
                saveResume={saveResume}
            removeResume={removeResume}
                onStartOver={canRunLocally && personal ? startOver : undefined}
              />
            )}
          </div>
        )}
      </main>

      {!inSetup && (
        <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-line bg-raised/95 backdrop-blur md:hidden" aria-label="Sections">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => go({ tab: t.id })}
              className={cx(
                "relative flex min-h-14 flex-col items-center justify-center gap-0.5 py-1.5 type-label",
                // Selected: ink, with the same 2px ink indicator the tabs use (never the accent).
                tab === t.id ? "text-ink after:absolute after:inset-x-4 after:top-0 after:h-0.5 after:bg-ink" : "text-muted",
              )}
              aria-current={tab === t.id ? "page" : undefined}
            >
              <t.icon className="size-5" />
              {t.label}
            </button>
          ))}
        </nav>
      )}

      {openJob && meta && (
        <JobDrawer
          job={openJob}
          isNew={(() => {
            // Same rule as the feed: new since your last visit, never on the first scan.
            const full = meta.runs.filter((r) => !r.partial);
            return hasNewTag(openJob, { firstScan: full.length <= 1, newSince: newSinceLastVisit(full[0]?.finishedAt, full[1]?.finishedAt) });
          })()}
          entry={user.state[openJob.id]}
          profile={meta.profile}
          postings={jobs.filter((j) => j.group === openJob.group)}
          industries={meta.companies.find((c) => c.name === openJob.company)?.industries ?? openJob.industries}
          yours={isYours(openJob)}
          indexGeneratedAt={state.kind === "ready" ? state.indexGeneratedAt : undefined}
          onTrack={canSave ? (on) => trackJob(openJob, on) : undefined}
          onCheck={canSave && openJob.estimated ? () => checkJob(openJob) : undefined}
          onClose={() => setOpenId(null)}
          onUpdate={(patch) => user.update(openJob, patch)}
          onApply={onApply}
          onOpenJob={(j) => setOpenId(j.id)}
        />
      )}

      <ApplyPrompt
        job={applying}
        onAnswer={(applied) => {
          if (applied && applying) user.update(applying, { status: "applied" });
          setApplying(null);
        }}
      />

      <ShortcutHelp open={showKeys} onClose={() => setShowKeys(false)} canScan={canRunLocally && setupState === "configured"} />
      <ScanChooser open={choosing} onClose={closeChooser} onStart={(scope) => void startScan(scope)} />
      <Toaster />
    </div>
    </NotForMeProvider>
  );
}

const pick = (j: Job | undefined) => (j ? { title: j.title, company: j.company, url: j.url, location: j.location, score: j.score } : {});

function TabLink({ tab, active, onClick }: { tab: (typeof TABS)[number]; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cx(
        "inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 type-label transition-colors",
        active ? "bg-inset text-ink" : "text-muted hover:text-ink",
      )}
    >
      <tab.icon className="size-4" />
      {tab.label}
    </button>
  );
}

/** Loading the jobs failed: what happened, what to do (Retry), and the raw error tucked away for debugging. */
function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Card className="mx-auto max-w-lg p-8 text-center">
      <div role="alert">
        <h2 className="type-subheading font-semibold">Couldn't load your jobs</h2>
        <p className="mt-1 type-small text-muted">The job data didn't load. This is usually a brief hiccup: try again. If it keeps happening, run a new scan.</p>
      </div>
      <Button variant="primary" className="mt-4" onClick={onRetry}>
        <RefreshCw className="size-4" /> Retry
      </Button>
      <details className="mt-4 text-left type-meta text-muted">
        <summary className="cursor-pointer">Technical details</summary>
        <p className="mt-1 break-words font-mono">{message}</p>
      </details>
    </Card>
  );
}

/** Every single-key shortcut the dashboard handles, and only those (design/README.md, Interaction). */
function ShortcutHelp({ open, onClose, canScan }: { open: boolean; onClose: () => void; canScan: boolean }) {
  // Two digits are a range ("1–6"), "G" starts a sequence ("G then R"), other keys a pair ("J / K").
  const rows: [string[], string][] = [
    [["J", "K"], "Next / previous job"],
    [["Enter"], "Open job"],
    [["S"], "Save"],
    [["A"], "Mark as applied"],
    [["X"], "Not interested"],
    [["C"], "Copy description"],
    [["F"], "Expand job to full window"],
    ...(canScan ? [[["R"], "Scan now"] as [string[], string]] : []),
    [["/"], "Search"],
    [["1", "6"], "Radar views, in order"],
    [["1", "4"], "Switch section, outside the Radar"],
    [["G", "R"], "Go to Radar"],
    [["G", "P"], "Go to Pipeline"],
    [["G", "C"], "Go to Companies"],
    [["G", "S"], "Go to Settings"],
    [["[", "]"], "Move a pipeline card back / forward"],
    [["?"], "Show these shortcuts"],
    [["Esc"], "Close"],
  ];
  return (
    <Dialog open={open} onClose={onClose} labelledBy="shortcut-help-title" className="max-w-sm">
      <Card className="w-full p-5 shadow-l3">
        <div className="flex items-center justify-between gap-2">
          <h2 id="shortcut-help-title" className="type-subheading">
            Keyboard shortcuts
          </h2>
          <IconButton label="Close" onClick={onClose} className="-mr-2">
            <X className="size-4" />
          </IconButton>
        </div>
        <ul className="mt-3 space-y-2 type-small">
          {rows.map(([keys, label]) => (
            <li key={label} className="flex items-center justify-between">
              <span className="text-muted">{label}</span>
              <span className="flex items-center gap-1">
                {keys.map((k, i) => (
                  <span key={k} className="flex items-center gap-1">
                    {i > 0 && <span className="type-meta text-muted">{/^\d$/.test(k) ? "–" : keys[0] === "G" ? "then" : "/"}</span>}
                    <Kbd>{k}</Kbd>
                  </span>
                ))}
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </Dialog>
  );
}

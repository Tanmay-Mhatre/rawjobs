import { ArrowRight, Keyboard, RefreshCw, TriangleAlert, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CompaniesTab } from "./components/CompaniesTab";
import { Dialog } from "./components/Dialog";
import { SetupBanner } from "./components/EmptyState";
import { checklistItems, ConfigProblemCard, FailingBanner, FirstScanCard, NoMatches, SetupChecklist, SetupHero } from "./components/Guidance";
import { ApplyPrompt } from "./components/ApplyPrompt";
import { JobDrawer } from "./components/JobDrawer";
import { type NotForMeApi, NotForMeProvider, useNotForMeApi } from "./components/NotForMe";
import { type PeopleApi, PeopleProvider } from "./components/pipeline/PeopleContext";
import { Pipeline } from "./components/Pipeline";
import { FeedSkeleton } from "./components/radar/FeedSkeleton";
import { RadarPage } from "./components/radar/RadarPage";
import { NotifyBell, NotifyFailed, notifyLine } from "./components/NotifyWhenDone";
import { ServerNotices } from "./components/Updates";
import { UpdatePill } from "./components/WhatsNew";
import { ScanButton } from "./components/ScanButton";
import { FeedStaleNotice } from "./components/FeedStaleNotice";
import { Settings } from "./components/Settings";
import { settingsHash } from "./components/settings/registry";
import { ShortcutList } from "./components/ShortcutList";
import { Toaster, toast } from "./components/Toast";
import { offerWhat } from "./lib/notForMe";
import { Button, Card, cx, IconButton } from "./components/ui";
import { keyOf } from "./lib/companies";
import { canRunLocally, useData, useOtherJobs, type Job } from "./lib/data";
import { newCtx } from "./lib/newSince";
import { useHourlyNow } from "./components/radar/hooks";
import { usePrefs } from "./lib/prefs";
import { scanPrefs, useScan, withLive } from "./lib/scan";
import { useBackgroundScan } from "./lib/backgroundScan";
import { announceBackgroundScan } from "./app/announceBackgroundScan";
import { useResume } from "./lib/resume";
import { profileFromPicks, type FilterPicks } from "./lib/profileSync";
import { ProfileFixProvider, type ProfileFixApi } from "./lib/profileFix";
import { draftToConfig, emptyDraft, resetSetup, saveConfig, setupProgress, STEP, useSetupStatus } from "./lib/setup";
import { buildSuggestions } from "./lib/suggest";
import { load, onSaveFailed, save } from "./lib/storage";
import { timeAgo } from "./lib/format";
import { hasNewTag } from "./lib/filters";
import { roleOf } from "./lib/identity";
import { ignoreShortcut, useGoToKeys } from "./lib/keys";
import { useSavedAppearance, useTheme } from "./lib/theme";
import { quickStatus, STATUS_LABEL, type Status, useUserState } from "./lib/userState";
import wordmarkInk from "./design/logos/rawjobs-wordmark-ink.svg";
import wordmarkPaper from "./design/logos/rawjobs-wordmark-paper.svg";
import { Wizard } from "./setup/Wizard";
import { TABS, type Tab, useHashRoute } from "./app/route";
import { useCompanyActions } from "./app/useCompanyActions";
import { useScanAnnouncement } from "./app/useScanAnnouncement";
import { useScanNotify } from "./app/useScanNotify";
import { DRAFT_KEY, useSetupDraft, WELCOME_SEEN_KEY } from "./app/useSetupDraft";

const NO_JOBS: Job[] = [];

// Saving your tracking failed (the browser refused it, or the local API did): say so, at most once a minute, rather than fail silently.
onSaveFailed(() => toast({ message: "Couldn't save your tracking" }));

export function App() {
  const { state, reload } = useData();
  const setup = useSetupStatus();
  const user = useUserState();
  const people = useMemo(() => ({ state: user.state, updateContact: user.updateContact }), [user.state, user.updateContact]);
  const prefs = usePrefs();
  /** The job whose apply page was just opened, to ask "Did you apply?" on return. */
  const [applying, setApplying] = useState<Job | null>(null);
  const { route, go, goStep, goFailing } = useHashRoute();
  const [openId, setOpenId] = useState<string | null>(null);
  // Keeps data-theme in step with the system while Settings > Appearance is on System.
  useTheme();
  // Theme, contrast, density and age limit are saved in your RawJobs folder, not just this browser.
  useSavedAppearance();
  const [showKeys, setShowKeys] = useState(false);

  const status = setup.status;
  const meta = state.kind === "ready" ? state.meta : undefined;
  const personal = !!status?.isPersonal;
  /** none: no personal config yet · invalid: config file broken · configured (also the hosted build, which can't run setup). */
  const setupState = status === null ? "configured" : !status ? "loading" : !status.isPersonal ? "none" : !status.valid ? "invalid" : "configured";
  const notSetUp = setupState === "none";

  const { saved, draft, setDraft, update, dirty, forgetBase, loaded: draftLoaded } = useSetupDraft(status, meta);
  const { resume, saveResume, removeResume } = useResume();
  const progress = setupProgress(draft, !!resume.text);
  const suggest = useMemo(() => buildSuggestions(resume.text, draft.aiProfile), [resume.text, draft.aiProfile]);

  const afterScan = useCallback(async () => {
    await Promise.all([reload(), setup.refresh()]);
  }, [reload, setup.refresh]);
  const { scan, start: startScan, stop: stopScan, restart: restartScan, notify: notifyScan } = useScan(afterScan);
  const afterBackgroundScan = useCallback(async () => {
    const [m] = await Promise.all([reload(), setup.refresh()]);
    return m;
  }, [reload, setup.refresh]);
  /** A "Scan now" click: runs what Settings > Scans says (the scan, or only your companies), straight away. */
  const requestScan = useCallback(() => void startScan(scanPrefs().scope), [startScan]);
  const scanning = scan.phase === "running";
  /** A scheduled scan: shown in the header while it runs; its results replace the ones on screen when it ends. */
  const background = useBackgroundScan({
    loaded: state.kind === "ready" ? state.meta.generatedAt : state.kind === "empty" ? null : undefined,
    paused: scanning,
    reload: afterBackgroundScan,
    onFinished: announceBackgroundScan,
  });

  const { tg, notifyFailed, notifyNow } = useScanNotify(scan, notifyScan);
  /** Setup just saved and started the first scan: say how it went when it ends. */
  const announceScan = useScanAnnouncement(scan);

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
  /** "Why it matched" fixes: add one word to a profile list and save; the next scan re-scores (no scan now, so several fixes share one). */
  const profileFix = useMemo<ProfileFixApi | null>(
    () =>
      canSave
        ? {
            draft: saved,
            add: async (field, value) => {
              const res = await saveConfig(draftToConfig({ ...saved, [field]: [...saved[field], value] }));
              if (!res.ok) return res.errors;
              await setup.refresh();
              return null;
            },
          }
        : null,
    [canSave, saved, setup],
  );
  const { yourKeys, isYours, trackJob, hideCompany, checkJob } = useCompanyActions({
    saved,
    canSave,
    configCompanies: status?.config?.companies,
    scannedCompanies: meta?.companies,
    jobs: state.kind === "ready" ? state.jobs : NO_JOBS,
    setCompanyHidden: prefs.setCompanyHidden,
    refreshSetup: setup.refresh,
    reload,
  });

  // Only the very first visit opens the Welcome; after Start or Skip, setup is reached through CTAs.
  // biome-ignore lint/correctness/useExhaustiveDependencies: decides once, when setup status first loads; later route changes mustn't reopen the Welcome
  useEffect(() => {
    if (!status || status.isPersonal || "setup" in route) return;
    if (!load(WELCOME_SEEN_KEY, false)) go({ setup: 0 });
  }, [status]);

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
    forgetBase();
    await setup.refresh();
    setDraft(emptyDraft());
    go({ setup: 0 });
    return null;
  }, [setup, go, forgetBase, setDraft]);
  const exitSetup = useCallback(() => {
    save(WELCOME_SEEN_KEY, true);
    go({ tab: "radar" });
  }, [go]);
  const goCompanies = useCallback(() => go({ tab: "companies" }), [go]);
  /** Where a "set up" CTA should take the user right now. */
  const toSetup = useCallback(() => goStep(setupState === "invalid" ? 0 : progress.started ? progress.nextStep : STEP.resume), [goStep, setupState, progress]);

  // A running scan's matches show up as each company finishes; the saved files replace them when it ends.
  const jobs = useMemo(() => withLive(state.kind === "ready" ? state.jobs : NO_JOBS, scan.live), [state, scan.live]);
  const jobsById = useMemo(() => new Map(jobs.map((j) => [j.id, j])), [jobs]);
  const openJob = openId ? jobsById.get(openId) : undefined;
  // Not interested, with an optional reason: X (row button or key) asks why in a toast; the drawer asks inline.
  const notForMe = useNotForMeApi({ user: user.state, update: user.update, prefs: prefs.prefs, setRule: prefs.setRule, hideCompany, jobs });
  const { askWhy } = notForMe;
  const { statusOf, toggleStatus } = user;
  const onStatus = useCallback(
    (job: Job, s: Status) => {
      const prev = statusOf(job.id);
      // One tap never undoes progress: an Interviewing job stays put when you press A or S.
      if (!toggleStatus(job, s)) {
        if (prev) toast({ message: `Already ${STATUS_LABEL[prev]}. Change it in the job's progress menu or the Pipeline.` });
        return;
      }
      if (s === "dismissed" && prev !== "dismissed") askWhy(job, prev);
    },
    [statusOf, toggleStatus, askWhy],
  );
  const onOpen = useCallback((job: Job) => setOpenId(job.id), []);
  const hourlyNow = useHourlyNow();
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

  // Global keys: Esc closes, ? shows shortcuts, R scans now, 1-4 switch sections (the Radar uses 1-3 for
  // its views instead), and "g" then r/p/c/s goes to a section from anywhere. Dialogs close themselves on
  // Escape too.
  const canScanNow = canRunLocally && setupState === "configured" && !scanning && !background.running;
  const onPage = !openId && !showKeys && !inSetup;
  useGoToKeys(
    (section) => go({ tab: section }),
    () => onPage && !document.querySelector("dialog[open]"),
  );
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
    <Providers notForMe={notForMe} profileFix={profileFix} people={people}>
      <div className="min-h-dvh">
        {/* biome-ignore lint/a11y/useValidAnchor: a real link (its href works without script); onClick only adds in-page focus or routing */}
        <a
          href="#main"
          onClick={(e) => {
            e.preventDefault();
            document.getElementById("main")?.focus();
          }}
          className="sr-only-focusable fixed left-3 top-3 z-[70] rounded-md bg-raised px-3 py-2 type-label shadow-l3"
        >
          Skip to content
        </a>
        <header className="sticky top-0 z-30 border-b border-line bg-raised/85 backdrop-blur">
          <div className={cx("mx-auto flex h-14 items-center gap-3 px-4", tab === "pipeline" ? "max-w-[100rem]" : "max-w-6xl")}>
            {/* biome-ignore lint/a11y/useValidAnchor: a real link (its href works without script); onClick only adds in-page focus or routing */}
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
              {/* A new version, downloaded and ready: one click updates (like the Claude desktop app's). */}
              {canRunLocally && <UpdatePill />}
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
                      background={background.running}
                      onStart={(scope) => void startScan(scope)}
                      onSettings={() => {
                        location.hash = settingsHash("scans");
                      }}
                      onStop={() => void stopScan()}
                      notifyLine={notifyLine(tg, scan, notifyFailed)}
                      notify={(openDetails) => <NotifyBell tg={tg} scan={scan} failed={notifyFailed} onDetails={openDetails} onSaved={() => setup.refresh()} onConnected={notifyNow} />}
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
            "mx-auto px-4 pt-5 outline-none",
            // The Pipeline's six columns get more room; every other page keeps the reading width.
            tab === "pipeline" ? "max-w-[100rem]" : "max-w-6xl",
            inSetup ? "pb-10" : "pb-24 md:pb-10",
            // The Radar fits the window on laptops and up: the feed and the job scroll inside their panels,
            // the page itself never does, and Apply stays in view.
            radarFits && "lg:flex lg:h-[calc(100dvh-3.5rem)] lg:flex-col lg:pb-4",
          )}
        >
          <ServerNotices onRadar={!inSetup && tab === "radar" && !openId && !showKeys && status !== undefined} />
          {!inSetup && tab === "radar" && <FeedStaleNotice scan={scan} onOnlyMine={() => void restartScan("yours")} />}
          {status === undefined || state.kind === "loading" ? (
            <FeedSkeleton />
          ) : inSetup ? (
            <Wizard
              step={wizardStep}
              goStep={goStep}
              draft={draft}
              draftLoaded={draftLoaded}
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
                  {setupState === "configured" && personal && <SetupChecklist items={items} onStep={goStep} onScan={requestScan} onCompanies={goCompanies} />}
                  {setupState === "configured" && personal && state.kind === "empty" && <FirstScanCard scan={scan} onScan={requestScan} />}
                  {/* Laptops show this as a chip next to "Last scan" in the header, so the jobs start higher. */}
                  {state.kind === "ready" && failing > 0 && <FailingBanner className="lg:hidden" count={failing} onOpen={goFailing} />}
                  {state.kind === "ready" && lastRun && matched === 0 && <NoMatches jobs={otherJobs ? [...jobs, ...otherJobs] : jobs} onStep={goStep} onCompanies={goCompanies} />}
                  {state.kind === "ready" && (matched > 0 || !lastRun) && (
                    <RadarPage
                      jobs={jobs}
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
                  onOpen={onOpen}
                  onPatch={(id, entry, patch) => user.update({ id, ...entry.snapshot, ...pick(jobsById.get(id)) }, patch)}
                  weeklyPlan={prefs.prefs.weeklyPlan}
                  onWeeklyPlan={prefs.setWeeklyPlan}
                  onAdd={(j, status) => user.update({ id: `manual:${Date.now().toString(36)}`, ...j, location: "", score: 0 }, { status })}
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
                  loaded={draftLoaded}
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
                  saved={saved}
                  setupSaved={canSave}
                  canScan={canRunLocally && setupState === "configured"}
                  onSaved={async () => {
                    await setup.refresh();
                    save(DRAFT_KEY, null);
                  }}
                  onScan={() => {
                    go({ tab: "radar" });
                    requestScan();
                  }}
                  onCheckEvery={() => {
                    go({ tab: "radar" });
                    void startScan("all");
                  }}
                  scanning={scanning}
                  user={user.state}
                  prefs={prefs.prefs}
                  onImport={(state, p) => {
                    user.replaceAll(state);
                    if (p) prefs.replacePrefs(p);
                  }}
                  onRemoveRule={(rule) => {
                    prefs.setRule(rule, false);
                    toast({ message: <>Showing {offerWhat({ kind: "rule", rule })} again.</>, actionLabel: "Undo", onAction: () => prefs.setRule(rule, true) });
                  }}
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
            // Same rule as the feed: new since your last visit, never on the first scan.
            isNew={hasNewTag(openJob, newCtx(meta.runs))}
            entry={user.state[openJob.id]}
            profile={meta.profile}
            postings={jobs.filter((j) => roleOf(j) === roleOf(openJob))}
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
            // Never moves a job back: one already Interviewing stays there.
            if (applied && applying && quickStatus(user.statusOf(applying.id), "applied") === "applied") user.update(applying, { status: "applied" });
            setApplying(null);
          }}
        />

        <ShortcutHelp open={showKeys} onClose={() => setShowKeys(false)} canScan={canRunLocally && setupState === "configured"} />
        <Toaster />
      </div>
    </Providers>
  );
}

const pick = (j: Job | undefined) => (j ? { title: j.title, company: j.company, url: j.url, location: j.location, score: j.score } : {});

function TabLink({ tab, active, onClick }: { tab: (typeof TABS)[number]; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cx("inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 type-label transition-colors", active ? "bg-inset text-ink" : "text-muted hover:text-ink")}
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

/** The "?" window: every shortcut, and where they're listed for good. */
function ShortcutHelp({ open, onClose, canScan }: { open: boolean; onClose: () => void; canScan: boolean }) {
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
        <ShortcutList canScan={canScan} className="mt-3 space-y-2 type-small" />
        <a href={`#${settingsHash("keyboard")}`} onClick={onClose} className="mt-4 inline-block type-small font-medium text-ink underline underline-offset-2 hover:text-muted">
          Also in Settings › Keyboard
        </a>
      </Card>
    </Dialog>
  );
}

/** The app-wide contexts: "Not for me" and the "Why it matched" profile fixes. */
function Providers({ notForMe, profileFix, people, children }: { notForMe: NotForMeApi; profileFix: ProfileFixApi | null; people: PeopleApi; children: ReactNode }) {
  return (
    <NotForMeProvider value={notForMe}>
      <ProfileFixProvider value={profileFix}>
        <PeopleProvider value={people}>{children}</PeopleProvider>
      </ProfileFixProvider>
    </NotForMeProvider>
  );
}

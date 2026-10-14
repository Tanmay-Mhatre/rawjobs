import { INDUSTRY_BY_ID } from "@rawjobs/core/catalog/industries";
import { groupPlaces } from "@rawjobs/core/catalog/places";
import { ArrowRight, Check, ChevronLeft, ChevronRight, Download, RefreshCw, RotateCcw, Save, Upload, X } from "lucide-react";
import { Fragment, useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { canRunLocally, useDirectorySize } from "../lib/data";
import { DealbreakersStep } from "./Dealbreakers";
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
import { useUpdateStatus } from "../lib/update";
import { DesktopShortcutSettings } from "./DesktopShortcut";
import { AboutRawJobs, UpdatesSettings, UpdateTelegramSetting } from "./Updates";
import { ShortcutList } from "./ShortcutList";
import { DISMISS_KEY as CHECKLIST_DISMISSED_KEY } from "./Guidance";
import { DISMISSED_KEY as GO_BACK_DISMISSED_KEY } from "./companies/ForYou";
import { save } from "../lib/storage";
import { ReleaseNotes } from "./WhatsNew";
import { parseSettingsHash, SETTINGS_GROUPS, SETTINGS_PAGES, SETTINGS_SECTIONS, settingsHash, type SettingsPageId } from "./settings/registry";
import { searchSettings, type SettingsHit } from "./settings/search";
import { SettingsSearchBox, SettingsSearchResults, useSearchShortcut } from "./settings/SettingsSearch";

type Props = {
  draft: Draft;
  update: (patch: Partial<Draft>) => void;
  /** Throw away unsaved edits (reload from the saved config). */
  revert: () => void;
  dirty: boolean;
  /** The setup as saved, for settings that save on their own (written on top of it). */
  saved: Draft;
  /** A finished setup is saved on this computer; until then every change waits for Save. */
  setupSaved: boolean;
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
  /** R scans now (for the shortcut list). */
  canScan?: boolean;
};

/** "a, b, c +2", or "" when empty. */
const list = (xs: string[], n = 3) => (xs.length ? xs.slice(0, n).join(", ") + (xs.length > n ? ` +${xs.length - n}` : "") : "");

/** The Settings page and card in the URL ("#settings/scans?section=schedule"), kept in step with it. */
function useSettingsRoute() {
  const [route, setRoute] = useState(() => parseSettingsHash(location.hash));
  useEffect(() => {
    const onHash = () => setRoute(parseSettingsHash(location.hash));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  return route;
}

/** Edit any part of the setup after the wizard, then save (and scan). One page at a time, picked in the sidebar. */
export function Settings({
  draft,
  update,
  revert,
  dirty: anyDirty,
  saved,
  setupSaved,
  onSaved,
  onScan,
  scanning,
  user,
  prefs,
  onImport,
  onRemoveRule,
  suggest,
  resumeText,
  saveResume,
  removeResume,
  toCompanies,
  onStartOver,
  canScan = false,
}: Props) {
  const [status, setStatus] = useState<{ tone: "ok" | "bad"; text: string; detail?: string; retry?: boolean } | null>(null);
  const [saving, setSaving] = useState(false);
  const lastSave = useRef(false);
  const blockers = saveBlockers(draft).map((b) => b.message);
  // Once setup is saved, the switches outside Profile and Matching save on their own, so only those two pages' edits wait for Save.
  const instant = canRunLocally && setupSaved;
  const same = (a: Draft, b: Draft) => JSON.stringify(draftToConfig(a)) === JSON.stringify(draftToConfig(b));
  /** The draft without the edits that save on their own. */
  const waiting = { ...draft, directory: saved.directory, alerts: { ...draft.alerts, only_new: saved.alerts.only_new } };
  const dirty = anyDirty && (!instant || !same(waiting, saved));
  /** The page holding the unsaved edits: Matching when only the threshold changed. */
  const dirtyPage: SettingsPageId = same({ ...waiting, minScore: saved.minScore }, saved) ? "matching" : "profile";
  /** Until setup is saved, the Save bar shows on every page: the directory switches wait for it too. */
  const saveHere = (page: SettingsPageId) => !instant || page === "profile" || page === "matching";
  const [switchSave, setSwitchSave] = useState<Partial<Record<InstantSwitch, FieldSave>>>({});
  /** Save one switch now: written on top of the saved setup, leaving Profile and Matching edits unsaved. */
  const saveSwitch = async (key: InstantSwitch, on: boolean) => {
    // Both directory switches may be saving at once, so each save carries the other's latest value.
    const patch: Partial<Draft> = key === "only_new" ? { alerts: { ...draft.alerts, only_new: on } } : { directory: { ...draft.directory, [key]: on } };
    update(patch);
    if (!instant) return;
    const note = (state: FieldSave) => setSwitchSave((s) => ({ ...s, [key]: state }));
    note({ kind: "saving" });
    try {
      const next = key === "only_new" ? { ...saved, alerts: { ...saved.alerts, only_new: on } } : { ...saved, directory: patch.directory! };
      const res = await saveConfig(draftToConfig(next));
      if (!res.ok) return note({ kind: "error", retry: () => void saveSwitch(key, on) });
      await onSaved();
      note({ kind: "saved" });
    } catch {
      note({ kind: "error", retry: () => void saveSwitch(key, on) });
    }
  };
  const directorySize = useDirectorySize();
  const updates = useUpdateStatus();

  // Cards that only make sense on some copies; a page with none of its cards left is left out of the sidebar.
  const shown: Record<string, boolean> = {
    schedule: canRunLocally,
    alerts: canRunLocally,
    reset: !!onStartOver,
    version: canRunLocally,
    shortcut: canRunLocally && !!updates.status?.installed && !!updates.status.about?.shortcuts,
    update: canRunLocally && !!updates.status?.installed,
    "release-notes": canRunLocally,
  };
  const isShown = (id: string) => shown[id] ?? true;
  /** Why search shows a card it can't open here. */
  const unavailable = (id: string) => {
    if (isShown(id)) return undefined;
    if (!canRunLocally) return "Only when RawJobs runs on your computer";
    return id === "reset" ? "Once your setup is saved" : "Only in the installed app";
  };
  const pages = SETTINGS_PAGES.filter((p) => SETTINGS_SECTIONS.some((s) => s.page === p.id && isShown(s.id)));

  const route = useSettingsRoute();
  // A bare "#settings" opens Profile on a computer; a phone shows the list of pages first.
  const current: SettingsPageId = route.page && pages.some((p) => p.id === route.page) ? route.page : "profile";

  // One-line summaries for the Profile sections; an empty one starts open so there's something to fill in.
  const summaries: Record<string, string> = {
    resume: resumeText.trim() ? "Saved" : "",
    roles: list(draft.include),
    locations: list([...groupPlaces(officePlaces(draft)).map((g) => displayPlace(g.name)), ...(draft.remote ? ["Remote"] : [])]),
    industries: list(draft.industries.map((id) => INDUSTRY_BY_ID.get(id)?.label ?? id)),
    keywords: list(Object.keys(draft.keywords)),
    dealbreakers: list([
      ...(draft.salaryFloor?.amount ? [`${draft.salaryFloor.currency} ${draft.salaryFloor.amount.toLocaleString()} a ${draft.salaryFloor.period}`] : []),
      ...(draft.workAuthorization ?? []),
      ...(draft.avoid ?? []),
    ]),
  };
  // Dealbreakers are optional, so they start folded even when empty.
  const [open, setOpen] = useState<Set<string>>(() => new Set(Object.keys(summaries).filter((k) => !summaries[k] && k !== "dealbreakers")));
  // What's saved in each card, in full, for search ("berlin" finds Locations).
  const values = (id: string): string[] =>
    ({
      roles: [...draft.include, ...draft.exclude],
      locations: [...groupPlaces(officePlaces(draft)).map((g) => displayPlace(g.name)), ...(draft.remote ? ["Remote"] : [])],
      industries: draft.industries.map((i) => INDUSTRY_BY_ID.get(i)?.label ?? i),
      keywords: Object.keys(draft.keywords),
      dealbreakers: [...(draft.workAuthorization ?? []), ...(draft.avoid ?? [])],
    })[id] ?? [];

  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const searching = !!query.trim();
  /** Profile and Matching collect edits for Save; every other page saves each change at once. */
  const onDraftPage = !searching && saveHere(current);
  const hits = searching ? searchSettings(query, { unavailable, values }) : [];
  useSearchShortcut();
  /** The card a search result opened: outlined for a moment once it's on screen. */
  const flash = useRef<string | null>(null);
  const openHit = (hit: SettingsHit) => {
    setQuery("");
    flash.current = hit.section.id;
    const target = `#${settingsHash(hit.section.id)}`;
    if (location.hash === target) reveal(hit.section.id);
    else location.hash = target;
  };

  const toggle = (id: string) =>
    setOpen((o) => {
      const next = new Set(o);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // "#settings/scans?section=schedule" (from the Radar's checklist): open that card and scroll to it.
  // Without a card, a new page starts at the top.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the route changes; the section ids it checks never change
  useEffect(() => {
    const id = route.section;
    if (!id) {
      window.scrollTo({ top: 0 });
      return;
    }
    return reveal(id);
  }, [route.page, route.section]);

  /** Open a card (if it folds), scroll to it and, when search led here, outline it and move focus to it. */
  function reveal(id: string) {
    if (id in summaries) setOpen((o) => new Set(o).add(id));
    // After the page has rendered. Some cards appear once their data loads (Desktop shortcut): keep looking for a moment.
    let tries = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const scroll = () => {
      const el = document.getElementById(`settings-${id}`);
      if (!el) {
        if (++tries < 20) timer = setTimeout(scroll, 100);
        return;
      }
      el.scrollIntoView({ block: "start" });
      if (flash.current !== id) return;
      flash.current = null;
      el.tabIndex = -1;
      el.focus({ preventScroll: true });
      el.classList.add("ring-2", "ring-focus");
      timer = setTimeout(() => el.classList.remove("ring-2", "ring-focus"), 1600);
    };
    timer = setTimeout(scroll, 60);
    return () => clearTimeout(timer);
  }

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

  // Every page stays mounted (just hidden), as when Settings was one long page, so nothing typed is lost on a page switch.
  const page = (id: SettingsPageId, children: ReactNode) => (
    <SettingsPage id={id} current={searching ? null : current} onList={!route.page}>
      {children}
    </SettingsPage>
  );

  return (
    <div className="md:grid md:grid-cols-[12rem_minmax(0,1fr)] md:items-start md:gap-8">
      <SettingsNav pages={pages} current={current} onList={!route.page} searching={searching}>
        <SettingsSearchBox
          query={query}
          onQuery={(q) => {
            setQuery(q);
            setActive(0);
          }}
          hits={hits}
          active={active}
          onActive={setActive}
          onOpen={openHit}
        />
      </SettingsNav>
      <div className={cx("min-w-0", !route.page && !searching && "max-md:hidden")}>
        {searching && <SettingsSearchResults query={query} hits={hits} active={active} onOpen={openHit} />}
        {page(
          "profile",
          <>
            {profile(
              "resume",
              "Master resume",
              "Saved on this computer only.",
              <ResumeStep draft={draft} update={update} resumeText={resumeText} saveResume={saveResume} removeResume={removeResume} hideSkip />,
            )}
            {profile("roles", "Roles", "Only jobs whose title matches are shown.", <RolesStep draft={draft} update={update} suggest={suggest} />)}
            {profile("locations", "Locations", "Jobs outside these places are hidden.", <LocationsStep draft={draft} update={update} suggest={suggest} />)}
            {profile("industries", "Industries", "Industries decide which companies are scanned and suggested.", <IndustriesStep draft={draft} update={update} suggest={suggest} />)}
            {profile("keywords", "Topics", "Topics rank jobs higher when they mention them.", <KeywordsStep draft={draft} update={update} suggest={suggest} resumeText={resumeText} />)}
            {profile(
              "dealbreakers",
              "Dealbreakers",
              "A job that breaks one stays on your Radar with the reason, at half its score and under your threshold.",
              <DealbreakersStep draft={draft} update={update} />,
            )}
          </>,
        )}

        {page(
          "matching",
          <>
            <Section id="threshold" title="Strong match threshold" hint="Strong matches get a highlighted score on your Radar and are sent in Telegram alerts. Applies when you save.">
              <ThresholdPicker draft={draft} update={update} />
            </Section>
            <MaxAgeSection />
            <Section
              id="rules"
              title="Not interested rules"
              hint="You turn these on after saying why a job wasn't for you. They hide jobs from the Radar, never ones you saved or applied to. Saved right away."
            >
              <HideRules rules={prefs.hideRules} onRemoveRule={onRemoveRule} />
            </Section>
          </>,
        )}

        {page(
          "companies",
          <Section
            id="companies"
            title="My companies"
            hint="Companies you'd love to work at: scanned every time, starred on your Radar, and their newest jobs shown on top. Hidden companies and past employers are on the Companies tab too."
          >
            <div className="flex flex-wrap items-center gap-3">
              <p className="type-small">
                You've picked <b className="tabular">{draft.companies.length}</b> compan{draft.companies.length === 1 ? "y" : "ies"}
                {draft.muted.length > 0 && (
                  <>
                    , hidden <b className="tabular">{draft.muted.length}</b>
                  </>
                )}
                {draft.pastEmployers.length > 0 && (
                  <>
                    {" "}
                    and listed <b className="tabular">{draft.pastEmployers.length}</b> past employer{draft.pastEmployers.length === 1 ? "" : "s"}
                  </>
                )}
                .
              </p>
              <Button size="sm" onClick={toCompanies}>
                Manage in Companies tab <ArrowRight className="size-3.5" />
              </Button>
            </div>
          </Section>,
        )}

        {page(
          "scans",
          <>
            <Section id="scope" title="What to scan" hint={canRunLocally ? "What Scan now does. Saved on this computer, right away." : "What Scan now does. Saved in this browser, right away."}>
              <div className="space-y-3">
                <ScanPrefsPicker />
                <details className="type-small">
                  <summary className="cursor-pointer font-medium text-ink">How long each one takes</summary>
                  <ul className="mt-2 space-y-1.5">
                    <li>
                      <b>{draft.industries.length ? "My companies + my industries" : "My companies"}</b>
                      <span className="text-muted">
                        {draft.industries.length
                          ? ": My companies, plus every company in the directory tagged with your industries. A few minutes."
                          : ": the companies you've added. Add industries under Profile to scan more. A few minutes."}
                      </span>
                    </li>
                    <li>
                      <b>All companies</b>
                      <span className="text-muted">
                        : every company in the directory that RawJobs can scan. The daily job feed skips companies with nothing for you, so usually minutes; up to 2 hours without it. Stop any time and
                        it carries on later.
                      </span>
                    </li>
                  </ul>
                </details>
              </div>
            </Section>
            {shown.schedule && (
              <Section id="schedule" title="Scheduled scans" hint="Scan automatically every day at the times you pick. Saved right away.">
                <ScheduledScans />
              </Section>
            )}
            <Section
              id="directory"
              title="Company directory"
              hint={`The shared directory lists ${directorySize ? `${roughCount(directorySize)} ` : ""}companies and where each one posts jobs. Jobs are always fetched live by your own scans; nothing about you is sent.`}
            >
              <div className="space-y-2">
                <p className="type-small text-muted">Every scan first updates the directory, so new companies and moved careers pages are picked up.</p>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <Toggle checked={draft.directory.auto_update} onChange={(v) => void saveSwitch("auto_update", v)}>
                    Also update it in the background when the app starts
                  </Toggle>
                  <SaveNote state={switchSave.auto_update} />
                </div>
              </div>
            </Section>
          </>,
        )}

        {page(
          "notifications",
          shown.alerts && (
            <>
              <Section id="alerts" title="Telegram alerts" hint="Get new jobs from scheduled scans on your phone. Saved right away.">
                <TelegramAlerts onChanged={onSaved} />
              </Section>
              <Section id="send" title="What to send" hint="Which Telegram messages you get once it's connected. Saved right away.">
                <div className="space-y-4">
                  <div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <Toggle checked={draft.alerts.only_new} onChange={(v) => void saveSwitch("only_new", v)}>
                        After a scheduled scan, only jobs I haven't been sent before
                      </Toggle>
                      <SaveNote state={switchSave.only_new} />
                    </div>
                    <p className="mt-1 type-small text-muted">Turn off to get every strong match after each scheduled scan, even ones you've had.</p>
                  </div>
                  <UpdateTelegramSetting />
                </div>
              </Section>
            </>
          ),
        )}

        {page("appearance", <AppearanceSection />)}

        {page(
          "keyboard",
          <Section id="shortcuts" title="Keyboard shortcuts" hint="Single keys work anywhere except while you type in a field. Press ? to see them at any time.">
            <ShortcutList canScan={canScan} className="max-w-md space-y-2 type-small" />
          </Section>,
        )}

        {page(
          "data",
          <>
            <TrackingData user={user} prefs={prefs} onImport={onImport} />
            <Section id="sharing" title="Sharing" hint="Help everyone find more companies. On by default; turn it off here. Saved right away.">
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <Toggle checked={draft.directory.share_additions} onChange={(v) => void saveSwitch("share_additions", v)}>
                    Share companies I add or update by link
                  </Toggle>
                  <SaveNote state={switchSave.share_additions} />
                </div>
                <p className="type-small text-muted">
                  Only the careers link is shared: the company's name, its hiring system and its board name. When you confirm a company's new careers link, just the two links and the company's name
                  are shared too, with the next directory update. Never your profile, resume, searches or which jobs you look at.{" "}
                  <a
                    href="https://github.com/Tanmay-Mhatre/rawjobs/blob/main/PRIVACY.md"
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium text-ink underline underline-offset-2 hover:text-muted"
                  >
                    What is sent, and where
                  </a>
                </p>
              </div>
            </Section>
            <Section id="tips" title="Tips you've closed" hint="The setup checklist on the Radar and the suggestions to go back to past employers.">
              <ShowTipsAgain />
            </Section>
            {onStartOver && (
              <div className="space-y-2 pt-4">
                <h3 className="type-label text-danger-text">Danger zone</h3>
                <Section
                  id="reset"
                  title="Start setup over"
                  hint="Clears your setup answers: profile, roles, places, keywords and companies. Your tracked jobs, notes, saved views, resume and Telegram alerts stay."
                >
                  <StartOver onStartOver={onStartOver} />
                </Section>
              </div>
            )}
          </>,
        )}

        {page(
          "updates",
          <>
            {shown.version && (
              <Section id="version" title="RawJobs" hint="Which version you have, and what's newer.">
                <AboutRawJobs />
              </Section>
            )}
            {shown.shortcut && updates.status && (
              <Section id="shortcut" title="Desktop shortcut" hint="Opens RawJobs at the right address, even after a restart. No address to remember.">
                <DesktopShortcutSettings status={updates.status} setStatus={updates.setStatus} />
              </Section>
            )}
            {shown.update && (
              <Section id="update" title="Updates" hint="New versions come from RawJobs' releases on GitHub, and install only when you say.">
                <UpdatesSettings />
              </Section>
            )}
          </>,
        )}

        {page(
          "whats-new",
          shown["release-notes"] && (
            <Section id="release-notes" title="Release notes" hint="What changed in each version.">
              <ReleaseNotes />
            </Section>
          ),
        )}

        {!canRunLocally && dirty && onDraftPage && (
          <p className="mt-6 rounded-md border border-line bg-raised p-3 type-small text-muted">This online copy doesn't save changes. To keep your setup, run RawJobs on your computer.</p>
        )}
        {canRunLocally && dirty && !onDraftPage && (
          <div className="sticky bottom-16 z-10 mt-6 flex flex-wrap items-center gap-2 rounded-md border border-line bg-raised/95 p-3 shadow-l2 backdrop-blur md:bottom-4">
            <span className="mr-auto type-small text-muted">You have unsaved changes on {dirtyPage === "matching" ? "Matching" : "Profile"}.</span>
            <Button size="sm" onClick={() => (location.hash = settingsHash(dirtyPage))}>
              Review and save <ArrowRight className="size-3.5" />
            </Button>
          </div>
        )}
        {canRunLocally && ((dirty && onDraftPage) || status) && (
          <div className="sticky bottom-16 z-10 mt-6 rounded-md border border-line bg-raised/95 p-3 shadow-l2 backdrop-blur md:bottom-4">
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
            {dirty && onDraftPage && (
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

type FieldSave = { kind: "idle" | "saving" | "saved" } | { kind: "error"; retry: () => void };
/** The switches outside Profile and Matching that are kept in the config file. */
type InstantSwitch = "auto_update" | "share_additions" | "only_new";

/** Bring back the tips you've closed; each shows again where it applies. */
function ShowTipsAgain() {
  const [done, setDone] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button
        size="sm"
        onClick={() => {
          save(CHECKLIST_DISMISSED_KEY, false);
          save(GO_BACK_DISMISSED_KEY, []);
          setDone(true);
        }}
      >
        Show them again
      </Button>
      {done && (
        <span role="status" className="inline-flex items-center gap-1 type-small text-muted">
          <Check className="size-3.5 text-success-text" aria-hidden="true" /> Done. They show again where they apply.
        </span>
      )}
    </div>
  );
}

/** Next to a switch that saves on its own: "Saving…", "Saved", or what went wrong with Try again. */
function SaveNote({ state }: { state?: FieldSave }) {
  if (!state || state.kind === "idle") return null;
  if (state.kind === "error")
    return (
      <span role="alert" className="inline-flex items-center gap-1.5 type-small text-danger-text">
        Couldn't save. Make sure RawJobs is still running.
        <button type="button" className="min-h-6 font-medium underline" onClick={state.retry}>
          Try again
        </button>
      </span>
    );
  return (
    <span role="status" className="inline-flex items-center gap-1 type-small text-muted">
      {state.kind === "saving" ? (
        "Saving…"
      ) : (
        <>
          <Check className="size-3.5 text-success-text" aria-hidden="true" /> Saved
        </>
      )}
    </span>
  );
}

type NavPage = (typeof SETTINGS_PAGES)[number];

/** Move to a page and put focus on its heading, so a screen reader starts there. */
function goToPage(e: MouseEvent, id: SettingsPageId) {
  e.preventDefault();
  location.hash = settingsHash(id);
  requestAnimationFrame(() => document.getElementById(`settings-page-${id}`)?.focus({ preventScroll: true }));
}

/**
 * The pages, under their group headings. On a computer, a sidebar beside the page. On a phone, a bare
 * "#settings" shows this list as the whole screen (`onList`); a page then has a Back link to it.
 */
function SettingsNav({ pages, current, onList, searching, children }: { pages: readonly NavPage[]; current: SettingsPageId; onList: boolean; searching: boolean; children: ReactNode }) {
  return (
    <nav aria-label="Settings pages" className={cx("mb-6 md:sticky md:top-20 md:mb-0", !onList && !searching && "max-md:hidden")}>
      <p className="mb-3 type-subheading md:hidden" aria-hidden="true">
        Settings
      </p>
      {children}
      {/* While searching on a phone, the results take the list's place. */}
      <div className={cx(searching && "max-md:hidden")}>
        {SETTINGS_GROUPS.map((group) => {
          const inGroup = pages.filter((p) => p.group === group);
          if (!inGroup.length) return null;
          return (
            <Fragment key={group}>
              <p className="mb-1 mt-5 px-3 type-meta font-medium text-muted first:mt-0 md:px-2" aria-hidden="true">
                {group}
              </p>
              <ul aria-label={group} className="divide-y divide-line overflow-hidden rounded-md border border-line bg-raised md:divide-y-0 md:overflow-visible md:border-0 md:bg-transparent">
                {inGroup.map((p) => (
                  <li key={p.id}>
                    <a
                      href={`#${settingsHash(p.id)}`}
                      aria-current={p.id === current ? "page" : undefined}
                      onClick={(e) => goToPage(e, p.id)}
                      className={cx(
                        "flex min-h-11 items-center gap-2 px-3 type-label md:min-h-9 md:rounded-md md:px-2",
                        p.id === current ? "md:bg-active md:text-ink" : "text-ink md:text-muted md:hover:bg-inset md:hover:text-ink",
                      )}
                    >
                      <span className="min-w-0 flex-1">
                        {p.label}
                        <span className="block truncate type-meta font-normal text-muted md:hidden">{p.hint}</span>
                      </span>
                      <ChevronRight className="size-4 text-muted md:hidden" aria-hidden="true" />
                    </a>
                  </li>
                ))}
              </ul>
            </Fragment>
          );
        })}
      </div>
    </nav>
  );
}

/** One Settings page: its heading and cards. Hidden unless it's the current one. */
function SettingsPage({ id, current, onList, children }: { id: SettingsPageId; current: SettingsPageId | null; onList: boolean; children: ReactNode }) {
  const meta = SETTINGS_PAGES.find((p) => p.id === id)!;
  return (
    <div hidden={id !== current} className="space-y-4">
      {!onList && (
        <a href="#settings" className="-ml-1 inline-flex h-9 items-center gap-1 type-label text-muted hover:text-ink md:hidden">
          <ChevronLeft className="size-4" aria-hidden="true" /> Settings
        </a>
      )}
      <div>
        <h2 id={`settings-page-${id}`} tabIndex={-1} className="type-subheading text-ink outline-none">
          {meta.label}
        </h2>
        <p className="mt-0.5 type-small text-muted">{meta.hint}</p>
      </div>
      {children}
    </div>
  );
}

/** Theme, contrast and density: saved on this computer (profile/tracking.json) and applied at once, so they're not part of Save. */
function AppearanceSection() {
  const { theme, contrast, setTheme, setContrast } = useTheme();
  const density = useDensity();
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
      </Section>
    </>
  );
}

/** The Radar's age limit: saved with the appearance choices and applied at once. */
function MaxAgeSection() {
  const maxAge = useMaxAge();
  return (
    <Section id="max-age" title="Hide jobs older than" hint={canRunLocally ? "Saved on this computer, right away." : "Saved in this browser, right away."}>
      <Segmented<MaxAge>
        label="Hide jobs older than"
        value={maxAge}
        onChange={setMaxAgeChoice}
        options={MAX_AGE_CHOICES.map((d) => ({ value: d, label: d === 0 ? "Never hide" : d === 30 ? "1 month" : `${d / 30} months` }))}
      />
      <p className="mt-2 type-small text-muted">Most roles are filled within two months, so older postings are often still listed but no longer hiring. Jobs you saved or applied to always show.</p>
    </Section>
  );
}

/** The Not interested rules, each with Remove. */
function HideRules({ rules, onRemoveRule }: { rules: readonly HideRule[]; onRemoveRule?: (rule: HideRule) => void }) {
  if (!rules.length) return <p className="type-small text-muted">No rules yet. When you mark a job Not interested and say why, you can turn the reason into a rule here.</p>;
  return (
    <>
      <ul className="divide-y divide-line rounded-md border border-line">
        {rules.map((r) => (
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
      <p className="mt-2 type-small text-muted">To see hidden jobs anyway, turn on &ldquo;Include hidden jobs and companies&rdquo; under More on the Radar.</p>
    </>
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
            <Button
              size="sm"
              variant={expanded ? "ghost" : "outline"}
              aria-expanded={expanded}
              aria-controls={`body-${id}`}
              aria-label={`${expanded ? "Done editing" : "Edit"} ${title.toLowerCase()}`}
              onClick={onToggle}
            >
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

function TrackingData({ user, prefs, onImport }: { user: UserState; prefs: Prefs; onImport: (s: UserState, prefs?: Partial<Prefs>) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<{ tone: "ok" | "bad"; text: string; detail?: string } | null>(null);
  /** A file read and waiting for "Replace N jobs". */
  const [pending, setPending] = useState<Awaited<ReturnType<typeof readStateFile>> | null>(null);
  const tracked = Object.keys(user).length;

  const apply = (next: Awaited<ReturnType<typeof readStateFile>>) => {
    onImport(next.state, next.prefs);
    const skipped = next.skipped ? ` Left out ${next.skipped} that couldn't be read.` : "";
    setMsg({ tone: "ok", text: `Imported ${Object.keys(next.state).length} tracked jobs.${skipped}` });
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
            Your profile, roles, places, keywords and companies are cleared and setup opens from the start. Tracked jobs, notes, your resume and Telegram alerts stay. A copy of your old setup is kept
            in <span className="font-mono">rawjobs.config.local.backup.yaml</span>.
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

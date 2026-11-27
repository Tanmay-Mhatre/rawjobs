import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DataMeta } from "../lib/data";
import { draftFromConfig, draftToConfig, emptyDraft, rebaseDraft, type Draft, type SetupStatus } from "../lib/setup";
import { toast } from "../components/Toast";
import { reloadingByApp } from "../lib/reload";
import { load, save } from "../lib/storage";

export const DRAFT_KEY = "rawjobs.setupDraft.v1";
/** The first-visit Welcome has been answered (Start or Skip); never auto-open it again. */
export const WELCOME_SEEN_KEY = "rawjobs.welcomeSeen";
/**
 * Unsaved Profile and Matching edits, kept in this browser (never copied to your RawJobs folder) so a
 * reload or a closed tab doesn't lose them. `base` is the saved setup they were made on: a newer save
 * from elsewhere is merged under them when they come back.
 */
export const SETTINGS_DRAFT_KEY = "rawjobs.settingsDraft.v1";
type StoredSettingsDraft = { base: Draft; draft: Draft };
/** How long typing waits before the unsaved edits are written to this browser. */
const DRAFT_WRITE_MS = 500;
const sameConfig = (a: Draft, b: Draft) => JSON.stringify(draftToConfig(a)) === JSON.stringify(draftToConfig(b));

/**
 * The saved setup, and the working copy the wizard and Settings edit. A newer save made elsewhere
 * (the Companies page saves itself) is merged under unsaved edits; an unfinished first-time setup
 * resumes from this browser.
 */
export function useSetupDraft(status: SetupStatus | null | undefined, meta: DataMeta | undefined) {
  const personal = !!status?.isPersonal;
  const saved = useMemo<Draft>(() => {
    if (status?.config) return draftFromConfig(status.config);
    if (status?.raw) return draftFromConfig(status.raw);
    if (status === null && meta) return draftFromConfig({ profile: meta.profile, companies: meta.companies });
    return emptyDraft();
  }, [status, meta]);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  /** The saved setup (or this browser's unfinished draft) is in place: until then `draft` is a blank one. */
  const [loaded, setLoaded] = useState(false);
  const appliedRef = useRef<string>("");
  /** The saved setup the draft was last based on, so a newer save can be merged under unsaved edits. */
  const baseRef = useRef<Draft | null>(null);
  useEffect(() => {
    if (status === undefined) return;
    const key = JSON.stringify(draftToConfig(saved));
    if (key === appliedRef.current) return;
    appliedRef.current = key;
    setLoaded(true);
    const base = baseRef.current;
    baseRef.current = saved;
    // The config was saved from elsewhere (the Companies page saves itself): keep unsaved edits.
    if (personal && base) return setDraft((d) => rebaseDraft(d, base, saved));
    // Settings edits not saved before a reload come back, merged onto the setup saved since.
    if (personal) {
      const kept = load<StoredSettingsDraft | null>(SETTINGS_DRAFT_KEY, null);
      const restored = kept?.draft && kept.base ? rebaseDraft({ ...emptyDraft(), ...kept.draft }, { ...emptyDraft(), ...kept.base }, saved) : null;
      if (!restored || sameConfig(restored, saved)) return setDraft(saved);
      setDraft(restored);
      toast({
        message: "Your unsaved changes to Profile and Matching are back.",
        actionLabel: "Discard",
        onAction: () => {
          setDraft(baseRef.current ?? saved);
          toast({ message: "Discarded your unsaved changes" });
        },
      });
      return;
    }
    // First-time setup resumes an unfinished draft from this browser.
    const stored = status !== null ? load<Draft | null>(DRAFT_KEY, null) : null;
    setDraft(stored ? { ...emptyDraft(), ...stored } : saved);
  }, [saved, status, personal]);
  useEffect(() => {
    if (status && !status.isPersonal) save(DRAFT_KEY, draft);
  }, [draft, status]);
  const update = useCallback((patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch })), []);
  const dirty = !sameConfig(draft, saved);
  // Keep unsaved Settings edits in this browser (written a moment after typing stops, and at once
  // when the page goes away); forget them once they're saved or undone.
  const keep = personal && loaded;
  useEffect(() => {
    if (!keep) return;
    if (!dirty) return void save(SETTINGS_DRAFT_KEY, null);
    const write = () => save(SETTINGS_DRAFT_KEY, { base: saved, draft } satisfies StoredSettingsDraft);
    const t = setTimeout(write, DRAFT_WRITE_MS);
    window.addEventListener("pagehide", write);
    return () => {
      clearTimeout(t);
      window.removeEventListener("pagehide", write);
    };
  }, [keep, dirty, saved, draft]);
  // While there are unsaved edits, the browser asks before you leave (its own words). Not when the
  // app reloads the page itself: the edits are kept and come back.
  useEffect(() => {
    if (!keep || !dirty) return;
    const ask = (e: BeforeUnloadEvent) => {
      if (reloadingByApp()) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", ask);
    return () => window.removeEventListener("beforeunload", ask);
  }, [keep, dirty]);
  /** Start over: forget the base, so the next saved setup isn't merged into an old draft. */
  const forgetBase = useCallback(() => {
    baseRef.current = null;
  }, []);
  return { saved, draft, setDraft, update, dirty, forgetBase, loaded };
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DataMeta } from "../lib/data";
import { draftFromConfig, draftToConfig, emptyDraft, rebaseDraft, type Draft, type SetupStatus } from "../lib/setup";
import { load, save } from "../lib/storage";

export const DRAFT_KEY = "rawjobs.setupDraft.v1";
/** The first-visit Welcome has been answered (Start or Skip); never auto-open it again. */
export const WELCOME_SEEN_KEY = "rawjobs.welcomeSeen";
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
  /** Start over: forget the base, so the next saved setup isn't merged into an old draft. */
  const forgetBase = useCallback(() => {
    baseRef.current = null;
  }, []);
  return { saved, draft, setDraft, update, dirty, forgetBase };
}

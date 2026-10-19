import { useCallback, useEffect, useState } from "react";
import { DEFAULT_FILTERS, type Filters, type Sort } from "./filters";
import { ruleKey, type HideRule } from "./notForMe";
import { load, save } from "./storage";
import { useSavedOnDisk } from "./tracking";

/** A named filter + sort combination the user saved on the Radar. */
export type SavedView = { id: string; name: string; filters: Filters; sort: Sort };

/** Radar preferences, saved with your tracking (on this computer and in this browser) and in its export. */
export type Prefs = {
  views: SavedView[];
  /** Company names whose jobs are hidden from the Radar. */
  hiddenCompanies: string[];
  /** Rules you confirmed after a Not interested reason ("Hide senior roles"). Older exports have none. */
  hideRules: HideRule[];
  /** Applications a week you aim for (Pipeline insights and the weekly Telegram summary). */
  weeklyGoal?: number;
};

const KEY = "rawjobs.prefs.v1";
const EMPTY: Prefs = { views: [], hiddenCompanies: [], hideRules: [] };
/** Missing or broken lists (older exports, hand edits) become empty ones. */
export const withDefaults = (p: Partial<Prefs>): Prefs => ({
  ...EMPTY,
  ...p,
  // Views saved before a filter existed (Type) get its default, so every filter is there.
  views: Array.isArray(p.views) ? p.views.map((v) => ({ ...v, filters: { ...DEFAULT_FILTERS, ...v.filters } })) : [],
  hiddenCompanies: Array.isArray(p.hiddenCompanies) ? p.hiddenCompanies : [],
  hideRules: Array.isArray(p.hideRules) ? p.hideRules : [],
  weeklyGoal: typeof p.weeklyGoal === "number" && p.weeklyGoal >= 1 && p.weeklyGoal <= 100 ? Math.round(p.weeklyGoal) : undefined,
});

/** Add a rule; one with the same key (a pay rule in the same currency and period) is replaced. */
export const addRule = (rules: HideRule[], rule: HideRule) => [...rules.filter((r) => ruleKey(r) !== ruleKey(rule)), rule];
export const removeRule = (rules: HideRule[], rule: HideRule) => rules.filter((r) => ruleKey(r) !== ruleKey(rule));

export function usePrefs() {
  const [prefs, setPrefs] = useState<Prefs>(() => withDefaults(load<Partial<Prefs>>(KEY, {})));
  useEffect(() => save(KEY, prefs), [prefs]);
  useSavedOnDisk<Prefs>("prefs", prefs, (p) => setPrefs(withDefaults(p)));

  const saveView = useCallback((name: string, filters: Filters, sort: Sort) => {
    const view: SavedView = { id: `v${Date.now().toString(36)}`, name: name.trim(), filters, sort };
    setPrefs((p) => ({ ...p, views: [...p.views, view] }));
    return view;
  }, []);
  const renameView = useCallback((id: string, name: string) => setPrefs((p) => ({ ...p, views: p.views.map((v) => (v.id === id ? { ...v, name: name.trim() } : v)) })), []);
  const deleteView = useCallback((id: string) => setPrefs((p) => ({ ...p, views: p.views.filter((v) => v.id !== id) })), []);
  /** Undo a delete: put the view back where it was. */
  const restoreView = useCallback(
    (view: SavedView, index: number) => setPrefs((p) => (p.views.some((v) => v.id === view.id) ? p : { ...p, views: [...p.views.slice(0, index), view, ...p.views.slice(index)] })),
    [],
  );
  const setCompanyHidden = useCallback(
    (company: string, hidden: boolean) => setPrefs((p) => ({ ...p, hiddenCompanies: hidden ? [...new Set([...p.hiddenCompanies, company])] : p.hiddenCompanies.filter((c) => c !== company) })),
    [],
  );
  /** Turn a rule on or off (Undo, and the list under More). */
  const setRule = useCallback((rule: HideRule, on: boolean) => setPrefs((p) => ({ ...p, hideRules: on ? addRule(p.hideRules, rule) : removeRule(p.hideRules, rule) })), []);
  const replacePrefs = useCallback((next: Partial<Prefs>) => setPrefs(withDefaults(next)), []);
  const setWeeklyGoal = useCallback((weeklyGoal: number | undefined) => setPrefs((p) => withDefaults({ ...p, weeklyGoal })), []);

  return { prefs, saveView, renameView, deleteView, restoreView, setCompanyHidden, setRule, replacePrefs, setWeeklyGoal };
}

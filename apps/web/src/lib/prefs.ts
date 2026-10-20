import { useCallback, useEffect, useState } from "react";
import { DEFAULT_FILTERS, type Filters, type Sort } from "./filters";
import { ruleKey, type HideRule } from "./notForMe";
import { load, save, saveFailed } from "./storage";
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
  /** What you aim to do each week (Pipeline insights and the weekly Telegram summary). */
  weeklyPlan: WeeklyPlan;
  /** The v1 applications goal: still written (= weeklyPlan.applications) so older versions read it. */
  weeklyGoal?: number;
};

/** Activity you control, per week, each 1 to PLAN_MAX: applications, follow-ups sent, outreach and referrals. */
export type WeeklyPlan = { applications?: number; followUps?: number; outreach?: number };
export const PLAN_MAX = 50;

/** A goal from 1 to PLAN_MAX, or nothing. */
const goal = (v: unknown) => (typeof v === "number" && v >= 1 && v <= PLAN_MAX ? Math.round(v) : undefined);

/** The plan from `weeklyPlan`; applications fall back to the v1 `weeklyGoal` (1 to 100 then, so a bigger one becomes the most allowed). */
export function planOf(p: Partial<Prefs>): WeeklyPlan {
  const raw = (p.weeklyPlan && typeof p.weeklyPlan === "object" ? p.weeklyPlan : {}) as Record<string, unknown>;
  const legacy = typeof p.weeklyGoal === "number" && p.weeklyGoal >= 1 ? Math.min(PLAN_MAX, Math.round(p.weeklyGoal)) : undefined;
  const plan: WeeklyPlan = { applications: goal(raw.applications) ?? legacy, followUps: goal(raw.followUps), outreach: goal(raw.outreach) };
  for (const k of Object.keys(plan) as (keyof WeeklyPlan)[]) if (plan[k] === undefined) delete plan[k];
  return plan;
}

const KEY = "rawjobs.prefs.v1";
const EMPTY: Prefs = { views: [], hiddenCompanies: [], hideRules: [], weeklyPlan: {} };
/** Missing or broken lists (older exports, hand edits) become empty ones. */
export const withDefaults = (p: Partial<Prefs>): Prefs => {
  const weeklyPlan = planOf(p);
  return {
    ...EMPTY,
    ...p,
    // Views saved before a filter existed (Type) get its default, so every filter is there.
    views: Array.isArray(p.views) ? p.views.map((v) => ({ ...v, filters: { ...DEFAULT_FILTERS, ...v.filters } })) : [],
    hiddenCompanies: Array.isArray(p.hiddenCompanies) ? p.hiddenCompanies : [],
    hideRules: Array.isArray(p.hideRules) ? p.hideRules : [],
    weeklyPlan,
    weeklyGoal: weeklyPlan.applications,
  };
};

/** Add a rule; one with the same key (a pay rule in the same currency and period) is replaced. */
export const addRule = (rules: HideRule[], rule: HideRule) => [...rules.filter((r) => ruleKey(r) !== ruleKey(rule)), rule];
export const removeRule = (rules: HideRule[], rule: HideRule) => rules.filter((r) => ruleKey(r) !== ruleKey(rule));

export function usePrefs() {
  const [prefs, setPrefs] = useState<Prefs>(() => withDefaults(load<Partial<Prefs>>(KEY, {})));
  useEffect(() => {
    if (!save(KEY, prefs)) saveFailed();
  }, [prefs]);
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
  // The v1 goal follows the plan, so a cleared goal stays cleared.
  const setWeeklyPlan = useCallback((weeklyPlan: WeeklyPlan) => setPrefs((p) => withDefaults({ ...p, weeklyPlan, weeklyGoal: weeklyPlan.applications })), []);

  return { prefs, saveView, renameView, deleteView, restoreView, setCompanyHidden, setRule, replacePrefs, setWeeklyPlan };
}

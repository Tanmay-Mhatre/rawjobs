import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import { jobCompanyKey, keyOf, refOfJob, toRow } from "../lib/companies";
import { toast } from "../components/Toast";
import { copyDetails } from "../lib/copyDetails";
import { companyName } from "../lib/format";
import { causeOf, checkNow, draftToConfig, saveConfig, type Draft, type SaveCause } from "../lib/setup";
import type { Job } from "../lib/data";
import type { CompanyRef } from "@rawjobs/core/schema";

/** How a change to your companies went: saved, or why not (the raw `errors` are for Copy details only). */
export type CompanySave = { ok: true } | { ok: false; cause: SaveCause; errors: string };

/**
 * "Couldn't update My companies": offline asks to check RawJobs is running; anything else offers the
 * details for a bug report. Never the raw server text.
 */
export function companySaveFailedToast(res: Extract<CompanySave, { ok: false }>, retry: () => void) {
  const offline = res.cause === "offline";
  toast({
    message: offline ? "Couldn't update My companies. Check that RawJobs is running, then try again." : "Couldn't update My companies. Try again, or copy the details if it keeps happening.",
    actions: [
      { label: "Try again", onClick: retry, primary: true },
      ...(offline ? [] : [{ label: "Copy details", onClick: () => void copyDetails({ action: "Update My companies", cause: res.cause, errors: res.errors }) }]),
    ],
  });
}

type Options = {
  /** The saved setup the changes apply to. */
  saved: Draft;
  /** Config can be saved here (the local app, set up). */
  canSave: boolean;
  /** Your companies: from your config, or (hosted build) from the last scan. */
  configCompanies: readonly CompanyRef[] | undefined;
  scannedCompanies: readonly CompanyRef[] | undefined;
  jobs: readonly Job[];
  setCompanyHidden: (company: string, hidden: boolean) => void;
  refreshSetup: () => Promise<void>;
  reload: () => Promise<unknown>;
};

/** Your companies, from the Radar: add, remove, mute, check now. */
export function useCompanyActions({ saved, canSave, configCompanies, scannedCompanies, jobs, setCompanyHidden, refreshSetup, reload }: Options) {
  /** Your companies' keys: from your config, or (hosted build) from the last scan. */
  const yourKeys = useMemo(() => new Set((configCompanies ?? scannedCompanies ?? []).map(keyOf)), [configCompanies, scannedCompanies]);
  const isYours = useCallback((j: Job) => yourKeys.has(jobCompanyKey(j)), [yourKeys]);
  // The latest saved setup: an Undo or Try again runs from a toast after the setup has moved on.
  const latest = useRef(saved);
  useLayoutEffect(() => {
    latest.current = saved;
  });
  const saveCompanies = useCallback(
    async (patch: (d: Draft) => Partial<Draft>): Promise<CompanySave> => {
      const now = latest.current;
      const res = await saveConfig(draftToConfig({ ...now, ...patch(now) }));
      if (!res.ok) return { ok: false, cause: causeOf(res), errors: res.errors };
      await refreshSetup();
      return { ok: true };
    },
    [refreshSetup],
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
    async (company: string, hidden: boolean): Promise<CompanySave> => {
      setCompanyHidden(company, hidden);
      const job = jobs.find((j) => j.company === company);
      if (!canSave || !job) return { ok: true };
      const key = jobCompanyKey(job);
      const mute = () => saveCompanies((d) => ({ muted: hidden ? [...new Set([...d.muted, key])] : d.muted.filter((k) => k !== key) }));
      const res = await mute();
      // Hidden here either way; only the config (what scans check) didn't change. Every caller (the
      // Radar's Hide, Not for me, the job menu) gets the same toast, which replaces its "Hid …" one.
      if (!res.ok && hidden) {
        const again = async () => {
          const r = await mute();
          if (r.ok) toast({ message: `Scans will no longer check ${companyName(company)}.` });
          else hideFailed();
        };
        const hideFailed = () =>
          toast({ message: `Hid ${companyName(company)} here, but scans will still check it. Try again to stop them.`, actions: [{ label: "Try again", onClick: () => void again(), primary: true }] });
        hideFailed();
      }
      return res;
    },
    [setCompanyHidden, jobs, canSave, saveCompanies],
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

  return { yourKeys, isYours, saveCompanies, trackJob, hideCompany, checkJob };
}

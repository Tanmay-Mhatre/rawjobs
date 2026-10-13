import { useCallback, useMemo } from "react";
import { jobCompanyKey, keyOf, refOfJob, toRow } from "../lib/companies";
import { checkNow, draftToConfig, saveConfig, type Draft } from "../lib/setup";
import type { Job } from "../lib/data";
import type { CompanyRef } from "@rawjobs/core/schema";

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
  const saveCompanies = useCallback(
    async (patch: (d: Draft) => Partial<Draft>): Promise<string | null> => {
      const res = await saveConfig(draftToConfig({ ...saved, ...patch(saved) }));
      if (!res.ok) return res.errors;
      await refreshSetup();
      return null;
    },
    [saved, refreshSetup],
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
      setCompanyHidden(company, hidden);
      const job = jobs.find((j) => j.company === company);
      if (!canSave || !job) return;
      const key = jobCompanyKey(job);
      void saveCompanies((d) => ({ muted: hidden ? [...new Set([...d.muted, key])] : d.muted.filter((k) => k !== key) }));
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

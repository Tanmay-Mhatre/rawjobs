import { existsSync, readFileSync, renameSync } from "node:fs";
import { join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { CONFIG_CANDIDATES, LEGACY_CONFIG_CANDIDATES } from "./config";
import { careersUrl, companyKey, detectCompany, getConnector } from "./connectors";
import { HttpClient, HttpError } from "./http";
import { RESUME_PATH } from "./resume";
import { ConfigSchema, type AtsType, type Config, type Profile } from "./schema";
import { passesGates } from "./score";
import { configToYaml } from "./yaml-writer";
import { defaultDataDir, rawjobsHome } from "./paths";
import { writeFileAtomic } from "./atomic";

/** The user's own config. The shipped rawjobs.config.example.yaml is only an example. */
export const PERSONAL_CONFIG = CONFIG_CANDIDATES[0]!;

/** The personal config file: rawjobs.config.local.yaml, or the pre-rename jobhunter one while that's the only one there. */
export function personalConfigPath(cwd = rawjobsHome()): string {
  const path = resolve(cwd, PERSONAL_CONFIG);
  const legacy = resolve(cwd, LEGACY_CONFIG_CANDIDATES[0]!);
  return !existsSync(path) && existsSync(legacy) ? legacy : path;
}

export type SetupStatus = {
  configPath: string;
  /** A personal config file exists. */
  isPersonal: boolean;
  valid: boolean;
  /** Human-readable validation problems when the personal config is broken. */
  errors?: string;
  config?: Config;
  /** Whatever could be parsed from a broken config, for the wizard to prefill from. */
  raw?: unknown;
  /** A run has written data. */
  hasData: boolean;
  /** A master resume is saved (profile/resume.md). */
  hasResume: boolean;
};

export function setupStatus(cwd = rawjobsHome(), dataDir = defaultDataDir(cwd)): SetupStatus {
  const configPath = personalConfigPath(cwd);
  const hasData = existsSync(join(dataDir, "jobs.json"));
  const hasResume = existsSync(resolve(cwd, RESUME_PATH));
  if (!existsSync(configPath)) return { configPath, isPersonal: false, valid: false, hasData, hasResume };

  let raw: unknown;
  try {
    raw = parseYaml(readFileSync(configPath, "utf8"));
  } catch (err) {
    return { configPath, isPersonal: true, valid: false, errors: `Not valid YAML: ${(err as Error).message}`, hasData, hasResume };
  }
  const parsed = ConfigSchema.safeParse(raw);
  return parsed.success
    ? { configPath, isPersonal: true, valid: true, config: parsed.data, hasData, hasResume }
    : { configPath, isPersonal: true, valid: false, errors: z.prettifyError(parsed.error), raw, hasData, hasResume };
}

export type SaveResult = { ok: true; path: string } | { ok: false; errors: string; issues: { path: string; message: string }[] };

/** Validate a config object (from the wizard) and write it as commented YAML. */
export function saveConfig(input: unknown, cwd = rawjobsHome()): SaveResult {
  const parsed = ConfigSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      errors: z.prettifyError(parsed.error),
      issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    };
  }
  const path = personalConfigPath(cwd);
  writeFileAtomic(path, configToYaml(parsed.data));
  return { ok: true, path };
}

/** Where a reset puts the old config, so it can be restored by hand. */
export const CONFIG_BACKUP = "rawjobs.config.local.backup.yaml";

/** Start setup over: move the personal config aside (replacing an older backup). Resume and secrets stay. */
export function resetConfig(cwd = rawjobsHome()): { ok: true; backup: string | null } {
  const path = personalConfigPath(cwd);
  if (!existsSync(path)) return { ok: true, backup: null };
  const backup = resolve(cwd, CONFIG_BACKUP);
  renameSync(path, backup);
  return { ok: true, backup };
}

export type CompanyCheck = {
  input: string;
  /**
   * live: board has open jobs · dormant: board exists, no openings right now · soon: recognised
   * ATS, connector not built yet · error: recognised but the feed failed (usually a wrong link) ·
   * unknown: not a careers site we recognise.
   */
  status: "live" | "dormant" | "soon" | "error" | "unknown";
  /** Directory key ("ats:slug"). */
  key?: string;
  name?: string;
  /** Where the name came from: the hiring system itself, our company directory, or the link. */
  name_source?: "ats" | "directory" | "slug";
  ats?: AtsType;
  slug?: string;
  region?: "global" | "eu";
  shard?: string;
  site?: string;
  careers_url?: string;
  open_jobs?: number;
  /** Most common job locations, most frequent first. */
  top_locations?: string[];
  sample_titles?: string[];
  /** Open jobs that pass the user's title and location filters (when a profile is given). */
  matches?: number;
  match_examples?: string[];
  /** Already in the company directory. */
  in_directory?: boolean;
  error?: string;
};

export type CheckOptions = {
  http?: HttpClient;
  /** Count the jobs that match this profile. */
  profile?: Profile;
  /** Company directory names by key, to mark known companies and borrow their names. */
  directory?: ReadonlyMap<string, { name: string }>;
};

/**
 * Detect each careers URL and, where we have a connector, fetch it once: the result carries
 * everything the company directory records, plus how many jobs match the user.
 */
export async function checkCompanies(inputs: readonly string[], opts: CheckOptions = {}): Promise<CompanyCheck[]> {
  const http = opts.http ?? new HttpClient({ retries: 1 });
  const now = new Date();
  const out: CompanyCheck[] = [];
  for (const raw of inputs) {
    const input = raw.trim();
    if (!input) continue;
    const found = detectCompany(input);
    if (!found) {
      out.push({ input, status: "unknown", error: "Not a careers site RawJobs can read yet." });
      continue;
    }
    const { supported, name: guessed, ...ref } = found;
    const key = companyKey(ref);
    const known = opts.directory?.get(key);
    const base: CompanyCheck = {
      input,
      status: "soon",
      key,
      name: known?.name ?? guessed,
      name_source: known ? "directory" : "slug",
      ...ref,
      careers_url: careersUrl(ref) || input,
      in_directory: !!known,
    };
    if (ref.ats === "workday" && !ref.site) {
      out.push({ ...base, status: "error", error: "Use the full Workday link, including the site name (e.g. …/en-US/External)." });
      continue;
    }
    if (!supported) {
      out.push(base);
      continue;
    }
    try {
      const connector = getConnector(ref.ats)!;
      const company = { ...ref, name: base.name!, enabled: true };
      const jobs = await connector.fetch(company, { http, now });
      if (!jobs.length) {
        // Greenhouse, Lever and Ashby answer 404 for a wrong name, so an empty board is real.
        // SmartRecruiters answers 200 + nothing for any made-up id, so we can't tell.
        out.push(
          ref.ats === "smartrecruiters"
            ? { ...base, status: "error", error: "No open jobs on this board. Check the link: SmartRecruiters shows an empty board for a wrong company name." }
            : { ...base, status: "dormant", open_jobs: 0, top_locations: [], sample_titles: [], ...(opts.profile ? { matches: 0, match_examples: [] } : {}) },
        );
        continue;
      }
      const normalized = jobs.map((j) => connector.normalize(j, company));
      const places = new Map<string, number>();
      for (const j of normalized) {
        const place = j.location.split(/[,;|/]/)[0]!.trim();
        if (place) places.set(place, (places.get(place) ?? 0) + 1);
      }
      const result: CompanyCheck = {
        ...base,
        status: "live",
        open_jobs: jobs.length,
        top_locations: [...places.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([p]) => p)
          .slice(0, 5),
        sample_titles: [...new Set(normalized.map((j) => j.title))].slice(0, 3),
      };
      if (opts.profile) {
        const matching = normalized.filter((j) => passesGates(j, opts.profile!));
        result.matches = matching.length;
        result.match_examples = matching.slice(0, 3).map((j) => (j.location ? `${j.title} (${j.location})` : j.title));
      }
      // Greenhouse and SmartRecruiters tell us the real company name.
      const first = jobs[0] as { company_name?: string; company?: { name?: string } } | undefined;
      const realName = first?.company_name ?? first?.company?.name;
      if (realName) Object.assign(result, { name: realName, name_source: "ats" });
      out.push(result);
    } catch (err) {
      const msg = err instanceof HttpError && err.status === 404 ? "Not found. Check the link: open it in a browser and copy the careers page address." : (err as Error).message;
      out.push({ ...base, status: "error", error: msg });
    }
  }
  return out;
}

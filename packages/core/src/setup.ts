import { existsSync, readFileSync, renameSync } from "node:fs";
import { join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { CONFIG_CANDIDATES, LEGACY_CONFIG_CANDIDATES } from "./config";
import { careersUrl, companyKey, detectCompany, getConnector, guessName, type DetectResult } from "./connectors";
import { isPhenomSite } from "./connectors/phenom";
import { isRadancySite } from "./connectors/radancy";
import { isTeamtailorFeed, isTeamtailorHost } from "./connectors/teamtailor";
import { HttpClient, HttpError } from "./http";
import { RESUME_PATH } from "./resume";
import { ConfigSchema, type Profile } from "./schema";
import { passesGates } from "./score";
import { configToYaml } from "./yaml-writer";
import { defaultDataDir, rawjobsHome } from "./paths";
import { writeFileAtomic } from "./atomic";
import type { CompanyCheck, SaveResult, SetupStatus } from "./protocol";

export type { CompanyCheck, SaveResult, SetupStatus } from "./protocol";

/** The user's own config. The shipped rawjobs.config.example.yaml is only an example. */
export const PERSONAL_CONFIG = CONFIG_CANDIDATES[0]!;

/** The personal config file: rawjobs.config.local.yaml, or the pre-rename jobhunter one while that's the only one there. */
export function personalConfigPath(cwd = rawjobsHome()): string {
  const path = resolve(cwd, PERSONAL_CONFIG);
  const legacy = resolve(cwd, LEGACY_CONFIG_CANDIDATES[0]!);
  return !existsSync(path) && existsSync(legacy) ? legacy : path;
}

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

export type CheckOptions = {
  http?: HttpClient;
  /** Count the jobs that match this profile. */
  profile?: Profile;
  /** Company directory names by key, to mark known companies and borrow their names. */
  directory?: ReadonlyMap<string, { name: string }>;
};

/**
 * A careers site on a company's own domain, which its URL can't reveal: a look at the host's
 * /jobs.rss (Teamtailor's feed) and, failing that, its /search/ page (a SuccessFactors career site).
 */
async function detectByFeed(input: string, http: HttpClient): Promise<DetectResult | null> {
  let host: string;
  try {
    host = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (!isTeamtailorHost(host)) return null;
  try {
    const xml = await http.getText(`https://${host}/jobs.rss`);
    if (isTeamtailorFeed(xml)) {
      const title = xml.match(/<channel>\s*<title>([^<]*)<\/title>/)?.[1]?.trim();
      return { ats: "teamtailor", slug: host, name: title || host, supported: true };
    }
  } catch {
    // not a Teamtailor site
  }
  // A Phenom careers site answers its own widgets call.
  try {
    if (await isPhenomSite(host, http)) return { ats: "phenom", slug: host, name: guessName(host.split(".").at(-2) ?? host), supported: true };
  } catch {
    // not Phenom
  }
  // A Radancy (TalentBrew) site names its jobs in its sitemap.
  try {
    if (await isRadancySite(host, http)) return { ats: "radancy", slug: host, name: guessName(host.split(".").at(-2) ?? host), supported: true };
  } catch {
    // not Radancy
  }
  // A SuccessFactors career site (RMK) loads SAP's j2w scripts on its search page.
  try {
    const html = await http.getText(`https://${host}/search/?q=&startrow=0`);
    if (/\/platform\/js\/j2w\//.test(html)) return { ats: "successfactors", slug: host, name: guessName(host.split(".").at(-2) ?? host), supported: true };
  } catch {
    // not one either
  }
  return null;
}

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
    const found = detectCompany(input) ?? (await detectByFeed(input, http));
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
        // SmartRecruiters and Gem answer 200 + nothing for any made-up id, so we can't tell.
        out.push(
          ref.ats === "smartrecruiters" || ref.ats === "gem"
            ? {
                ...base,
                status: "error",
                error: `No open jobs on this board. Check the link: ${ref.ats === "gem" ? "Gem" : "SmartRecruiters"} shows an empty board for a wrong company name.`,
              }
            : { ...base, status: "dormant", open_jobs: 0, top_locations: [], sample_titles: [], ...(opts.profile ? { matches: 0, match_examples: [] } : {}) },
        );
        continue;
      }
      // One malformed posting (a Workday one without a path, say) shouldn't fail the whole board's check.
      const normalized = jobs.flatMap((j) => {
        try {
          return [connector.normalize(j, company)];
        } catch {
          return [];
        }
      });
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

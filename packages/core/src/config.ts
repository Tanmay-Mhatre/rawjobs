import { existsSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { ConfigSchema, type Config } from "./schema";
import { rawjobsHome } from "./paths";

/** Looked up in this order when no --config is given. The .local file is gitignored. */
export const CONFIG_CANDIDATES = ["rawjobs.config.local.yaml", "rawjobs.config.yaml"];
/** The names from before the rename to RawJobs, still read when no rawjobs.config file exists. */
export const LEGACY_CONFIG_CANDIDATES = ["jobhunter.config.local.yaml", "jobhunter.config.yaml"];

/** A config under its pre-rename name: worth a hint to rename it. */
export const isLegacyConfig = (path: string) => LEGACY_CONFIG_CANDIDATES.includes(basename(path));

export class ConfigError extends Error {
  override name = "ConfigError";
}

export function findConfigPath(cwd = rawjobsHome()): string {
  for (const name of [...CONFIG_CANDIDATES, ...LEGACY_CONFIG_CANDIDATES]) {
    const p = resolve(cwd, name);
    if (existsSync(p)) return p;
  }
  throw new ConfigError(`No config found. Create ${CONFIG_CANDIDATES[1]} (or pass --config <path>).`);
}

export function parseConfig(text: string, source = "config"): Config {
  let raw: unknown;
  try {
    raw = parseYaml(text);
  } catch (err) {
    throw new ConfigError(`${source} is not valid YAML:\n${(err as Error).message}`);
  }
  const result = ConfigSchema.safeParse(raw);
  if (!result.success) {
    throw new ConfigError(`${source} has problems:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}

export function loadConfig(path?: string): { config: Config; path: string } {
  const p = path ? resolve(path) : findConfigPath();
  if (!existsSync(p)) throw new ConfigError(`Config file not found: ${p}`);
  return { config: parseConfig(readFileSync(p, "utf8"), p), path: p };
}

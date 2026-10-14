import { execFile } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { BoardRecord } from "./board-health";
import { companyKey, jobCompanyKey } from "./connectors";
import type { DiscoveryLedger } from "./discover";
import type { FeedMatches } from "./job-feed";
import type { ScanSource } from "./protocol";
import type { CompanyRef } from "./schema";

/**
 * Scan now in two stages. Stage 1 (scope "mine") fetches your companies, the directory companies that
 * matched you before (the discovery ledger) and the ones the shared job feed flags for you. Stage 2,
 * the background check, fetches every other company (scope "all", skipping what stage 1 just fetched),
 * quietly: you only hear about it when it finds something new.
 */

/**
 * Stage 1's directory companies: past matches first, then the feed's picks. Without a feed fresh
 * enough to pick from (none, or older than FEED_MAX_AGE_DAYS: `covered` is empty), every company is
 * checked instead (`fallback`), as the feed can't say which ones have nothing for you.
 */
export function quickPicks<T extends CompanyRef>(
  candidates: readonly T[],
  o: { feed?: FeedMatches; ledger: DiscoveryLedger /** Also a past match: a company with a matching job in your history. */; matchedBefore?: (c: T) => boolean },
): { picks: T[]; sources: Map<string, ScanSource>; fallback: boolean } {
  const sources = new Map<string, ScanSource>();
  const fallback = !o.feed || o.feed.covered.size === 0;
  if (fallback) return { picks: [...candidates], sources, fallback };
  const past: T[] = [];
  const feed: T[] = [];
  for (const c of candidates) {
    const key = jobCompanyKey(c);
    if ((o.ledger.companies[companyKey(c)]?.matches ?? 0) > 0 || o.matchedBefore?.(c)) {
      past.push(c);
      sources.set(key, "past");
    } else if (o.feed!.matching.has(key)) {
      feed.push(c);
      sources.set(key, "feed");
    }
  }
  return { picks: [...past, ...feed], sources, fallback };
}

/** A board fetched (well or not) at or after `since` (ms): stage 2 leaves the ones stage 1 just did. */
export const fetchedSince = (r: BoardRecord | undefined, since: number): boolean => Math.max(r?.okAt ?? 0, r?.failedAt ?? 0) >= since;

/** Per-source counts, all three always present. */
export const sourceCounts = (): Record<ScanSource, number> => ({ yours: 0, past: 0, feed: 0 });

const run = (cmd: string, args: string[]): Promise<string | undefined> =>
  new Promise((done) => {
    execFile(cmd, args, { timeout: 15_000, windowsHide: true }, (err, stdout) => done(err ? undefined : String(stdout)));
  });

/**
 * Is this computer running on battery? Undefined when that can't be told (no battery, or the
 * platform doesn't say): the background check then just carries on.
 *   Windows: Win32_Battery's BatteryStatus (1 discharging, 4 low, 5 critical; the rest are on mains)
 *   macOS:   pmset -g batt ("drawing from 'Battery Power'")
 *   Linux:   /sys/class/power_supply: a mains supply that's offline
 */
export async function onBattery(platform: NodeJS.Platform = process.platform): Promise<boolean | undefined> {
  if (platform === "win32") {
    const out = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "(Get-CimInstance -ClassName Win32_Battery | Select-Object -First 1).BatteryStatus"]);
    return windowsOnBattery(out);
  }
  if (platform === "darwin") {
    const out = await run("pmset", ["-g", "batt"]);
    if (!out) return undefined;
    if (/'Battery Power'/.test(out)) return true;
    return /'AC Power'/.test(out) ? false : undefined;
  }
  if (platform === "linux") return linuxOnBattery("/sys/class/power_supply");
  return undefined;
}

/** BatteryStatus as PowerShell prints it; empty when there's no battery (a desktop). */
export function windowsOnBattery(out: string | undefined): boolean | undefined {
  const status = Number(out?.trim());
  if (!out?.trim() || !Number.isFinite(status)) return undefined;
  return status === 1 || status === 4 || status === 5;
}

export function linuxOnBattery(dir: string): boolean | undefined {
  try {
    if (!existsSync(dir)) return undefined;
    const read = (name: string, file: string) => {
      try {
        return readFileSync(join(dir, name, file), "utf8").trim();
      } catch {
        return "";
      }
    };
    const supplies = readdirSync(dir);
    const mains = supplies.filter((n) => read(n, "type") === "Mains");
    const battery = supplies.some((n) => read(n, "type") === "Battery");
    if (!mains.length || !battery) return undefined;
    return mains.every((n) => read(n, "online") === "0");
  } catch {
    return undefined;
  }
}

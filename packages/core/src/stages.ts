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

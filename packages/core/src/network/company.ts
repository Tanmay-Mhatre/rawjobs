/**
 * Which of your connections work at a job's company. One normalizer for both sides: companyNameKey
 * and companyNameWords (dashboard.ts), then COMPANY_ALIASES (display-name.ts).
 */
import { companyNameKey, companyNameWords } from "../dashboard";
import { COMPANY_ALIASES } from "../display-name";

/** Not an employer: nobody is matched to a job by these. */
export const COMPANY_STOPLIST: ReadonlySet<string> = new Set([
  "selfemployed",
  "freelance",
  "freelancer",
  "stealth",
  "stealthstartup",
  "stealthmodestartup",
  "confidential",
  "independent",
  "independentconsultant",
  "consultant",
  "retired",
  "unemployed",
  "opentowork",
  "various",
  "na",
  "none",
  "student",
]);

/** Common English words: matched exactly, never as the start of a longer name ("Apple" isn't "Apple Leisure Group"). */
export const EXACT_ONLY: ReadonlySet<string> = new Set(["apple", "notion", "ramp", "block", "stripe", "square", "target", "oracle", "shell", "mercury", "plaid"]);

/** Up to this many longer names count as one company ("Kraken" ~ "Kraken Digital Asset Exchange"). */
export const MAX_PREFIX_KEYS = 3;

function canonical(key: string): string {
  return Object.hasOwn(COMPANY_ALIASES, key) ? COMPANY_ALIASES[key]! : key;
}

/** The key a company is indexed and looked up by; null for the stoplist and empty names. */
export function networkKey(name: string | undefined): string | null {
  if (!name?.trim()) return null;
  const key = companyNameKey(name);
  if (!/[\p{L}\p{N}]/u.test(key) || COMPANY_STOPLIST.has(key)) return null;
  return canonical(key);
}

export type NetworkIndex = {
  /** networkKey → connection ids. */
  byKey: ReadonlyMap<string, readonly string[]>;
  /** First word of a company name → the keys that start with it. */
  byFirstWord: ReadonlyMap<string, readonly string[]>;
  /** networkKey → the words of the first name seen for it. */
  wordsOf: ReadonlyMap<string, readonly string[]>;
};

export function buildNetworkIndex(connections: readonly { id: string; company?: string }[]): NetworkIndex {
  const byKey = new Map<string, string[]>();
  const byFirstWord = new Map<string, string[]>();
  const wordsOf = new Map<string, string[]>();
  for (const c of connections) {
    const key = networkKey(c.company);
    if (!key) continue;
    const ids = byKey.get(key);
    if (ids) {
      ids.push(c.id);
      continue;
    }
    byKey.set(key, [c.id]);
    const words = companyNameWords(c.company!);
    wordsOf.set(key, words);
    if (words[0]) byFirstWord.set(words[0], [...(byFirstWord.get(words[0]) ?? []), key]);
  }
  return { byKey, byFirstWord, wordsOf };
}

export type MatchHow = "exact" | "alias" | "prefix" | "none";

/**
 * The keys in `index` that count as the job's company: its own key, plus longer names that start
 * with all of its words ("Kraken" ~ "Kraken Digital Asset Exchange"), but only when the key is
 * longer than 4 characters and isn't a common word.
 */
export function matchingKeys(jobName: string, index: NetworkIndex): { keys: string[]; how: MatchHow } {
  const key = networkKey(jobName);
  if (!key) return { keys: [], how: "none" };
  const keys: string[] = [];
  let how: MatchHow = "none";
  if (index.byKey.has(key)) {
    keys.push(key);
    how = key === companyNameKey(jobName) ? "exact" : "alias";
  }
  if (key.length > 4 && !EXACT_ONLY.has(key)) {
    const words = companyNameWords(jobName);
    const longer = (index.byFirstWord.get(words[0] ?? "") ?? [])
      .filter((k) => {
        const w = index.wordsOf.get(k) ?? [];
        return k !== key && w.length > words.length && words.every((x, i) => w[i] === x);
      })
      .sort((a, b) => (index.byKey.get(b)?.length ?? 0) - (index.byKey.get(a)?.length ?? 0) || a.localeCompare(b))
      .slice(0, MAX_PREFIX_KEYS);
    if (longer.length) {
      keys.push(...longer);
      if (how === "none") how = "prefix";
    }
  }
  return { keys, how };
}

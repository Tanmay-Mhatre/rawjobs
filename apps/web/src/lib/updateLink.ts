import type { CompanyCheck } from "@rawjobs/core/protocol";
import { keyOf, type CompanyRef } from "./companies";

/** What a checked link means for "Update link": usable (maybe with a name warning), or why not. */
export type LinkVerdict =
  | {
      kind: "ok";
      to: CompanyRef;
      check: CompanyCheck;
      /** The board's own name, when it isn't the company's. */
      otherName?: string;
    }
  | { kind: "same" }
  | { kind: "yours"; name: string }
  | { kind: "needsSite" }
  | { kind: "unknown" }
  | { kind: "error"; error?: string };

/** Lowercase words only, so "Deribit, Inc." and "deribit" compare equal; accents and symbols dropped. */
const words = (s: string) =>
  s
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** The same company by name: equal words, or one name is the other plus more words ("Deribit" / "Deribit Careers"). */
export function sameName(a: string, b: string): boolean {
  const x = words(a);
  const y = words(b);
  if (!x || !y) return false;
  return x === y || x.startsWith(`${y} `) || y.startsWith(`${x} `);
}

/**
 * Judge a checked link as the new careers page for `name` (whose board is `oldKey`).
 * `yours` maps your other companies' keys to their names.
 */
export function judgeLink(check: CompanyCheck, opts: { name: string; oldKey: string; yours: ReadonlyMap<string, string> }): LinkVerdict {
  if (check.status === "unknown" || !check.ats || !check.slug) return { kind: "unknown" };
  if (check.status === "error") return { kind: "error", error: check.error };
  if (check.ats === "workday" && !check.site) return { kind: "needsSite" };
  const to: CompanyRef = {
    name: opts.name,
    ats: check.ats,
    slug: check.slug,
    ...(check.region && check.region !== "global" ? { region: check.region } : {}),
    ...(check.shard ? { shard: check.shard } : {}),
    ...(check.site ? { site: check.site } : {}),
    careers_url: check.careers_url ?? check.input,
  };
  const key = keyOf(to);
  if (key === opts.oldKey) return { kind: "same" };
  const other = opts.yours.get(key);
  if (other !== undefined) return { kind: "yours", name: other };
  // Only the hiring system's own name says anything; a name guessed from the link doesn't.
  const otherName = check.name_source === "ats" && check.name && !sameName(check.name, opts.name) ? check.name : undefined;
  return { kind: "ok", to, check, ...(otherName ? { otherName } : {}) };
}

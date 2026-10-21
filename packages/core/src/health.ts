import type { CompanyHealth } from "./schema";

/** A board never asked this run (`notReached`); older runs only say so in the error. */
export const notReached = (h: CompanyHealth): boolean => !!h.notReached || (!h.ok && !h.failure && /^skipped: \S+ failed \d+ times in a row/.test(h.error ?? ""));
/** A board that was asked and failed: not one whose hiring system isn't supported yet, nor one never reached. */
export const failedHealth = (h: CompanyHealth): boolean => !h.ok && !h.unsupported && !notReached(h);

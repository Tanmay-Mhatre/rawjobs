/**
 * Accept companies users shared with "Add by link" into the shared contributions list.
 * Every board is validated and live-checked again here: the inbox takes anything, this decides.
 *
 *   pnpm exec tsx scripts/catalog/contributions.ts --inbox inbox.json --into contributions.json [--directory out/directory.json]
 *
 * inbox.json: { items: [{ id, boards: [{ ats, slug, region?, shard?, site?, name?, careers_url? }] }] }
 * Prints a JSON summary: { accepted, rejected, processed: [inbox ids] }.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { careersUrl, cleanSharedBoard, companyKey, guessName, HttpClient } from "@rawjobs/core";
import { readDenylist } from "./lib/denylist";
import { checkBoard } from "./lib/live-check";

const here = dirname(fileURLToPath(import.meta.url));
const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};

export type SharedBoard = { ats: string; slug: string; region?: string; shard?: string; site?: string; name?: string; careers_url?: string };
export type Contribution = {
  key: string;
  name: string;
  ats: string;
  slug: string;
  region?: string;
  shard?: string;
  site?: string;
  careers_url: string;
  status: "live" | "dormant";
  open_jobs: number | null;
  added_at: string;
};

/** A board as sent by an app, cleaned up, or the reason it can't be used (the app checks with the same rules). */
export const cleanBoard = (b: SharedBoard): SharedBoard | string => cleanSharedBoard(b);

async function main() {
  const inboxFile = arg("--inbox");
  const intoFile = arg("--into");
  if (!inboxFile || !intoFile) throw new Error("Usage: contributions.ts --inbox inbox.json --into contributions.json [--directory directory.json]");
  const inbox = JSON.parse(readFileSync(inboxFile, "utf8")) as { items: { id: string; boards: SharedBoard[] }[] };
  const shared = existsSync(intoFile) ? (JSON.parse(readFileSync(intoFile, "utf8")) as { companies: Contribution[] }).companies : [];
  const directoryFile = arg("--directory") ?? join(here, "out", "directory.json");
  const known = new Set(shared.map((c) => c.key));
  if (existsSync(directoryFile)) for (const c of (JSON.parse(readFileSync(directoryFile, "utf8")) as { companies: { key: string }[] }).companies) known.add(c.key);

  const http = new HttpClient({ retries: 1, hostDelayMs: 300, timeoutMs: 20_000, userAgent: "RawJobs-catalog/0.1 (open-source job radar; checking shared boards)" });
  const accepted: Contribution[] = [];
  const rejected: { board: unknown; reason: string }[] = [];
  const denied = readDenylist();
  for (const item of inbox.items ?? []) {
    for (const raw of (item.boards ?? []).slice(0, 25)) {
      const board = cleanBoard(raw);
      if (typeof board === "string") {
        rejected.push({ board: raw, reason: board });
        continue;
      }
      const key = companyKey(board);
      if (known.has(key)) continue; // already in the directory or shared before
      if (denied({ key, name: board.name, careers_url: careersUrl(board as never) })) {
        rejected.push({ board, reason: "removed on request (denylist)" });
        continue;
      }
      known.add(key);
      const result = await checkBoard(http, { key, ...board });
      if (result.status !== "live" && result.status !== "dormant") {
        rejected.push({ board, reason: result.error ?? result.status });
        continue;
      }
      accepted.push({
        key,
        name: result.name || board.name || guessName(board.slug),
        ats: board.ats,
        slug: board.slug,
        ...(board.region ? { region: board.region } : {}),
        ...(board.shard ? { shard: board.shard } : {}),
        ...(board.site ? { site: board.site } : {}),
        careers_url: careersUrl(board as never) || `https://${board.slug}`,
        status: result.status,
        open_jobs: result.jobs,
        added_at: new Date().toISOString(),
      });
    }
  }
  if (accepted.length) writeFileSync(intoFile, `${JSON.stringify({ companies: [...shared, ...accepted] }, null, 1)}\n`);
  console.log(JSON.stringify({ accepted: accepted.length, accepted_keys: accepted.map((a) => a.key), rejected, processed: (inbox.items ?? []).map((i) => i.id) }));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

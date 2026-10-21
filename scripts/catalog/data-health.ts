/**
 * Is the shared data usable, as an installed copy sees it? Downloads the directory's and the job
 * feed's manifests the way the app does, checks their signatures against the app's public key, how
 * old they are, and that the files they list are there. The Data health workflow runs it and opens
 * an issue when something's wrong. The publishing workflows report their own failures; this catches
 * what they can't see: a schedule that silently didn't run, an upload cut off between a manifest and
 * its signature, a release changed by hand. On GitHub Actions it also checks that the Wayback Machine
 * still lets the daily URL-index run read its index (checkWayback).
 *
 *   DATA_PUBLIC_KEY=<base64> node scripts/catalog/data-health.ts [--report report.md]
 *
 * Plain Node (24 runs TypeScript directly) with nothing outside node:, so the workflow installs
 * nothing.
 */
import { createPublicKey, verify } from "node:crypto";
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export type HealthOptions = {
  publicKey: string;
  directoryUrl: string;
  feedUrl: string;
  fetchImpl?: typeof fetch;
  now?: number;
  /** The weekly rebuild publishes every 7 days; a day's grace. */
  maxDirectoryDays?: number;
  /** The feed is rebuilt every 6 hours (a run takes ~2.5 h); apps fall back to live scans as it ages. */
  maxFeedDays?: number;
};

export type HealthReport = { problems: string[]; checked: string[] };

const DAY = 86_400_000;

export async function checkSharedData(o: HealthOptions): Promise<HealthReport> {
  const get = o.fetchImpl ?? fetch;
  const now = o.now ?? Date.now();
  const problems: string[] = [];
  const checked: string[] = [];
  const key = createPublicKey({ key: Buffer.from(o.publicKey, "base64"), format: "der", type: "spki" });

  /** A manifest and its signature, verified; null (with the problem noted) when it can't be used. */
  const signedManifest = async <T>(base: string, name: string): Promise<T | null> => {
    const url = `${base}/${name}`;
    const [res, sig] = await Promise.all([get(url, { redirect: "follow" }), get(`${url}.sig`, { redirect: "follow" })]);
    if (!res.ok) {
      problems.push(`\`${name}\` can't be downloaded (HTTP ${res.status}).`);
      return null;
    }
    const body = Buffer.from(await res.arrayBuffer());
    if (!sig.ok) {
      problems.push(`\`${name}\` has no signature (\`${name}.sig\`: HTTP ${sig.status}). Apps refuse it: run **Data · sign what's published**.`);
      return null;
    }
    if (!verify(null, body, key, Buffer.from((await sig.text()).trim(), "base64"))) {
      problems.push(`\`${name}\`'s signature doesn't match it. Apps refuse it: run **Data · sign what's published** (or the upload was cut off between the two files).`);
      return null;
    }
    return JSON.parse(body.toString("utf8")) as T;
  };

  const fresh = (name: string, generatedAt: string | undefined, maxDays: number) => {
    const age = generatedAt ? (now - Date.parse(generatedAt)) / DAY : Number.NaN;
    if (!(age <= maxDays))
      problems.push(`\`${name}\` is ${Number.isNaN(age) ? "undated" : `${age.toFixed(1)} days old`} (expected under ${maxDays}): its publishing workflow hasn't run, or hasn't published.`);
    return age;
  };

  const present = async (base: string, file: string, of: string) => {
    const res = await get(`${base}/${file}`, { method: "HEAD", redirect: "follow" });
    if (!res.ok) problems.push(`\`${file}\`, listed in \`${of}\`, is missing (HTTP ${res.status}).`);
  };

  // The shared company directory (the latest release).
  const dir = await signedManifest<{ generated_at?: string; files?: Record<string, unknown> }>(o.directoryUrl, "manifest.json");
  if (dir) {
    const age = fresh("manifest.json", dir.generated_at, o.maxDirectoryDays ?? 8);
    for (const f of Object.keys(dir.files ?? {})) await present(o.directoryUrl, f, "manifest.json");
    checked.push(`directory: signed, ${age.toFixed(1)} days old, ${Object.keys(dir.files ?? {}).length} files`);
  }

  // The job feed: the third format (what current apps read), the second and the first (older apps).
  const maxFeedDays = o.maxFeedDays ?? 0.5;
  for (const [name, what] of [
    ["jobs-v3-manifest.json", "job feed"],
    ["jobs-v2-manifest.json", "job feed (second format)"],
  ] as const) {
    const m = await signedManifest<{ generated_at?: string; snapshot?: { file: string }; diffs?: { file: string }[] }>(o.feedUrl, name);
    if (!m) continue;
    const age = fresh(name, m.generated_at, maxFeedDays);
    const files = [...(m.snapshot ? [m.snapshot.file] : []), ...(m.diffs ?? []).map((d) => d.file)];
    for (const f of files) await present(o.feedUrl, f, name);
    checked.push(`${what}: signed, ${age.toFixed(2)} days old, ${files.length} files`);
  }
  const v1 = await signedManifest<{ generated_at?: string }>(o.feedUrl, "jobs-manifest.json");
  if (v1) checked.push(`job feed (first format): signed, ${fresh("jobs-manifest.json", v1.generated_at, maxFeedDays).toFixed(2)} days old`);

  return { problems, checked };
}

export type WaybackOptions = {
  /** This (code) repository, owner/name: its directory-commoncrawl.yml runs read the Wayback index. */
  repo: string;
  token?: string;
  api?: string;
  fetchImpl?: typeof fetch;
};

/**
 * Is the Wayback Machine still letting us read its index? wayback.ts leaves an annotation on the
 * daily URL-index run when web.archive.org was marked broken ("Wayback blocked") or no index page was
 * read ("Wayback stalled"). A problem when the latest Wayback run was blocked, or the last two made
 * no progress. Runs on main only, and only those where the Wayback step ran (Tue, Thu, Sat).
 */
export async function checkWayback(o: WaybackOptions): Promise<HealthReport> {
  const get = o.fetchImpl ?? fetch;
  const api = o.api ?? "https://api.github.com";
  const json = async <T>(path: string): Promise<T> => {
    const res = await get(`${api}/repos/${o.repo}/${path}`, { headers: { accept: "application/vnd.github+json", ...(o.token ? { authorization: `Bearer ${o.token}` } : {}) } });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${path}`);
    return (await res.json()) as T;
  };
  try {
    const { workflow_runs: runs } = await json<{ workflow_runs: { id: number }[] }>("actions/workflows/directory-commoncrawl.yml/runs?branch=main&status=completed&per_page=30");
    const seen: { titles: string[] }[] = [];
    for (const run of runs) {
      const { jobs } = await json<{ jobs: { id: number; steps?: { name: string; conclusion: string | null }[] }[] }>(`actions/runs/${run.id}/jobs`);
      const job = jobs.find((j) => j.steps?.some((s) => s.name === "Wayback" && s.conclusion && s.conclusion !== "skipped"));
      if (!job) continue;
      const notes = await json<{ title: string | null }[]>(`check-runs/${job.id}/annotations`);
      seen.push({ titles: notes.map((n) => n.title ?? "") });
      if (seen.length === 2) break;
    }
    const blocked = (r: { titles: string[] } | undefined) => !!r?.titles.includes("Wayback blocked");
    const stuck = (r: { titles: string[] } | undefined) => !!r && (blocked(r) || r.titles.includes("Wayback stalled"));
    if (blocked(seen[0]))
      return { problems: ["The Wayback Machine blocked the latest URL-index run (`web.archive.org` was marked broken). Check its log, and slow `wayback.ts` down before it runs again."], checked: [] };
    if (seen.length === 2 && seen.every(stuck))
      return { problems: ["The Wayback index made no progress in the last two URL-index runs (`raw/wayback/boards.json`): no index page was read. Check the runs' Wayback step."], checked: [] };
    return { problems: [], checked: [`Wayback: ${seen.length ? `last ${seen.length} run${seen.length > 1 ? "s" : ""} not blocked or stalled` : "no run yet"}`] };
  } catch (err) {
    // Can't read the runs (no token, API down): say so, but it isn't a problem with the data.
    return { problems: [], checked: [`Wayback: not checked (${(err as Error).message})`] };
  }
}

/** The issue's body: what's wrong, what was fine, and where the fixes are. */
export function reportMarkdown(r: HealthReport): string {
  const lines = r.problems.length ? ["The shared data that installed copies download has a problem:", "", ...r.problems.map((p) => `- ${p}`)] : ["The shared data is healthy."];
  if (r.checked.length) lines.push("", "Fine:", "", ...r.checked.map((c) => `- ${c}`));
  lines.push("", "Checked by the **Data · health** workflow (`scripts/catalog/data-health.ts`). This issue closes itself once everything is healthy again.");
  return `${lines.join("\n")}\n`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const repo = process.env.DATA_REPO || "Tanmay-Mhatre/rawjobs-directory";
  const publicKey = process.env.DATA_PUBLIC_KEY;
  if (!publicKey) {
    console.error("Set DATA_PUBLIC_KEY (DATA_PUBLIC_KEY in packages/core/src/data-signing.ts).");
    process.exit(2);
  }
  const report = await checkSharedData({
    publicKey,
    directoryUrl: `https://github.com/${repo}/releases/latest/download`,
    feedUrl: `https://github.com/${repo}/releases/download/jobs`,
  });
  if (process.env.GITHUB_REPOSITORY) {
    const wayback = await checkWayback({ repo: process.env.GITHUB_REPOSITORY, token: process.env.GH_TOKEN });
    report.problems.push(...wayback.problems);
    report.checked.push(...wayback.checked);
  }
  const md = reportMarkdown(report);
  const at = process.argv.indexOf("--report");
  if (at > 0) writeFileSync(process.argv[at + 1]!, md);
  console.log(md);
  // 1 when there's a problem, so the workflow knows to open (or update) the issue.
  process.exit(report.problems.length ? 1 : 0);
}

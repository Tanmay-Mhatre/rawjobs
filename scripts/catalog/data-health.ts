/**
 * Is the shared data usable, as an installed copy sees it? Downloads the directory's and the job
 * feed's manifests the way the app does, checks their signatures against the app's public key, how
 * old they are, and that the files they list are there. The Data health workflow runs it and opens
 * an issue when something's wrong. The publishing workflows report their own failures; this catches
 * what they can't see: a schedule that silently didn't run, an upload cut off between a manifest and
 * its signature, a release changed by hand.
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
  /** The feed is rebuilt daily; apps stop using it after 3 days. */
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

  // The job feed: the second format (what current apps read), then the first (older apps).
  const v2 = await signedManifest<{ generated_at?: string; snapshot?: { file: string }; diffs?: { file: string }[] }>(o.feedUrl, "jobs-v2-manifest.json");
  if (v2) {
    const age = fresh("jobs-v2-manifest.json", v2.generated_at, o.maxFeedDays ?? 2);
    const files = [...(v2.snapshot ? [v2.snapshot.file] : []), ...(v2.diffs ?? []).map((d) => d.file)];
    for (const f of files) await present(o.feedUrl, f, "jobs-v2-manifest.json");
    checked.push(`job feed: signed, ${age.toFixed(1)} days old, ${files.length} files`);
  }
  const v1 = await signedManifest<{ generated_at?: string }>(o.feedUrl, "jobs-manifest.json");
  if (v1) checked.push(`job feed (first format): signed, ${fresh("jobs-manifest.json", v1.generated_at, o.maxFeedDays ?? 2).toFixed(1)} days old`);

  return { problems, checked };
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
  const md = reportMarkdown(report);
  const at = process.argv.indexOf("--report");
  if (at > 0) writeFileSync(process.argv[at + 1]!, md);
  console.log(md);
  // 1 when there's a problem, so the workflow knows to open (or update) the issue.
  process.exit(report.problems.length ? 1 : 0);
}

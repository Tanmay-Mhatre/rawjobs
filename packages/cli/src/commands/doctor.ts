import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { defaultDataDir, rawjobsHome, runDoctor, writeDoctorZip } from "@rawjobs/core";

/**
 * `rawjobs doctor [--json] [--zip [file]]`: check this copy of RawJobs and say what to fix; --zip
 * also writes a redacted diagnostics file to attach to a GitHub issue (nothing is uploaded).
 */
export async function cmdDoctor(args: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: { json: { type: "boolean", default: false }, zip: { type: "boolean", default: false }, data: { type: "string", short: "d" } },
  });
  const home = rawjobsHome();
  const o = { home, dataDir: resolve(values.data ?? defaultDataDir(home)) };
  const report = runDoctor(o);
  const zip = values.zip ? writeDoctorZip({ ...o, report, out: positionals[0] ? resolve(positionals[0]) : undefined }) : undefined;
  if (values.json) {
    console.log(JSON.stringify({ ok: true, ...report, ...(zip ? { zip: zip.path } : {}) }));
    return 0;
  }
  const mark = { ok: "ok  ", warn: "WARN", fail: "FAIL" } as const;
  console.log(`RawJobs ${report.version} on ${report.platform}, Node ${report.node}\n`);
  for (const c of report.checks) console.log(`${mark[c.status]}  ${c.title}${c.detail ? `\n      ${c.detail}` : ""}`);
  if (zip)
    console.log(
      `\nSaved ${zip.path}\nIt leaves out your profile, resume, tracking, config and jobs, and the logs in it are redacted. Nothing was uploaded: attach it to a GitHub issue if you'd like help.`,
    );
  return report.checks.some((c) => c.status === "fail") ? 1 : 0;
}

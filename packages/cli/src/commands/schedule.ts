import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { defaultDataDir, rawjobsHome, CODE_ROOT, schedulerCommand, installSchedule, removeSchedule, runScheduleNow, scheduleStatus, type ScanScope } from "@rawjobs/core";
import { readStdin } from "../util";
import { parseScope } from "./run";

/** Scheduled scans on this computer (JSON out): status, install --time hh:mm [--time …] [--scope mine|all], remove. */
export async function cmdSchedule(args: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      time: { type: "string", multiple: true },
      scope: { type: "string" },
      data: { type: "string", short: "d", default: defaultDataDir() },
      stdin: { type: "boolean", default: false },
    },
  });
  const ctx = { repoRoot: CODE_ROOT, workDir: rawjobsHome(), launch: schedulerCommand(), dataDir: resolve(values.data) };
  const out = (o: Record<string, unknown>) => console.log(JSON.stringify(o));
  try {
    const action = positionals[0] ?? "status";
    if (action === "install") {
      // From the terminal the scope defaults to mine, as for scan; the dashboard (--stdin) always sends one.
      const input = values.stdin ? (JSON.parse((await readStdin()) || "{}") as { times?: string[]; scope?: string }) : { times: values.time, scope: parseScope(values.scope) };
      installSchedule(ctx, { times: input.times, scope: input.scope as ScanScope });
    } else if (action === "remove") removeSchedule(ctx);
    else if (action === "run") runScheduleNow(ctx);
    else if (action !== "status") {
      out({ ok: false, error: "Usage: rawjobs schedule <status|install|remove|run>" });
      return 2;
    }
    out({ ok: true, ...scheduleStatus(ctx) });
    return 0;
  } catch (err) {
    out({ ok: false, error: (err as Error).message, ...scheduleStatus(ctx) });
    return 0;
  }
}

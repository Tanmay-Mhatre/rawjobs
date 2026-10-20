import { resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  CODE_ROOT,
  DAILY_DEFAULT_TIME,
  dailySummaryStatus,
  defaultDataDir,
  installDailySummary,
  rawjobsHome,
  readDailySent,
  readDailySettings,
  readTracking,
  removeDailySummary,
  schedulerCommand,
  sendDailySummary,
  sendDailyTest,
  telegramSecrets,
  todayLine,
  todaySummary,
} from "@rawjobs/core";
import { readStdin } from "../util";

const NOT_SET_UP = "Telegram isn't set up yet: connect your bot in Settings → Notifications.";

/**
 * Today in your Pipeline: what's due today, in the terminal or (--notify) on Telegram once a day.
 *   rawjobs today [--notify [--scheduled]] [--test] [--json]
 *   rawjobs today <status|install|remove> [--time 09:00]   the daily summary's own scheduled task (JSON out)
 */
export async function cmdToday(args: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      notify: { type: "boolean", default: false },
      scheduled: { type: "boolean", default: false },
      test: { type: "boolean", default: false },
      json: { type: "boolean", default: false },
      time: { type: "string" },
      stdin: { type: "boolean", default: false },
      data: { type: "string", short: "d", default: defaultDataDir() },
    },
  });
  const dataDir = resolve(values.data);
  const out = (o: Record<string, unknown>) => console.log(JSON.stringify(o));
  const action = positionals[0];

  if (action) {
    const ctx = { repoRoot: CODE_ROOT, workDir: rawjobsHome(), launch: schedulerCommand(), dataDir };
    const secrets = telegramSecrets();
    const status = () => ({ ...dailySummaryStatus(ctx), last: readDailySent(dataDir) ?? null, telegram: !!(secrets.token && secrets.chatId) });
    try {
      if (action === "install") {
        const input = values.stdin ? (JSON.parse((await readStdin()) || "{}") as { time?: string }) : { time: values.time };
        installDailySummary(ctx, { time: input.time });
      } else if (action === "remove") removeDailySummary(ctx);
      else if (action !== "status") {
        out({ ok: false, error: "Usage: rawjobs today [status|install|remove]" });
        return 2;
      }
      out({ ok: true, ...status() });
      return 0;
    } catch (err) {
      out({ ok: false, error: (err as Error).message, ...status() });
      return 0;
    }
  }

  if (values.test) {
    const r = await sendDailyTest(telegramSecrets(), readDailySettings(dataDir)?.time ?? DAILY_DEFAULT_TIME);
    const error = r === "off" ? NOT_SET_UP : r.startsWith("failed: ") ? r.slice(8) : undefined;
    if (values.json) out(error ? { ok: false, error } : { ok: true });
    else console.log(error ?? "Sent a test message. Check Telegram.");
    return error ? 1 : 0;
  }

  if (values.notify) {
    const r = await sendDailySummary(dataDir, telegramSecrets(), { scheduled: values.scheduled });
    if (values.json) out({ ok: !r.startsWith("failed"), result: r });
    else console.log(`Daily summary: ${r === "off" ? NOT_SET_UP : r}`);
    return r.startsWith("failed") ? 1 : 0;
  }

  // In the terminal: every titled line (no cap), then what's counted.
  const s = todaySummary(readTracking()?.state);
  if (values.json) {
    out({ ok: true, ...s });
    return 0;
  }
  if (!s.lines.length && !s.apply && !s.close) {
    console.log("Nothing due today in your Pipeline.");
    return 0;
  }
  console.log("Today in your Pipeline");
  for (const l of s.lines) console.log(`  ${todayLine(l, false)}`);
  if (s.apply) console.log(`  ${s.apply} ${s.apply === 1 ? "job" : "jobs"} to apply to`);
  if (s.close) console.log(`  ${s.close} ${s.close === 1 ? "job" : "jobs"} ready to close`);
  return 0;
}

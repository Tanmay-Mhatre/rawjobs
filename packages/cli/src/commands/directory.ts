import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { defaultDataDir, directoryIndustryCounts, loadConfig, directoryAgeDays, directoryStatus, sendContributions, sendMoves, updateDirectory } from "@rawjobs/core";

/** The shared company directory: status, download the latest copy, share waiting additions. */
export async function cmdDirectory(args: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      data: { type: "string", short: "d", default: defaultDataDir() },
      json: { type: "boolean", default: false },
      force: { type: "boolean", default: false },
      "if-older": { type: "string" },
      /** Background update: skipped when auto_update is off in your settings. */
      auto: { type: "boolean", default: false },
    },
  });
  const dataDir = resolve(values.data);
  const out = (o: object, text: string) => console.log(values.json ? JSON.stringify(o) : text);
  /** Board sharing (on by default); when off, anything still waiting is dropped, not sent. */
  const sharing = () => {
    try {
      return loadConfig().config.directory.share_additions !== false;
    } catch {
      return true;
    }
  };
  switch (positionals[0] ?? "status") {
    case "status": {
      const s = directoryStatus(dataDir);
      const age = directoryAgeDays(dataDir);
      out(
        { ...s, age_days: Number.isFinite(age) ? Math.round(age * 10) / 10 : null, industries: directoryIndustryCounts(dataDir) },
        s.local
          ? `Shared directory ${s.local.version}: ${s.local.companies.toLocaleString()} companies, version from ${s.local.generated_at.slice(0, 10)}, downloaded ${Math.round(age)} day(s) ago${s.local.checked_at ? `, checked ${s.local.checked_at.slice(0, 10)}` : ""}.`
          : s.present
            ? "Using a directory built on this computer (not downloaded)."
            : "No company directory yet. Run: pnpm rawjobs directory update",
      );
      return 0;
    }
    case "update": {
      if (values.auto) {
        const autoOn = (() => {
          try {
            return loadConfig().config.directory.auto_update;
          } catch {
            return true;
          }
        })();
        if (!autoOn) {
          out({ updated: false, message: "Automatic updates are off." }, "Automatic updates are off in your settings.");
          return 0;
        }
      }
      const olderThan = values["if-older"] ? Number(values["if-older"]) : undefined;
      if (olderThan !== undefined && directoryAgeDays(dataDir) < olderThan) {
        out({ updated: false, message: "Recent enough." }, "Directory is recent enough.");
        return 0;
      }
      const on = sharing();
      const shared = await sendContributions(dataDir, { enabled: on });
      // Confirmed careers-link moves go with this update, never when they're confirmed.
      const moved = await sendMoves(dataDir, { enabled: on });
      const result = await updateDirectory(dataDir, { force: values.force }).catch((err: Error) => ({ updated: false, message: `Update failed: ${err.message}` }));
      out({ ...result, shared: shared.sent, moves_shared: moved.sent }, `${result.message}${shared.sent ? ` ${shared.message}` : ""}${moved.sent ? ` ${moved.message}` : ""}`);
      return 0;
    }
    case "share": {
      const on = sharing();
      const result = await sendContributions(dataDir, { enabled: on });
      const moved = await sendMoves(dataDir, { enabled: on });
      out({ ...result, moves_shared: moved.sent }, `${result.message}${moved.sent ? ` ${moved.message}` : ""}`);
      return 0;
    }
    default:
      console.error("Usage: rawjobs directory <status|update|share> [--force] [--if-older <days>] [--json]");
      return 2;
  }
}

import { resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  defaultDataDir,
  rawjobsHome,
  checkCompanies,
  readResume,
  recordAdditions,
  deleteResume,
  saveResume,
  saveConfig,
  resetConfig,
  setupStatus,
  readDirectory,
  queueContributions,
  sendContributions,
} from "@rawjobs/core";
import { isAts, readStdin } from "../util";

/** JSON in (stdin) / JSON out (stdout), for the dashboard's local setup API. */
export async function cmdSetup(args: string[]): Promise<number> {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: { data: { type: "string", short: "d", default: defaultDataDir() } } });
  switch (positionals[0]) {
    case "status":
      console.log(JSON.stringify(setupStatus(rawjobsHome(), resolve(values.data))));
      return 0;
    case "save": {
      const result = saveConfig(JSON.parse(await readStdin()));
      console.log(JSON.stringify(result));
      return result.ok ? 0 : 1;
    }
    case "reset":
      console.log(JSON.stringify(resetConfig()));
      return 0;
    case "resume": {
      if (positionals[1] === "delete") {
        console.log(JSON.stringify(deleteResume()));
        return 0;
      }
      if (positionals[1] === "save") {
        const body = JSON.parse(await readStdin()) as { text?: string };
        const result = saveResume(body.text ?? "");
        console.log(JSON.stringify(result));
        return result.ok ? 0 : 1;
      }
      console.log(JSON.stringify(readResume()));
      return 0;
    }
    case "check": {
      const body = JSON.parse(await readStdin()) as { urls?: string[] };
      // Your saved profile (to count matching jobs) and the directory (to mark known companies).
      const status = setupStatus(rawjobsHome(), resolve(values.data));
      const directory = new Map(readDirectory(values.data).map((c) => [c.key, c]));
      const results = await checkCompanies(body.urls ?? [], { profile: status.config?.profile, directory });
      recordAdditions(values.data, results);
      // Share new boards with the directory (unless turned off in settings). Best effort: the
      // outbox keeps anything that couldn't be sent, and the next update retries it.
      if (status.config?.directory.share_additions !== false) {
        const fresh = results.filter((r) => (r.status === "live" || r.status === "dormant") && !r.in_directory && isAts(r.ats) && r.slug);
        if (fresh.length) {
          queueContributions(
            values.data,
            fresh.map((r) => ({
              ats: r.ats!,
              slug: r.slug!,
              ...(r.region === "eu" ? { region: "eu" } : {}),
              ...(r.shard ? { shard: r.shard } : {}),
              ...(r.site ? { site: r.site } : {}),
              ...(r.name ? { name: r.name } : {}),
            })),
          );
          await sendContributions(values.data);
        }
      }
      console.log(JSON.stringify(results));
      return 0;
    }
    default:
      console.error("Usage: rawjobs setup <status|save|check|resume [save]>");
      return 2;
  }
}

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { writeFileAtomic } from "./atomic";

/**
 * The format of your RawJobs folder's data (data/, profile/, the config). When a release changes how
 * any of it is stored, it raises DATA_FORMAT and adds a step to MIGRATIONS that converts the old
 * files; the server runs the steps once, at start, after the update has backed everything up.
 *
 * An update that fails goes back to the old version. Its backup is put back only when the new
 * version had already converted the data (format.json changed); otherwise your data, including
 * anything saved since the update began, is left exactly as it is.
 */
export const DATA_FORMAT = 1;

type Migration = { to: number; run: (home: string, dataDir: string) => void };
/** Step n converts format n-1 to n. Empty while the format is still the first one. */
const MIGRATIONS: Migration[] = [];

const formatFile = (dataDir: string) => join(dataDir, "format.json");

/** The data's format: 1 when the file is missing (every copy before formats were recorded). */
export function readDataFormat(dataDir: string): number {
  try {
    const f = JSON.parse(readFileSync(formatFile(dataDir), "utf8")) as { format?: unknown };
    return typeof f.format === "number" && f.format >= 1 ? f.format : 1;
  } catch {
    return 1;
  }
}

/**
 * Bring the data up to this version's format. Returns the format it found. A format newer than this
 * version knows (you went back to an older version by hand) is left alone.
 */
export function migrateData(home: string, dataDir: string): number {
  const found = readDataFormat(dataDir);
  if (found >= DATA_FORMAT) return found;
  for (const m of MIGRATIONS.filter((x) => x.to > found && x.to <= DATA_FORMAT).sort((a, b) => a.to - b.to)) {
    console.log(`Updating your data to format ${m.to}.`);
    m.run(home, dataDir);
    writeFileAtomic(formatFile(dataDir), `${JSON.stringify({ format: m.to })}\n`);
  }
  return found;
}

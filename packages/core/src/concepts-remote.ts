import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { type ConceptsFile, setConcepts } from "./concepts";
import { fetchSignedJson } from "./data-signing";
import { envSetting } from "./env";

/**
 * The weekly word list (scripts/catalog/concepts.ts publishes it, signed, next to the job feed).
 * A scan uses it when it can: fetched at most once a day, kept in data/cache, and the last good copy
 * (or the built-in list) when the network or the signature fails. Never blocks a scan for long.
 */
export const DEFAULT_CONCEPTS_URL = "https://github.com/Tanmay-Mhatre/rawjobs-directory/releases/download/concepts/concepts.json";
const conceptsUrl = () => envSetting("CONCEPTS_URL") ?? DEFAULT_CONCEPTS_URL;
const REFRESH_MS = 24 * 60 * 60 * 1000;
const fileOf = (dataDir: string) => join(dataDir, "cache", "concepts.json");

type Cached = { fetchedAt: string; file: ConceptsFile };

/** A word list worth using: a version and a topic -> words table of strings. */
export function isConceptsFile(x: unknown): x is ConceptsFile {
  if (!x || typeof x !== "object") return false;
  const f = x as ConceptsFile;
  return (
    typeof f.version === "string" &&
    !!f.concepts &&
    typeof f.concepts === "object" &&
    Object.values(f.concepts).every((a) => Array.isArray(a) && a.every((w) => typeof w === "string" && w.length <= 60))
  );
}

function readCache(dataDir: string): Cached | undefined {
  try {
    const c = JSON.parse(readFileSync(fileOf(dataDir), "utf8")) as Cached;
    return isConceptsFile(c.file) ? c : undefined;
  } catch {
    return undefined;
  }
}

/** Load the weekly word list for this scan. Returns the version in use ("base" when there is none). */
export async function loadConcepts(dataDir: string, get: typeof fetch = fetch, now = Date.now()): Promise<string> {
  const cached = readCache(dataDir);
  if (cached && now - Date.parse(cached.fetchedAt) < REFRESH_MS) {
    setConcepts(cached.file);
    return cached.file.version;
  }
  try {
    const res = await fetchSignedJson<unknown>(get, conceptsUrl());
    if (res.ok && isConceptsFile(res.value)) {
      const path = fileOf(dataDir);
      if (!existsSync(dirname(path))) mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, JSON.stringify({ fetchedAt: new Date(now).toISOString(), file: res.value } satisfies Cached));
      setConcepts(res.value);
      return res.value.version;
    }
  } catch {
    // Offline or slow: fall through to the last good copy.
  }
  setConcepts(cached?.file);
  return cached?.file.version ?? "base";
}

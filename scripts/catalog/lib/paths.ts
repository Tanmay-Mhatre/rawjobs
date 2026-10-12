import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Where the catalog scripts keep their inputs and outputs (raw/, seeds/, out/): scripts/catalog,
 * or CATALOG_DIR. Tests point it at small fixtures, so the scripts run for real on known input.
 */
export const catalogDir = resolve(process.env.CATALOG_DIR ?? fileURLToPath(new URL("..", import.meta.url)));

/** This install's data folder (its own additions, the published directory): data/, or CATALOG_DATA_DIR. */
export const dataDir = resolve(process.env.CATALOG_DATA_DIR ?? join(fileURLToPath(new URL("../../..", import.meta.url)), "data"));

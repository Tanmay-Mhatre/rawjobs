import { readFileSync } from "node:fs";
import { writeFileAtomic } from "./atomic";
import type { BoardIds } from "./connectors/types";

/**
 * BoardIds on disk: one JSON object, jobCompanyKey() -> id. Read once; save() writes it only when an
 * id was learned since. A missing or unreadable file starts empty (the ids are learned again).
 */
export class FileBoardIds implements BoardIds {
  private readonly ids = new Map<string, string>();
  private dirty = false;

  constructor(private readonly file: string) {
    try {
      const saved = JSON.parse(readFileSync(file, "utf8")) as unknown;
      if (saved && typeof saved === "object" && !Array.isArray(saved)) {
        for (const [k, v] of Object.entries(saved)) if (typeof v === "string") this.ids.set(k, v);
      }
    } catch {
      // None yet.
    }
  }

  get(key: string): string | undefined {
    return this.ids.get(key);
  }

  set(key: string, id: string): void {
    if (this.ids.get(key) === id) return;
    this.ids.set(key, id);
    this.dirty = true;
  }

  get size(): number {
    return this.ids.size;
  }

  save(): void {
    if (!this.dirty) return;
    try {
      writeFileAtomic(this.file, JSON.stringify(Object.fromEntries(this.ids)));
      this.dirty = false;
    } catch {
      // Only a speed-up: the ids are learned again.
    }
  }
}

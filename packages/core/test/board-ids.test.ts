import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FileBoardIds } from "../src/board-ids";

describe("FileBoardIds", () => {
  it("keeps learned ids between runs and writes only when one was learned", () => {
    const file = join(mkdtempSync(join(tmpdir(), "board-ids-")), "board-ids.json");
    const a = new FileBoardIds(file);
    a.save();
    expect(() => readFileSync(file)).toThrow();
    a.set("join:acme", "30107");
    a.save();
    const b = new FileBoardIds(file);
    expect(b.get("join:acme")).toBe("30107");
    expect(b.size).toBe(1);
  });

  it("starts empty from a broken file and ignores values that aren't ids", () => {
    const dir = mkdtempSync(join(tmpdir(), "board-ids-"));
    writeFileSync(join(dir, "broken.json"), "{not json");
    expect(new FileBoardIds(join(dir, "broken.json")).size).toBe(0);
    writeFileSync(join(dir, "odd.json"), JSON.stringify({ "join:a": 5, "join:b": "7" }));
    const odd = new FileBoardIds(join(dir, "odd.json"));
    expect(odd.get("join:a")).toBeUndefined();
    expect(odd.get("join:b")).toBe("7");
  });
});

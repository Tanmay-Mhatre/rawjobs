import { describe, expect, it } from "vitest";
import { addedVersions, mapLimit, splitKey, tooYoung } from "./lockfile-age";

const lock = (keys: string[]) =>
  `lockfileVersion: '9.0'\n\nimporters:\n\n  .: {}\n\npackages:\n\n${keys.map((k) => `  '${k}':\n    resolution: {integrity: sha512-x}\n`).join("\n")}\nsnapshots:\n\n  'zzz-only-in-snapshots@1.0.0': {}\n`;

describe("the lockfile age check", () => {
  it("finds the versions a lockfile change adds, scoped names and new transitive ones included", () => {
    const base = lock(["lucide-react@1.72.0", "@biomejs/biome@2.6.7", "yaml@2.9.1"]);
    const head = lock(["lucide-react@1.77.0", "@biomejs/biome@2.6.8", "yaml@2.9.1", "tiny-dep@0.1.0"]);
    expect(addedVersions(base, head)).toEqual([
      { name: "lucide-react", version: "1.77.0" },
      { name: "@biomejs/biome", version: "2.6.8" },
      { name: "tiny-dep", version: "0.1.0" },
    ]);
  });

  it("finds nothing when only removals or no changes", () => {
    expect(addedVersions(lock(["a@1.0.0", "b@2.0.0"]), lock(["a@1.0.0"]))).toEqual([]);
  });

  it("skips entries that don't come from the registry", () => {
    expect(splitKey("@scope/pkg@1.2.3-beta.1")).toEqual({ name: "@scope/pkg", version: "1.2.3-beta.1" });
    expect(splitKey("pkg@https://codeload.github.com/x/y/tar.gz/abc")).toBeNull();
    expect(splitKey("pkg@file:vendor/pkg")).toBeNull();
    expect(splitKey("nope")).toBeNull();
  });

  it("flags versions under 7 days old and ones with no publish time", () => {
    const now = new Date("2026-11-26T12:00:00Z");
    const young = tooYoung(
      [
        { name: "old", version: "1.0.0", published: "2026-11-19T11:59:00Z" },
        { name: "fresh", version: "1.0.0", published: "2026-11-25T08:00:00Z" },
        { name: "edge", version: "1.0.0", published: "2026-11-19T12:01:00Z" },
        { name: "unknown", version: "1.0.0" },
      ],
      now,
    );
    expect(young.map((v) => v.name)).toEqual(["fresh", "edge", "unknown"]);
  });
});

describe("mapLimit", () => {
  it("keeps the order and never runs more than the limit at once", async () => {
    let running = 0;
    let most = 0;
    const out = await mapLimit([5, 1, 4, 2, 3, 0, 6], 3, async (n) => {
      most = Math.max(most, ++running);
      await new Promise((r) => setTimeout(r, n * 3));
      running--;
      return n * 10;
    });
    expect(out).toEqual([50, 10, 40, 20, 30, 0, 60]);
    expect(most).toBe(3);
  });
});

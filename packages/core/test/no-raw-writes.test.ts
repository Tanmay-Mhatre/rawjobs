import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const packages = fileURLToPath(new URL("../..", import.meta.url));

/**
 * Raw `writeFileSync` calls that are fine, by file and a piece of the line. Everything else in
 * core, cli and server writes through `writeFileAtomic`, so a crash never leaves half a file.
 */
const ALLOWED: { file: string; line: string; why: string }[] = [
  { file: "core/src/atomic.ts", line: "writeFileSync(tmp,", why: "the temp write itself" },
  { file: "core/src/live.ts", line: "writeFileSync(path,", why: "append log head; its reader skips torn lines" },
  { file: "core/src/job-feed-store.ts", line: "writeFileSync(join(this.dir,", why: "unique file names, committed by a pointer file" },
  { file: "core/src/schedule.ts", line: "writeFileSync(", why: "OS task files; repair writes them again" },
  { file: "core/src/lock.ts", line: '{ flag: "wx" }', why: "the lock helper: create-only, never replaced" },
  { file: "cli/src/commands/run.ts", line: "writeFileSync(out,", why: "--json output the user asked for" },
  { file: "server/src/api.ts", line: '"scan-notify"), "")', why: "flag file: only its existence matters" },
  { file: "server/src/api.ts", line: '"scan-stop"), "")', why: "flag file: only its existence matters" },
  { file: "server/src/catch-up.ts", line: '"scan-stop"), "")', why: "flag file: only its existence matters" },
  { file: "server/src/private-home.ts", line: "writeFileSync(marker,", why: "marker file: only its existence matters" },
  { file: "server/src/shortcuts.ts", line: "applet.icns", why: "OS shortcut file" },
  { file: "server/src/shortcuts.ts", line: "writeFileSync(join(apps, LINUX_LINK)", why: "OS shortcut file" },
  { file: "server/src/shortcuts.ts", line: "writeFileSync(menu,", why: "OS shortcut file" },
  { file: "server/src/shortcuts.ts", line: "writeFileSync(onDesktop,", why: "OS shortcut file" },
  // Catalog sync (directory, job feed) and the desktop state files move to writeFileAtomic in
  // their own pull requests; remove these lines with them.
  { file: "core/src/directory.ts", line: "writeFileSync(", why: "catalog sync, own PR" },
  { file: "core/src/job-feed.ts", line: "writeFileSync(", why: "catalog sync, own PR" },
  { file: "server/src/desktop.ts", line: "writeFileSync(", why: "server state, own PR" },
  { file: "server/src/shortcuts.ts", line: "writeFileSync(filePath(home)", why: "server state, own PR" },
  { file: "server/src/shortcuts.ts", line: "writeFileSync(file, data)", why: "server state, own PR" },
];

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return sources(path);
    return /\.(ts|tsx|mts)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [path] : [];
  });
}

describe("data-file writes", () => {
  it("no raw writeFileSync outside the allow-list", () => {
    const raw: string[] = [];
    for (const pkg of ["core", "cli", "server"])
      for (const path of sources(join(packages, pkg, "src"))) {
        const file = relative(packages, path).replaceAll("\\", "/");
        readFileSync(path, "utf8")
          .split("\n")
          .forEach((text, i) => {
            if (!text.includes("writeFileSync(") || /^\s*(\/\/|\*)/.test(text)) return;
            if (ALLOWED.some((a) => a.file === file && text.includes(a.line))) return;
            raw.push(`${file}:${i + 1}: ${text.trim()}`);
          });
      }
    expect(raw, "Write data files with writeFileAtomic (core/src/atomic.ts), or add the line to ALLOWED with a reason.").toEqual([]);
  });
});

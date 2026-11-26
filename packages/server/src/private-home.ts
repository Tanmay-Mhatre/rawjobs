import { chmodSync, existsSync, lstatSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Written once the RawJobs folder has been made private, so it's never done again. */
export const PRIVATE_MARKER = ".folder-private";

/**
 * Make the RawJobs folder readable by you only (0700) on macOS and Linux, once. It holds your résumé,
 * your network and your tracking, and older installs created it readable by every account on the
 * computer. Done only when it's a real folder you own (not a link, not someone else's folder you were
 * given), and only once: a later `chmod 750` of your own choosing stays. Windows: the user folder is
 * already private. Returns whether it changed the folder.
 */
export function makeHomePrivate(home: string, platform: NodeJS.Platform = process.platform): boolean {
  if (platform === "win32") return false;
  const marker = join(home, PRIVATE_MARKER);
  try {
    if (existsSync(marker)) return false;
    const st = lstatSync(home);
    if (!st.isDirectory() || st.uid !== process.getuid?.()) return false;
    chmodSync(home, 0o700);
    writeFileSync(marker, "RawJobs made this folder private once; it won't change its permissions again.\n");
    return true;
  } catch {
    // A read-only or unusual folder: leave it as it is.
    return false;
  }
}

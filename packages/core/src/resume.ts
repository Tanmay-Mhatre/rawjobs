import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { rawjobsHome } from "./paths";
import { writeFileAtomic } from "./atomic";

/** The master resume lives next to the config, in a gitignored folder. Never committed or published. */
export const RESUME_PATH = "profile/resume.md";
const MAX_BYTES = 300_000;

export type StoredResume = { path: string; text: string | null; updatedAt?: string };

export function readResume(cwd = rawjobsHome()): StoredResume {
  const path = resolve(cwd, RESUME_PATH);
  if (!existsSync(path)) return { path, text: null };
  return { path, text: readFileSync(path, "utf8"), updatedAt: statSync(path).mtime.toISOString() };
}

export function saveResume(text: string, cwd = rawjobsHome()): { ok: true; path: string } | { ok: false; error: string } {
  const clean = text.replace(/\r\n/g, "\n").trim();
  if (!clean) return { ok: false, error: "The resume is empty." };
  if (Buffer.byteLength(clean) > MAX_BYTES) return { ok: false, error: "That's longer than any resume should be (over 300 KB). Paste the text only." };
  const path = resolve(cwd, RESUME_PATH);
  mkdirSync(dirname(path), { recursive: true });
  writeFileAtomic(path, `${clean}\n`);
  return { ok: true, path };
}

/** Delete the saved resume. Nothing saved is fine too. */
export function deleteResume(cwd = rawjobsHome()): { ok: true; path: string } {
  const path = resolve(cwd, RESUME_PATH);
  rmSync(path, { force: true });
  return { ok: true, path };
}

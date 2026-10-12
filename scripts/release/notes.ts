import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { draft, issueBody, type MergedPr } from "./draft";

/**
 * What's merged but not released yet, and the tag message to release it with.
 *
 *   pnpm release:notes             print the draft (needs git with tags, and gh signed in)
 *   pnpm release:notes --out f.md  also write the reminder issue's body to f.md (release-reminder.yml)
 *
 * Releasing stays a tag you push by hand; this only drafts it and reminds you.
 */

const sh = (cmd: string, args: string[], cwd: string) => {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")}: ${(r.stderr || "").trim()}`);
  return r.stdout;
};

/** The last stable release tag, and the PRs merged into main since (from the merge commits). */
function collect(root: string): { last: string | null; prs: MergedPr[] } {
  const tags = sh("git", ["tag", "-l", "v*", "--sort=-v:refname"], root)
    .split("\n")
    .map((t) => t.trim())
    .filter((t) => /^v\d+\.\d+\.\d+$/.test(t));
  const last = tags[0] ?? null;
  const log = sh("git", ["log", "--first-parent", "--merges", "--format=%s", ...(last ? [`${last}..HEAD`] : ["HEAD"])], root);
  const numbers = [...log.matchAll(/^Merge pull request #(\d+)/gm)].map((m) => Number(m[1]));
  const prs = numbers.map((n) => {
    const j = JSON.parse(sh("gh", ["pr", "view", String(n), "--json", "number,title,body,author"], root)) as { number: number; title: string; body: string; author: { login: string } };
    return { number: j.number, title: j.title, body: j.body ?? "", author: j.author?.login ?? "" };
  });
  return { last, prs };
}

const root = resolve(import.meta.dirname, "../..");
const { values } = parseArgs({ options: { out: { type: "string" } } });
const pkg = (JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version: string }).version;
const { last, prs } = collect(root);
const d = draft(last, pkg, prs);
if (values.out) writeFileSync(values.out, issueBody(d));
if (!prs.length) console.log(`Nothing merged since ${last ?? "the start"}.`);
else console.log(`${prs.length} PR(s) merged since ${last ?? "the start"}. Tag message for v${d.next}:\n\n${d.message}\n`);
// For the workflow: whether there's anything to remind about.
if (process.env.GITHUB_OUTPUT) writeFileSync(process.env.GITHUB_OUTPUT, `count=${prs.length}\nnext=v${d.next}\n`, { flag: "a" });

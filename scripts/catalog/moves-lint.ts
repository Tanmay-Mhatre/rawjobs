/**
 * Refuse a moves.json with two active moves for one old board (lib/moves.ts checkMoves). The workflows
 * run it after rebasing onto the directory repo, before they push.
 *
 *   pnpm exec tsx scripts/catalog/moves-lint.ts directory-repo/moves.json
 */
import { existsSync, readFileSync } from "node:fs";
import { checkMoves, type MovesFile } from "./lib/moves";

const file = process.argv[2];
if (!file) throw new Error("Usage: moves-lint.ts moves.json");
if (existsSync(file)) {
  const problems = checkMoves(JSON.parse(readFileSync(file, "utf8")) as MovesFile);
  if (problems.length) {
    for (const p of problems) console.error(`::error::${p}`);
    process.exit(1);
  }
}
console.log("moves.json: one active move per old board.");

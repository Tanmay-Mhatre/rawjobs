import type { Resolved } from "../resolve";

/**
 * A re-resolve that ends in `error` (the site timed out or was unreachable this time) keeps the board
 * found before, so one bad week can't drop a company from the directory. The error is still recorded,
 * so the company is due again next run and the tally shows it.
 */
export function keepBoardOnError(previous: Resolved | undefined, next: Resolved): Resolved {
  if (next.status !== "error" || !previous?.board) return next;
  return { ...next, board: previous.board, ...(previous.also ? { also: previous.also } : {}) };
}

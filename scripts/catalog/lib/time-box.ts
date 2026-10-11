/** `--max-minutes N` from the command line, in ms (no flag: no limit). */
export const maxMsFromArgs = (argv = process.argv): number => {
  const i = argv.indexOf("--max-minutes");
  return i > 0 ? Number(argv[i + 1]) * 60_000 : Infinity;
};

/**
 * The next item of a work queue, or nothing once `maxMs` has passed since `started`: a time-boxed
 * run stops starting new work (work in flight finishes) and leaves the rest for the next run.
 */
export const nextInTime = <T>(queue: T[], started: number, maxMs: number, now = Date.now()): T | undefined => (now - started < maxMs ? queue.shift() : undefined);

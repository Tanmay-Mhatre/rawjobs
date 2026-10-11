import { serve } from "./serve";

/** `pnpm serve` / `pnpm start` from a checkout: the same as `rawjobs serve`. */
process.exit(await serve(process.argv.slice(2)));

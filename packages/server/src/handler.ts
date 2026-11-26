import type { IncomingMessage, ServerResponse } from "node:http";
import type { createApi } from "./api";
import { refuseHost } from "./guard";
import { type PageContext, servePages, serveStatic } from "./static";

type Api = Pick<ReturnType<typeof createApi>, "handle">;

/**
 * Every request the server answers: the API, then the built dashboard and the data folder, then the
 * pages (offline, 404…).
 * - The Host check comes first, for every path. A website that points its own name at 127.0.0.1
 *   (DNS rebinding) is same-origin with this server as far as the browser knows, and the data files
 *   (meta.json holds your profile) are served at the root, not under /api.
 * - Cross-Origin-Resource-Policy on every response: another site's page can't pull any of it into
 *   its own process with <img> or <script>. CORS fetches (the port-hop /api/health probe) aren't
 *   affected.
 */
export function createHandler(opts: { api: Api; roots: string[]; pages: PageContext }) {
  return (req: IncomingMessage, res: ServerResponse): void => {
    const why = refuseHost(req);
    if (why) {
      res.writeHead(403, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "cross-origin-resource-policy": "same-origin" }).end(why);
      return;
    }
    res.setHeader("cross-origin-resource-policy", "same-origin");
    void opts.api
      .handle(req, res)
      .then((handled) => {
        if (handled || serveStatic(opts.roots, req, res)) return;
        servePages(req, res, opts.pages);
      })
      .catch((err) => {
        // One request going wrong must not take the server (and every other page) down with it.
        console.error(`RawJobs: ${req.method} ${req.url} failed: ${(err as Error)?.stack ?? err}`);
        if (!res.headersSent) res.writeHead(500, { "content-type": "text/plain; charset=utf-8" }).end("Something went wrong. Try again.");
        else res.destroy();
      });
  };
}

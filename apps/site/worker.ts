// The site is static files, served without running this Worker. The one exception (wrangler.toml
// run_worker_first) is the job feed's Web Bot Auth key directory, which must be signed afresh on every
// read: /.well-known/http-message-signatures-directory. Without the WEB_BOT_AUTH_KEY secret it answers
// 404 like any missing page. Setup: docs/shared-directory.md#web-bot-auth
import { type BotKey, DIRECTORY_PATH, loadBotKey, signDirectory } from "../../scripts/catalog/lib/web-bot-auth";

type Env = { ASSETS: { fetch: (request: Request) => Promise<Response> }; WEB_BOT_AUTH_KEY?: string };

let cached: { pem: string; key: Promise<BotKey> } | undefined;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const pem = env.WEB_BOT_AUTH_KEY?.trim();
    if (url.pathname !== DIRECTORY_PATH || !pem || (request.method !== "GET" && request.method !== "HEAD")) {
      return env.ASSETS.fetch(request);
    }
    if (cached?.pem !== pem) cached = { pem, key: loadBotKey(pem) };
    const { body, headers } = await signDirectory(await cached.key, url.host);
    return new Response(request.method === "HEAD" ? null : body, { headers });
  },
};

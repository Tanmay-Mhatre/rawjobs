import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { defaultDataDir } from "../../packages/core/src/paths";
import { createApi } from "../../packages/server/src/api";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
/** Your RawJobs folder (RAWJOBS_HOME), else this checkout, as before. */
const home = process.env.RAWJOBS_HOME ? resolve(process.env.RAWJOBS_HOME) : repoRoot;
/** The run output folder is served as the site root: /jobs.json, /meta.json. */
const dataDir = defaultDataDir(home);
// Vite only serves a public dir that exists at startup; the first scan creates the files later.
mkdirSync(dataDir, { recursive: true });

/**
 * Dev only: the dashboard's local API (packages/server/src/api.ts, the same one `pnpm start` serves).
 * Not part of the static build; the dev server listens on 127.0.0.1 only.
 */
function localApi(): Plugin {
  return {
    name: "rawjobs-local-api",
    apply: "serve",
    configureServer(server) {
      const api = createApi({ home, dataDir });
      api.startBackground();
      server.middlewares.use((req, res, next) => {
        void api.handle(req, res).then((handled) => {
          if (!handled) next();
        });
      });
    },
  };
}

export default defineConfig({
  base: "./",
  publicDir: dataDir,
  plugins: [react(), tailwindcss(), localApi()],
  // open: `pnpm dev` opens the dashboard in your browser (BROWSER=none turns that off).
  server: { port: 5173, host: "127.0.0.1", open: true },
});

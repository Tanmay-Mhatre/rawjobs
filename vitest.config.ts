import { defineConfig } from "vitest/config";

export default defineConfig({
  // The web app's component tests render JSX (tsconfig "jsx": "react-jsx").
  esbuild: { jsx: "automatic" },
  test: {
    // The first test in a file also pays for loading big tables (places, industries). With every
    // file running at once on a busy machine that passed the 5 s default, so pushes failed at random.
    testTimeout: 20_000,
    setupFiles: ["test/no-network.ts"],
    include: ["packages/*/test/**/*.test.ts", "apps/web/test/**/*.test.{ts,tsx}", "services/*/test/**/*.test.ts", "scripts/**/*.test.ts"],
  },
});

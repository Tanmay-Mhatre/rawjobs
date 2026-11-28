import { defineConfig } from "vitest/config";

export default defineConfig({
  // The web app's component tests render JSX (tsconfig "jsx": "react-jsx").
  esbuild: { jsx: "automatic" },
  test: {
    // The first test in a file also pays for loading big tables (places, industries). With every
    // file running at once on a busy machine that passed the 5 s default, so pushes failed at random.
    // Windows starts a tsx child process 2–3× slower than Linux; the CLI tests spawn several each.
    testTimeout: process.platform === "win32" ? 60_000 : 20_000,
    setupFiles: ["test/no-network.ts"],
    include: ["packages/*/test/**/*.test.ts", "apps/web/test/**/*.test.{ts,tsx}", "services/*/test/**/*.test.ts", "scripts/**/*.test.ts"],
    // `pnpm test:coverage`, or RAWJOBS_COVERAGE=1 (CI's check job). Only the code that ships counts.
    coverage: {
      enabled: process.env.RAWJOBS_COVERAGE === "1",
      provider: "v8",
      include: ["packages/*/src/**", "apps/web/src/**", "services/*/src/**"],
      exclude: ["**/*.d.ts", "**/*.md"],
      reporter: ["text-summary", "json-summary"],
      reportOnFailure: true,
      // Floors, not goals: just under the numbers when they were set. A pull request that adds tests
      // raises them (pnpm test:coverage --coverage.thresholds.autoUpdate); none lowers them.
      thresholds: {
        lines: 83,
        branches: 72,
        "packages/core/src/**": { lines: 94, branches: 80 },
        "packages/server/src/**": { lines: 79, branches: 70 },
        "packages/cli/src/**": { lines: 27, branches: 20 },
        "apps/web/src/**": { lines: 77, branches: 67 },
      },
    },
  },
});

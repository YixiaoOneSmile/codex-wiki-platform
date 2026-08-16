import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: ["./apps/api/test/global-setup.ts"],
    include: ["apps/**/*.test.ts", "packages/**/*.test.ts"],
    exclude: ["runtime/**", "node_modules/**", "dist/**"],
    pool: "forks",
    maxWorkers: 1,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    coverage: { reporter: ["text", "html"] },
  },
});

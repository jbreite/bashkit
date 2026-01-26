import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  test: {
    // Test discovery
    include: ["tests/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],

    // Environment
    environment: "node",
    globals: true,

    // Performance: threads pool is faster than forks
    pool: "threads",

    // Setup
    setupFiles: ["tests/setup.ts"],

    // Timeouts
    testTimeout: 10000,
    hookTimeout: 10000,

    // Reporters: default for local, github-actions for CI
    reporters: process.env.CI ? ["default", "github-actions"] : ["default"],

    // Coverage
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html", "lcov"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.d.ts", "src/cli/**", "src/index.ts"],
      // Thresholds can be enabled once coverage improves
      // thresholds: {
      //   lines: 80,
      //   functions: 80,
      //   branches: 80,
      //   statements: 80,
      // },
    },
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
      "@test": resolve(__dirname, "tests"),
    },
  },
});

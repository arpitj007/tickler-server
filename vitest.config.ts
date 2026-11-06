import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    exclude: ["test/workers/**", "**/node_modules/**"],
    // node:sqlite needs this flag before Node 22.13; harmless after.
    execArgv: ["--experimental-sqlite", "--no-warnings=ExperimentalWarning"],
  },
});

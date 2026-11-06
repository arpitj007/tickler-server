// D1 tests inside the Workers runtime (workerd), using the same wrangler.jsonc.
// https://developers.cloudflare.com/workers/testing/vitest-integration/ (checked 2026-11-06)
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: { bindings: { TICKLER_SECRET: "workers-test-secret-0123456789", TICKLER_PUBLIC_URL: "https://tickler.test" } },
    }),
  ],
  test: { include: ["test/workers/**/*.test.ts"] },
});

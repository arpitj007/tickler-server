// Tickler Cloud tests inside workerd: Durable Object storage, routing and alarms (wrangler.cloud.jsonc, staging).
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.cloud.jsonc", environment: "staging" },
      miniflare: { bindings: { CLOUD_SECRET: "cloud-workers-test-secret-0123456789", CLOUD_SERVER_URL: "https://cloud.test/s/{id}" } },
    }),
  ],
  test: { include: ["test/cloud-workers/**/*.test.ts"] },
});

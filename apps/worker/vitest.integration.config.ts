import { fileURLToPath } from "node:url";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      main: "./src/index.ts",
      miniflare: {
        d1Databases: ["DB"],
        bindings: {
          ADMIN_ACCESS_CODE: "admin-integration-access-code",
          PRIMARY_SCANNER_ACCESS_CODE: "primary-integration-access-code",
          SECONDARY_SCANNER_ACCESS_CODE: "secondary-integration-access-code",
          SESSION_SECRET: "integration-session-secret-with-more-than-32-characters",
          OFFLINE_GRANT_PRIVATE_KEY: "unused-by-current-integration-tests",
          TEST_MIGRATIONS: await readD1Migrations(
            fileURLToPath(new URL("../../migrations", import.meta.url)),
          ),
        },
      },
    })),
  ],
  test: {
    include: ["tests/*.integration.test.ts"],
    setupFiles: ["./tests/setup.integration.ts"],
  },
});

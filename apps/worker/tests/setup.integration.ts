import { env } from "cloudflare:workers";
import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import type { Env } from "../src/types";

type IntegrationEnv = Env & {
  TEST_MIGRATIONS: D1Migration[];
};

const integrationEnv = env as unknown as IntegrationEnv;
await applyD1Migrations(integrationEnv.DB, integrationEnv.TEST_MIGRATIONS);

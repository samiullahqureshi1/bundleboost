import { execSync } from "node:child_process";
import type { TestProject } from "vitest/node";

/**
 * Applies migrations to the dedicated test database before the integration
 * suite runs. Refuses to touch any database whose name doesn't end in
 * `_test`, so a misconfigured DATABASE_URL can never wipe dev/prod data.
 */
export default function setup(project: TestProject) {
  const env = project.config.env ?? {};
  const urls = {
    DATABASE_URL: env.DATABASE_URL as string | undefined,
    DIRECT_URL: env.DIRECT_URL as string | undefined,
  };
  for (const [name, url] of Object.entries(urls)) {
    if (!url) throw new Error(`${name} is not set for integration tests (see .env.test.example)`);
    const dbName = new URL(url).pathname.replace(/^\//, "");
    if (!dbName.endsWith("_test")) {
      throw new Error(`Refusing to run integration tests: ${name} points at "${dbName}"; use a *_test database.`);
    }
  }
  // Same resilient path as `shopify app dev`: falls back to an HTTPS check
  // when port 5432 is blocked and DATABASE_ADAPTER=neon.
  execSync("node scripts/migrate.mjs", {
    stdio: "inherit",
    env: {
      ...process.env,
      DATABASE_URL: urls.DATABASE_URL,
      DIRECT_URL: urls.DIRECT_URL,
      DATABASE_ADAPTER: (env.DATABASE_ADAPTER as string | undefined) ?? "",
    },
  });
}

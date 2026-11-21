import { defineConfig, loadEnv } from "vite";

// Kept separate from vite.config.js: the React Router plugin is not needed
// (and not compatible) when running plain unit/integration tests.
export default defineConfig(({ mode }) => {
  // Loads .env then .env.test, so DATABASE_URL points at the test database.
  const env = loadEnv(mode === "development" ? "test" : mode, process.cwd(), "");
  return {
    test: {
      projects: [
        {
          test: {
            name: "unit",
            include: ["tests/unit/**/*.test.ts"],
            environment: "node",
          },
        },
        {
          test: {
            name: "integration",
            include: ["tests/integration/**/*.test.ts"],
            environment: "node",
            env: {
              DATABASE_URL: env.DATABASE_URL,
              DIRECT_URL: env.DIRECT_URL,
              DATABASE_ADAPTER: env.DATABASE_ADAPTER ?? "",
              NODE_ENV: "test",
              // Placeholder app config so server modules that read env() load;
              // tests never call Shopify with these.
              SHOPIFY_API_KEY: "test-api-key",
              SHOPIFY_API_SECRET: "test-api-secret",
              SHOPIFY_APP_URL: "https://bundleboost.test",
            },
            globalSetup: ["tests/support/integration-global-setup.ts"],
            // Tests share one database; run every file in a single worker.
            pool: "forks",
            poolOptions: { forks: { singleFork: true } },
            // The test database is remote (Neon), ~300 ms per round trip.
            testTimeout: 120_000,
            hookTimeout: 120_000,
          },
        },
      ],
    },
  };
});

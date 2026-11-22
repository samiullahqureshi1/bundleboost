// Runs database migrations during the Vercel build, but only for the
// production deployment: preview builds must never change the live database.
import { execFileSync } from "node:child_process";
import process from "node:process";

if (process.env.VERCEL_ENV !== "production") {
  console.log(`[vercel-migrate] Skipping migrations (VERCEL_ENV=${process.env.VERCEL_ENV ?? "unset"}).`);
  process.exit(0);
}
console.log("[vercel-migrate] Production build: applying migrations.");
execFileSync("node", ["scripts/migrate.mjs"], { stdio: "inherit" });

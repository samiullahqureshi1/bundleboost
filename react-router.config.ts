import type { Config } from "@react-router/dev/config";
import { vercelPreset } from "@vercel/react-router/vite";

/**
 * On Vercel (VERCEL=1 during its build) the Vercel preset splits the server
 * build into functions and applies each route's `export const config`
 * (e.g. maxDuration on /jobs/renewals). Elsewhere the build stays a single
 * server bundle, so `npm run build && npm start` keeps working.
 */
export default {
  ssr: true,
  presets: process.env.VERCEL ? [vercelPreset()] : [],
} satisfies Config;

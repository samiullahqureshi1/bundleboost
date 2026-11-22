import { timingSafeEqual } from "node:crypto";

/**
 * True when the request carries "Authorization: Bearer <secret>" for one of
 * the configured job secrets (Vercel Cron's CRON_SECRET or JOBS_SECRET).
 * Constant-time compare; no secret configured = never authorized.
 */
export function isAuthorizedJobRequest(request: Request, secrets: (string | undefined)[]): boolean {
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  return secrets.some((secret) => {
    if (!secret) return false;
    const expected = Buffer.from(`Bearer ${secret}`);
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

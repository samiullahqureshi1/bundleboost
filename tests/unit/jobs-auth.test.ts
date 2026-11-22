import { describe, expect, it } from "vitest";
import { isAuthorizedJobRequest } from "../../app/.server/jobs-auth";

const req = (auth?: string) => new Request("https://app.test/jobs/renewals", auth ? { headers: { authorization: auth } } : {});
const CRON = "cron-secret-0123456789abcdef";
const JOBS = "jobs-secret-0123456789abcdef";

describe("renewal job auth", () => {
  it("accepts Vercel's CRON_SECRET or the JOBS_SECRET as a bearer token", () => {
    expect(isAuthorizedJobRequest(req(`Bearer ${CRON}`), [CRON, JOBS])).toBe(true);
    expect(isAuthorizedJobRequest(req(`Bearer ${JOBS}`), [CRON, JOBS])).toBe(true);
    expect(isAuthorizedJobRequest(req(`Bearer ${JOBS}`), [undefined, JOBS])).toBe(true);
  });

  it("rejects missing, wrong or partial tokens, and everything when no secret is set", () => {
    expect(isAuthorizedJobRequest(req(), [CRON])).toBe(false);
    expect(isAuthorizedJobRequest(req("Bearer nope"), [CRON])).toBe(false);
    expect(isAuthorizedJobRequest(req(CRON), [CRON])).toBe(false);
    expect(isAuthorizedJobRequest(req(`Bearer ${CRON}x`), [CRON])).toBe(false);
    expect(isAuthorizedJobRequest(req("Bearer "), [undefined, undefined])).toBe(false);
  });
});

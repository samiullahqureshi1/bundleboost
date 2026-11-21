import { describe, expect, it } from "vitest";
import { EnvValidationError, parseServerEnv } from "../../app/.server/env";
import { redact } from "../../app/.server/logger";
import { formatDiscount, formatTierSummary } from "../../app/lib/format";

describe("parseServerEnv", () => {
  const base = {
    SHOPIFY_API_KEY: "key",
    SHOPIFY_API_SECRET: "secret",
    SHOPIFY_APP_URL: "https://app.example.com",
    DATABASE_URL: "postgresql://u:p@localhost:5432/db",
  };

  it("accepts a complete environment", () => {
    expect(parseServerEnv(base).NODE_ENV).toBe("development");
  });

  it("reports missing and invalid variables without echoing values", () => {
    try {
      parseServerEnv({ ...base, SHOPIFY_API_SECRET: "", DATABASE_URL: "file:dev.sqlite" });
      throw new Error("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(EnvValidationError);
      const message = (error as Error).message;
      expect(message).toContain("SHOPIFY_API_SECRET");
      expect(message).toContain("DATABASE_URL");
      expect(message).not.toContain("file:dev.sqlite");
    }
  });
});

describe("redact", () => {
  it("removes credential-like keys at any depth", () => {
    expect(
      redact({ shop: "a.myshopify.com", accessToken: "shpat_x", nested: { refreshToken: "y", ok: 1 } }),
    ).toEqual({ shop: "a.myshopify.com", accessToken: "[REDACTED]", nested: { refreshToken: "[REDACTED]", ok: 1 } });
  });

  it("serialises errors to name and message only", () => {
    expect(redact({ error: new TypeError("boom") })).toEqual({ error: { name: "TypeError", message: "boom" } });
  });
});

describe("format helpers", () => {
  it("formats percentage and fixed discounts", () => {
    expect(formatDiscount("PERCENTAGE", "10.00")).toBe("10% off");
    expect(formatDiscount("FIXED_AMOUNT", "5", "USD")).toMatch(/5\.00 off each/);
  });

  it("summarises tiers", () => {
    expect(
      formatTierSummary("PERCENTAGE", [
        { minQuantity: 2, value: "5" },
        { minQuantity: 3, value: "10" },
      ]),
    ).toBe("2+: 5% off · 3+: 10% off");
  });
});

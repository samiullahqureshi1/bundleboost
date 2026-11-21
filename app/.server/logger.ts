/**
 * Minimal structured logger. Emits one JSON object per line so logs can be
 * ingested by any hosting provider. Keys that may carry credentials are
 * redacted recursively — Shopify access tokens must never reach the logs.
 */
type Level = "debug" | "info" | "warn" | "error";
type Fields = Record<string, unknown>;

const SENSITIVE_KEY = /token|secret|password|authorization|cookie|hmac/i;

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6 || value === null || typeof value !== "object") return value;
  if (value instanceof Error) {
    return { name: value.name, message: value.message };
  }
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  const out: Fields = {};
  for (const [key, v] of Object.entries(value as Fields)) {
    out[key] = SENSITIVE_KEY.test(key) ? "[REDACTED]" : redact(v, depth + 1);
  }
  return out;
}

function write(level: Level, message: string, fields: Fields = {}) {
  if (level === "debug" && process.env.NODE_ENV === "production") return;
  const line = JSON.stringify({
    level,
    time: new Date().toISOString(),
    message,
    ...(redact(fields) as Fields),
  });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const logger = {
  debug: (message: string, fields?: Fields) => write("debug", message, fields),
  info: (message: string, fields?: Fields) => write("info", message, fields),
  warn: (message: string, fields?: Fields) => write("warn", message, fields),
  error: (message: string, fields?: Fields) => write("error", message, fields),
};

import { ValidationError } from "./errors";

/** Parses a JSON request body, rejecting anything that isn't an object. */
export async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    try {
      const body = await request.json();
      if (body && typeof body === "object" && !Array.isArray(body)) {
        return body as Record<string, unknown>;
      }
    } catch {
      // fall through
    }
    throw new ValidationError({ form: "Invalid request body" });
  }
  return Object.fromEntries(await request.formData());
}

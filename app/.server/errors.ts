import { data } from "react-router";
import { logger } from "./logger";

export type FieldErrors = Record<string, string>;

export class AppError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationError extends AppError {
  constructor(
    public readonly fieldErrors: FieldErrors,
    message = "Please fix the highlighted fields.",
  ) {
    super(message, 422, "VALIDATION_FAILED");
  }
}

export class NotFoundError extends AppError {
  constructor(entity: string) {
    super(`${entity} not found`, 404, "NOT_FOUND");
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, 409, "CONFLICT");
  }
}

export class ShopifyApiError extends AppError {
  constructor(message: string) {
    super(message, 502, "SHOPIFY_API_ERROR");
  }
}

export type ActionFailure = {
  ok: false;
  code: string;
  message: string;
  fieldErrors?: FieldErrors;
};

/**
 * Converts a thrown error into a serialisable action result. Known
 * application errors keep their message; anything else is logged and
 * replaced by a generic message so internals never leak to the client.
 * Thrown Responses (redirects, auth bounces) are re-thrown untouched.
 */
export function toActionFailure(error: unknown, context: Record<string, unknown> = {}) {
  if (error instanceof Response) throw error;
  if (error instanceof AppError) {
    const body: ActionFailure = {
      ok: false,
      code: error.code,
      message: error.message,
      ...(error instanceof ValidationError
        ? { fieldErrors: error.fieldErrors }
        : {}),
    };
    return data(body, { status: error.status });
  }
  logger.error("Unhandled action error", { ...context, error });
  return data<ActionFailure>(
    {
      ok: false,
      code: "INTERNAL_ERROR",
      message: "Something went wrong. Please try again.",
    },
    { status: 500 },
  );
}

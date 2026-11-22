import type { ApiVersion } from "@shopify/shopify-app-react-router/server";
import { ShopifyApiError } from "../errors";
import { logger } from "../logger";

/**
 * The subset of the Shopify Admin API client the app depends on. Accepting
 * this interface (rather than the full library context) keeps services
 * decoupled from the request-authentication layer.
 */
export interface AdminGraphqlClient {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown>; apiVersion?: ApiVersion },
  ) => Promise<Response>;
}

type GraphqlEnvelope<T> = {
  data?: T;
  errors?: { message: string }[];
};

export async function adminQuery<T>(
  admin: AdminGraphqlClient,
  query: string,
  variables?: Record<string, unknown>,
  // A newer API version for this one call (e.g. an operation not in the default).
  { apiVersion }: { apiVersion?: ApiVersion } = {},
): Promise<T> {
  // The library throws on HTTP-level and GraphQL errors; it also throws a
  // Response for re-authentication, which must propagate untouched.
  const options = variables || apiVersion ? { ...(variables ? { variables } : {}), ...(apiVersion ? { apiVersion } : {}) } : undefined;
  const response = await admin.graphql(query, options);
  const body = (await response.json()) as GraphqlEnvelope<T>;
  if (body.errors?.length || !body.data) {
    logger.error("Admin GraphQL error", {
      errors: body.errors?.map((e) => e.message),
    });
    throw new ShopifyApiError("Shopify returned an error. Please try again.");
  }
  return body.data;
}

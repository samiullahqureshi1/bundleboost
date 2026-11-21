import { ShopifyApiError } from "../errors";
import { adminQuery, type AdminGraphqlClient } from "./graphql";
import { METAFIELDS_SET } from "./discounts";

/**
 * App-data metafields live on the app installation. They're private to the
 * app and readable from the theme app extension as `app.metafields`.
 */
export const STOREFRONT_NAMESPACE = "bundleboost";
export const STOREFRONT_KEY = "storefront";

const APP_INSTALLATION_ID = `#graphql
  query BundleBoostAppInstallationId {
    currentAppInstallation {
      id
    }
  }`;

export async function setStorefrontConfig(admin: AdminGraphqlClient, json: string) {
  const { currentAppInstallation } = await adminQuery<{
    currentAppInstallation: { id: string };
  }>(admin, APP_INSTALLATION_ID);

  const data = await adminQuery<{
    metafieldsSet: { userErrors: { message: string }[] };
  }>(admin, METAFIELDS_SET, {
    metafields: [
      {
        ownerId: currentAppInstallation.id,
        namespace: STOREFRONT_NAMESPACE,
        key: STOREFRONT_KEY,
        type: "json",
        value: json,
      },
    ],
  });
  const errors = data.metafieldsSet.userErrors;
  if (errors.length) throw new ShopifyApiError(errors.map((e) => e.message).join("; "));
}

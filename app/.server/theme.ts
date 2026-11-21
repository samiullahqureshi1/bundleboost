import { env } from "./env";

/** Opens the theme editor on a product template with the BundleBoost block added. */
export function themeEditorUrl(shopDomain: string) {
  return `https://${shopDomain}/admin/themes/current/editor?template=product&addAppBlockId=${env().SHOPIFY_API_KEY}/quantity-breaks&target=mainSection`;
}

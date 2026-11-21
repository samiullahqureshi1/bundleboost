import { adminQuery, type AdminGraphqlClient } from "./graphql";

const SHOP_INFO_QUERY = `#graphql
  query BundleBoostShopInfo {
    shop {
      name
      currencyCode
    }
  }`;

export type ShopInfo = { name: string; currencyCode: string };

export async function fetchShopInfo(admin: AdminGraphqlClient): Promise<ShopInfo> {
  const data = await adminQuery<{ shop: ShopInfo }>(admin, SHOP_INFO_QUERY);
  return data.shop;
}

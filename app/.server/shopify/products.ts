import { adminQuery, type AdminGraphqlClient } from "./graphql";

/**
 * Resolves product and variant IDs chosen in the App Bridge resource picker
 * against the Admin API. The picker result is client-supplied, so titles are
 * never trusted from the browser and every ID is confirmed to exist in the
 * authenticated shop.
 */
const PRODUCTS_BY_ID_QUERY = `#graphql
  query BundleBoostProductsById($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Product {
        id
        title
        handle
        featuredMedia {
          preview {
            image {
              url(transform: { maxWidth: 120, maxHeight: 120 })
            }
          }
        }
        variants(first: 250) {
          nodes {
            id
            title
          }
        }
      }
    }
  }`;

type ProductNode = {
  id: string;
  title: string;
  handle: string;
  featuredMedia: { preview: { image: { url: string } | null } | null } | null;
  variants: { nodes: { id: string; title: string }[] };
};

export type ResolvedProduct = {
  productGid: string;
  title: string;
  handle: string;
  imageUrl: string | null;
  variants: { variantGid: string; title: string }[];
};

const BATCH_SIZE = 50;

export async function fetchProductsByIds(
  admin: AdminGraphqlClient,
  productGids: string[],
): Promise<Map<string, ResolvedProduct>> {
  const result = new Map<string, ResolvedProduct>();
  for (let i = 0; i < productGids.length; i += BATCH_SIZE) {
    const ids = productGids.slice(i, i + BATCH_SIZE);
    const data = await adminQuery<{ nodes: (ProductNode | Record<string, never> | null)[] }>(
      admin,
      PRODUCTS_BY_ID_QUERY,
      { ids },
    );
    for (const node of data.nodes) {
      if (!node || !("id" in node)) continue;
      result.set(node.id, {
        productGid: node.id,
        title: node.title,
        handle: node.handle,
        imageUrl: node.featuredMedia?.preview?.image?.url ?? null,
        variants: node.variants.nodes.map((v) => ({
          variantGid: v.id,
          title: v.title,
        })),
      });
    }
  }
  return result;
}

import { redirect, type LoaderFunctionArgs } from "react-router";
import styles from "./styles.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return null;
};

/**
 * Public landing page. App Store apps are installed and opened from Shopify
 * only, so there's no shop-domain login form here.
 */
export default function App() {
  return (
    <div className={styles.index}>
      <div className={styles.content}>
        <h1 className={styles.heading}>BundleBoost</h1>
        <p className={styles.text}>
          Quantity breaks and volume discounts for Shopify stores.
        </p>
        <p className={styles.text}>
          Open BundleBoost from your Shopify admin (Apps → BundleBoost), or install it from the Shopify App Store.
        </p>
        <ul className={styles.list}>
          <li>
            <strong>Quantity tiers</strong>. Reward customers for buying more
            of the products you choose.
          </li>
          <li>
            <strong>Product and variant targeting</strong>. Apply each
            campaign to exactly the items you want.
          </li>
          <li>
            <strong>Built for Shopify</strong>. Managed from inside your
            Shopify admin.
          </li>
        </ul>
      </div>
    </div>
  );
}

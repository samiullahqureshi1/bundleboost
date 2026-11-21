import { redirect, Form, useLoaderData, type LoaderFunctionArgs } from "react-router";
import { login } from "../../shopify.server";
import styles from "./styles.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return { showForm: Boolean(login) };
};

export default function App() {
  const { showForm } = useLoaderData<typeof loader>();

  return (
    <div className={styles.index}>
      <div className={styles.content}>
        <h1 className={styles.heading}>BundleBoost</h1>
        <p className={styles.text}>
          Quantity breaks and volume discounts for Shopify stores.
        </p>
        {showForm && (
          <Form className={styles.form} method="post" action="/auth/login">
            <label className={styles.label}>
              <span>Shop domain</span>
              <input className={styles.input} type="text" name="shop" />
              <span>e.g: my-shop-domain.myshopify.com</span>
            </label>
            <button className={styles.button} type="submit">
              Log in
            </button>
          </Form>
        )}
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

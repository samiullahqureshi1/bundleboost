import "@shopify/ui-extensions/preact";
import { render } from "preact";

/** Order status page: shown only for orders with a subscription item. */
export default async () => {
  render(<OrderStatusLink />, document.body);
};

function OrderStatusLink() {
  const hasSubscription = shopify.lines.value.some((line) => Boolean(line.merchandise.sellingPlan));
  if (!hasSubscription) return null;
  const t = shopify.i18n.translate;
  return (
    <s-banner tone="info" heading={t("order.heading")}>
      <s-stack direction="block" gap="small-200">
        <s-text>{t("order.body")}</s-text>
        <s-link href="extension:bundleboost-subscriptions-portal/">{t("order.action")}</s-link>
      </s-stack>
    </s-banner>
  );
}

import "@shopify/ui-extensions/preact";
import { render } from "preact";

/** Profile page: a shortcut to the customer's subscriptions. */
export default async () => {
  render(<ProfileLink />, document.body);
};

function ProfileLink() {
  const t = shopify.i18n.translate;
  return (
    <s-section heading={t("profile.heading")}>
      <s-stack direction="block" gap="base">
        <s-text color="subdued">{t("profile.body")}</s-text>
        <s-button href="extension:bundleboost-subscriptions-portal/">{t("profile.action")}</s-button>
      </s-stack>
    </s-section>
  );
}

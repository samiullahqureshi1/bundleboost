import '@shopify/ui-extensions';

//@ts-ignore
declare module './src/SubscriptionsPage.tsx' {
  const shopify: import('@shopify/ui-extensions/customer-account.page.render').Api;
  const globalThis: { shopify: typeof shopify };
}

//@ts-ignore
declare module './src/api.ts' {
  const shopify: import('@shopify/ui-extensions/customer-account.page.render').Api;
  const globalThis: { shopify: typeof shopify };
}

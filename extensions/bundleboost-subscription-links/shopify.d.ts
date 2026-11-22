import '@shopify/ui-extensions';

//@ts-ignore
declare module './src/OrderStatusLink.tsx' {
  const shopify: import('@shopify/ui-extensions/customer-account.order-status.block.render').Api;
  const globalThis: { shopify: typeof shopify };
}

//@ts-ignore
declare module './src/ProfileLink.tsx' {
  const shopify: import('@shopify/ui-extensions/customer-account.profile.block.render').Api;
  const globalThis: { shopify: typeof shopify };
}

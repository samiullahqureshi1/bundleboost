# Subscriptions

BundleBoost is a Shopify subscription app: merchants create subscription
plans in BundleBoost, shoppers subscribe in the storefront widget, and
BundleBoost charges every renewal.

## How it works

| Step | Who | Code |
| --- | --- | --- |
| Merchant creates a plan (frequencies, discount, products) | BundleBoost → Shopify selling plan group | `subscription-plan.service.ts`, `shopify/subscription-plans.ts` |
| Shopper picks "Subscribe & save" + frequency, checks out | Storefront widget → Shopify checkout | `extensions/bundleboost-widget` |
| First order charged, subscription contract created | Shopify | — |
| BundleBoost stores the contract | `subscription_contracts/create` webhook | `webhooks.subscription_contracts.tsx` |
| Renewal charged when due | Hourly job → `subscriptionBillingCycleCharge` | `jobs.renewals.tsx`, `runRenewals` |
| Charge result | `subscription_billing_attempts/*` webhooks | `webhooks.subscription_billing_attempts.tsx` |
| Failed payment retried after 1 and 3 days, then the subscription is paused | Dunning | `recordFailure` |
| Merchant pauses / resumes / skips / cancels | Subscribers page | `app.subscribers.tsx`, `changeContract` |

A billing cycle is charged at most once (Shopify enforces this) and only
when it's due or within 24 hours. A cycle with a charge in progress isn't
charged again, so the job can safely run more often than hourly.

## Required access

- Protected **Subscription APIs** access (Dev Dashboard → app → Settings →
  Access requests). Scopes: `read_own_subscription_contracts`,
  `write_own_subscription_contracts`, `read_customer_payment_methods`.
- `write_products`, `write_purchase_options` for selling plans.
- `read_customers`, `read_orders` for the customer name/email and first order
  shown on the Subscribers page. These are **protected customer data**: dev
  stores allow them, but before App Store submission request Level 2
  (name, email) access in the Partner Dashboard → app → API access. Without
  it, BundleBoost falls back to showing the customer ID.

## Scheduling renewals (production)

### Vercel (Pro plan)

`vercel.json` registers an hourly Vercel Cron job:

```json
{ "crons": [{ "path": "/jobs/renewals", "schedule": "0 * * * *" }] }
```

In the Vercel project → Settings → Environment Variables, add
`CRON_SECRET` (a random string of at least 24 characters, e.g. from
`openssl rand -hex 32`). Vercel sends it as `Authorization: Bearer
<CRON_SECRET>` on every cron call; without it the endpoint answers 401 and
nothing is charged. Cron jobs run only on the **production** deployment.
Check runs under Project → Settings → Cron Jobs (and the function logs:
"Renewal job finished").

### Any other scheduler

Set `JOBS_SECRET` (at least 24 characters) and POST every hour:

```
curl -X POST https://<your-app-host>/jobs/renewals \
  -H "Authorization: Bearer $JOBS_SECRET"
```

Both return `{ shops, results: [{ shop, charged, advanced, failed }] }`.

During development there's no cron: use **Subscribers → Charge due
renewals now**, which runs the same job for the current store.

## Testing renewals on the development store

1. Subscriptions → Create plan with a **1 day** frequency (Shopify only
   charges cycles that are due or within 24 hours), add a product.
2. Storefront: choose Subscribe & save + "Delivery every day", check out with
   the Bogus Gateway (card number `1`).
3. Subscribers: the subscription appears with its next renewal.
4. Once it's due, click **Charge due renewals now**. A new order appears in
   Shopify and the next renewal moves forward a day.
5. Failed payments, retries and pausing are covered by
   `tests/integration/subscription-renewals.test.ts` (a declining card would
   also fail the first checkout, so it can't be reproduced this way).

## Customer portal ("My subscriptions")

Customers manage their own subscriptions in their Shopify customer account,
without contacting the store:

- See current and previous subscriptions: items, price per order, shipping,
  delivery frequency, next order date, status.
- Skip the next order (and undo it), pause, resume, cancel (each confirmed).
- Change the delivery frequency to another frequency of the same BundleBoost
  plan. The price follows that frequency's discount.
- Update the payment method: Shopify emails the customer a secure link
  (BundleBoost never sees card details).
- Change the delivery address. Shopify checks it can ship there and shows the
  new shipping price before it's saved.
- See order history and payments that didn't go through.

How it's built:

- `extensions/bundleboost-subscriptions-portal`: full page
  (`customer-account.page.render`). Merchants are prompted to add it to the
  customer account menu; it can also be added in Settings > Customer accounts.
- `extensions/bundleboost-subscription-links`: a banner on the order status page
  of orders with a subscription, and a block on the profile page, both
  linking to the portal.
- `app/routes/api.portal.subscriptions.tsx`: the portal's backend. It verifies
  Shopify's customer-account session token. The shop and customer come only
  from that token, and every subscription is checked to belong to that
  customer. Changes are recorded in the audit log with the actor `customer`.
- Address changes go through Shopify's Customer Account API from the
  extension itself (`customer_*_own_subscription_contracts` scopes).
- Frequency changes use the subscription contract Calculation API (Admin API
  2026-10, requested per call).

Setup the first time (Dev Dashboard > app > API access):

1. Allow **network access** for customer account UI extensions (the portal calls
   the BundleBoost backend).
2. Restart `shopify app dev` and accept the new scopes in the store
   (`write_customers`, `customer_read_customers`, `customer_read_own_subscription_contracts`,
   `customer_write_own_subscription_contracts`).
3. The store must use customer accounts (Settings > Customer accounts).

The extensions read the app URL from `APP_URL`, which Shopify CLI sets when it
bundles them: the dev tunnel during `shopify app dev`, and `application_url`
on `shopify app deploy`. So set `application_url` to the production URL
before deploying.

## Privacy

`customers/redact` erases the customer ID, name, email and first order from
their subscriptions; `customers/data_request` logs how many subscriptions are
held so the merchant can provide them. `shop/redact` deletes everything for
the shop. Uninstalling the app makes Shopify delete its selling plans after
48 hours.

# Billing — Shopify App Billing

BundleBoost uses Shopify's native **App Billing API** (`appSubscriptionCreate`, `billing.request` from `@shopify/shopify-app-react-router`), with support for test charges in development and fallback support for Partner Dashboard managed pricing:

- Plans are configured in `app/shopify.server.ts` (`billingConfig`).
- Merchants choose a plan directly in the app on `/app/billing`.
- Shopify presents the native subscription confirmation screen to approve or decline the charge.
- In development / non-production, test charges are used (`isTest: true`) so development stores can test plans at no charge.
- Shopify creates and bills the subscription. BundleBoost never stores payment details.

## Plans

| Handle | Name | Price | Active campaigns | Live products | Tiers / campaign | Widget |
| --- | --- | --- | --- | --- | --- | --- |
| `free` | Free | $0 | 1 | 5 | 3 | Basic: heading only |
| `growth` | Growth | $7.99 / 30 days | 10 | 100 | 10 | Customizable: + layout, accent colour, presets, savings and best-deal switches |
| `pro` | Pro | $14.99 / 30 days | 25\* | Unlimited\* | 20 | Full: + text colour, background colour, corner radius |

\* 25 is Shopify's limit of active discount functions per store, shared with other discount apps. "Unlimited" means no plan limit on products across campaigns; each campaign can still target at most 100 products, a technical limit.

Entitlements live in `app/lib/plans.ts`.

## How enforcement works (server-side)

| When | What is checked | Code |
| --- | --- | --- |
| Create or save a campaign | Tiers ≤ plan allowance | `campaign.service.ts` → `assertTierLimit` |
| Activate a campaign | Active campaigns < plan limit; distinct live products ≤ plan limit; tiers | `assertLiveLimits`, inside the activation transaction after the per-shop lock |
| Edit a live campaign | Live products ≤ plan limit | same |
| Save widget settings | Fields outside the plan can't be changed | `settings.service.ts` → `updateWidgetSettings` |
| Publish to storefront | Fields outside the plan are published as defaults | `storefront-sync.service.ts` (uses the cached plan) |

A downgrade never deletes or pauses anything. Campaigns above the new limits keep running, but new activations are blocked, and the Billing page shows an "over the limits" banner.

## How the app knows the plan

`getShopPlan` in `app/.server/services/billing.service.ts`:

1. Queries the Admin API `currentAppInstallation.activeSubscriptions` through the authenticated session.
2. If Partner API credentials are configured, it also checks the Partner API as fallback.
3. No active subscription means **Free**.
4. The result is cached on `BillingSubscription` for 5 minutes.
5. If the Shopify API call fails, the **last known plan** is kept, so a paying merchant is never downgraded by an outage.
6. The Billing page always re-checks on load (`{ fresh: true }`).

## Upgrading, Downgrading, and Cancelling

1. **Upgrade / Switch to paid plan**: On `/app/billing`, clicking "Upgrade to Growth" or "Upgrade to Pro" submits a form to `/app/billing` (POST), which triggers `billing.request({ plan, isTest, returnUrl })`. The merchant is redirected out to Shopify to approve the recurring charge. Once approved, Shopify redirects back to `/app/billing`, where the plan is refreshed and active.
2. **Downgrade to Free**: Clicking "Switch to Free" posts to `/app/billing` (`plan: "free"`), which calls `cancelCurrentSubscription`, cancels the subscription on Shopify, and sets the local plan to Free.
3. **Webhooks**: When a subscription is modified or cancelled in Shopify Admin, Shopify dispatches `app_subscriptions/update` to `/webhooks/app_subscriptions/update`, which marks the local cache stale so the next request updates state.

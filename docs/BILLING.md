# Billing — Shopify App Pricing

BundleBoost uses **Shopify App Pricing**, Shopify's recommended billing for new public apps:

- Plans are defined in the **Partner Dashboard**, not in code.
- Merchants choose a plan on Shopify's **hosted plan selection page**.
- Shopify creates and bills the subscription. The app never calls `appSubscriptionCreate` and never sees payment details.

## Plans

| Handle | Name | Price | Active campaigns | Live products | Tiers / campaign | Widget |
| --- | --- | --- | --- | --- | --- | --- |
| `free` | Free | $0 | 1 | 5 | 3 | Basic: heading only |
| `growth` | Growth | $7.99 / month | 10 | 100 | 10 | Customizable: + layout, accent colour, presets, savings and best-deal switches |
| `pro` | Pro | $14.99 / month | 25\* | Unlimited\* | 20 | Full: + text colour, background colour, corner radius |

\* 25 is Shopify's limit of active discount functions per store, shared with other discount apps. "Unlimited" means no plan limit on products across campaigns; each campaign can still target at most 100 products, a technical limit.

Entitlements live in `app/lib/plans.ts`. The plan **handles** there must match the handles you create in the Partner Dashboard exactly.

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

1. Runs the Partner API `activeSubscription(appId, shopId)` query (validated against 2026-10). The plan is `items[].handle`.
2. No subscription means **Free**.
3. The result is cached on `BillingSubscription` for 5 minutes. The Partner API allows 4 requests per second.
4. If the Partner API call fails, the **last known plan** is kept, so a paying merchant is never downgraded by an outage.
5. The Billing page always re-checks. Shopify's `?plan_handle=` redirect parameter is never trusted on its own.

## Setup checklist (you do this in the Partner Dashboard)

1. **Partner Dashboard → Apps → BundleBoost → Distribution → Manage listing → Pricing content → Manage.** Choose Shopify App Pricing.
2. Create three **public plans** with these exact handles and prices:
   - `free` — $0
   - `growth` — $7.99 every 30 days
   - `pro` — $14.99 every 30 days

   Add the display names and feature lists from the table above.
3. Set each plan's **welcome link** to `/app/billing`. Shopify appends `plan_handle`, and the page re-checks the plan.
4. **Partner Dashboard → Settings → Partner API clients:** create a client that can view apps and subscriptions. Copy its access token.
5. Set the environment variables (local `.env` and production):

   ```bash
   SHOPIFY_APP_HANDLE=<the app handle in your plan page URL>
   SHOPIFY_PARTNER_ORG_ID=194174159
   SHOPIFY_PARTNER_API_ACCESS_TOKEN=<token from step 4>   # secret
   SHOPIFY_APP_GID=gid://shopify/App/437060665345
   ```

6. Restart `shopify app dev`. On the development store, pick each plan. Dev stores in your organization can test paid plans at no charge. Confirm that the Billing page shows the right plan and limits.

Until steps 4–5 are done, every shop is treated as **Free**, and the Billing page says paid plans aren't available yet.

## Not verified yet

The Partner API call and the hosted plan page haven't been exercised end to end, because the plans and token don't exist yet. The plan logic, limits and fallbacks are covered by `tests/unit/plans.test.ts` and `tests/integration/plan-limits.test.ts`.

# Next Phases

## Ready for Phase 2

- Campaign data model with lifecycle, targeting and tiers, plus nullable `shopifyDiscountId` and `lastSyncedAt` for the sync link.
- Validated campaign service with overlap prevention under a per-shop lock, which is the hook point for discount sync.
- Shop-level combination defaults (`ShopSettings.combineWith*`) ready to feed `combinesWith`.
- Widget appearance settings stored per shop, ready for a theme app block.
- Webhook ledger, audit log, tenant isolation and test harness (unit and integration on Postgres) in place.
- Function design documented in `DISCOUNT_FUNCTION_DESIGN.md`.

## Blockers and open items before or alongside Phase 2

1. **Live dev-store verification of Phase 1** (see `PHASE_1_VERIFICATION.md`). Needs `shopify app dev` with your Partner login and a development store.
2. **Pricing decision**: confirm Shopify App Pricing (recommended) and define plans in the Partner Dashboard, then set `SHOPIFY_APP_HANDLE`. If plan state will gate features, provide a **Partner API token** so the app can query `activeSubscription`. Alternatively, choose the Billing API (`appSubscriptionCreate`) instead.
3. **Hosting and production database**: choose a host and a managed PostgreSQL. Set the env vars from `.env.example`, then run `npm run setup` on deploy.
4. `application_url` and redirect URLs in `shopify.app.toml` are still `https://example.com`. The CLI updates them in dev (`automatically_update_urls_on_dev`). Production values are needed before App Store submission.
5. The `webhooks.api_version` (`2027-01`) is newer than the library's Admin API version (`2026-07`). This is harmless, but align them when upgrading `@shopify/shopify-app-react-router`.

## Phase 2: Checkout discounts and storefront (code complete; see `PHASE_2_VERIFICATION.md`)

Done: items 1–5. Item 6 is done in the Function and the widget falls back safely: fixed-amount savings are hidden when the shopper's currency differs from the shop currency. Remaining: 7 (schedule UI; the data model and sync already pass `startsAt`/`endsAt`) and 8 (billing).
Function build and schema checks are done. **Blocking sign-off:** create a dev store in the Tak ledger organization, then run the live checks in `PHASE_2_VERIFICATION.md`.
**Known limitation:** the JS Function can exceed the 11M instruction limit on carts with more than roughly 150 eligible lines. The optional follow-up is a Rust port.

Original scope:

1. Add the `write_discounts` scope and the discount metafield definition in the TOML.
2. Generate the Discount Function extension (`cart.lines.discounts.generate.run`) and implement it per the design. Add fixture tests and a `shopify app function run` instruction budget.
3. Discount sync service: ACTIVE → `discountAutomaticAppCreate`/`Update`, PAUSED → deactivate, ARCHIVED → delete. Make it idempotent with sync-error surfacing, a config-size guard (≤ 9 kB), and handling for the 25-active-functions limit.
4. Replace `CheckoutNotice` and `CheckoutSyncBadge` with real sync state.
5. Theme app extension (app block) rendering tiers with `WidgetSettings`, reading campaign data through an app-owned product metafield or the Storefront API.
6. Multi-currency handling for fixed-amount tiers (`presentmentCurrencyRate`).
7. Expose campaign schedule (`startsAt`/`endsAt`) in the UI.
8. Billing: Partner API subscription sync and plan-based limits, if chosen.

## Phase 3: Analytics and growth

- Order attribution: `orders/create` webhook (needs `read_orders`, protected customer data review) or ShopifyQL. Store discounted-order aggregates only, with no customer PII.
- Analytics page: discounted orders, revenue influenced, AOV uplift, all from recorded orders.
- Collection and tag targeting, mix-and-match across products, per-market campaigns.
- Webhook ledger pruning job (for example, 90-day retention).

## Phase 4: App Store submission

- App listing, privacy policy, support contact, screenshots, demo store.
- Built for Shopify review: performance (LCP, CLS, INP) in the admin, accessibility pass, storefront performance of the block.
- Production URLs in TOML, `shopify app deploy`, and protected-data and compliance attestations (compliance webhooks are already implemented).

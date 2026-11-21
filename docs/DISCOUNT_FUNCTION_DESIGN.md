# Discount Function Design

> **Status (Phase 2):** implemented in `extensions/bundleboost-quantity-breaks` (TypeScript, API 2026-10). Built with the official CLI and checked by 8 WASM fixture tests against the 2026-10 schema. Output is **one `productDiscountsAdd` operation, with one candidate per tier reached and `selectionStrategy: ALL`**; this choice is for the instruction budget. Measured cost: ~0.55M for typical carts, but 11–13M on 200-line carts where most lines are eligible, which is over the 11M limit. Keeping JavaScript was accepted as a known limitation for very large carts; a Rust port is the fix if needed. See `PHASE_2_VERIFICATION.md`.

Researched 2026-10-19 against shopify.dev: Discount Function API (`latest` = 2026-10), the "Build a discount function" guide, `discountAutomaticAppCreate`, and Shopify Functions resource limits. The Shopify Dev MCP server failed to connect in this session, so findings come from the public docs pages. Re-verify enum names and field shapes against the API version pinned when Phase 2 starts.

## 1. Which API

Use the unified **Discount Function API** (it replaces the older separate Product/Order Discount APIs) with the target **`cart.lines.discounts.generate.run`**, emitting the **`productDiscountsAdd`** operation. The delivery target (`cart.delivery-options.discounts.generate.run`) isn't needed.

The extension is generated with `shopify app generate extension --template discount` (type `function`) and lives in `extensions/bundleboost-quantity-breaks/`. Rust is preferred for instruction headroom: Shopify's tiered example costs about 62k instructions in Rust against about 520k in JS, well under the 11M limit either way. JS is acceptable if the team prefers it.

## 2. How quantity-based discounts are calculated

Input query (kept under the 3,000-byte query limit and cost 30):

```graphql
query Input {
  cart {
    lines {
      id
      quantity
      merchandise {
        __typename
        ... on ProductVariant { id product { id } }
      }
    }
  }
  discount {
    discountClasses
    metafield(namespace: "$app", key: "function-configuration") { jsonValue }
  }
}
```

Algorithm (pure, unit-tested in Phase 2):

1. Parse the config (see §4). If `discountClasses` lacks `PRODUCT`, return no operations.
2. Keep lines whose variant is eligible (§3).
3. Compute the quantity that drives the tier. Default: **sum per product across its eligible variants** ("buy 3 of any size"). A per-line alternative can be a campaign option later.
4. Pick the highest tier with `minQuantity ≤ quantity`. No tier means no operation.
5. Emit one candidate per eligible line:
   - percentage: `value: { percentage: { value: tier.value } }`
   - fixed per item: `value: { fixedAmount: { amount: tier.value, appliesToEachItem: true } }`
   - `targets: [{ cartLine: { id } }]` and `message: discountLabel`
6. `productDiscountsAdd { candidates, selectionStrategy }`. Use the strategy that applies every candidate (`ALL` in current examples; confirm the enum at implementation).

Fixed amounts are in the **shop currency**. The function must convert using `presentmentCurrencyRate` for multi-currency carts. This conversion is required before fixed-amount campaigns go live for Markets stores.

## 3. Product and variant eligibility

The function input exposes `ProductVariant.id`, `product.id`, `product.hasAnyTag`, `inAnyCollection` and `inCollections(ids)`. BundleBoost targets by ID, mirroring the DB model:

- a product listed with **no variants** means every variant of that product is eligible;
- a product listed **with variants** means only those variants are eligible.

## 4. How campaign configuration reaches the Function

Each campaign becomes **one automatic app discount** whose config lives in an app-owned discount metafield:

- Declared in `shopify.app.toml`: `[discount.metafields.app.function-configuration]`, `type = "json"`.
- Written by `discountAutomaticAppCreate` / `discountAutomaticAppUpdate` (`metafields: [{ namespace: "$app", key: "function-configuration", type: "json", value }]`).
- Read by the function through `discount.metafield(...).jsonValue`.

Compact config shape (numeric IDs, not full GIDs, to save bytes):

```json
{ "v": 1, "t": "P", "m": "Bulk savings",
  "p": { "123": [], "456": [789, 790] },
  "tiers": [[2, "5.00"], [4, "12.50"]] }
```

**Size constraint:** Function inputs don't return metafield values over **10,000 bytes**. With up to 100 products × 250 variants, a campaign could exceed that. Phase 2 must:
- serialise the config at sync time and **reject activation above about 9,000 bytes** with a clear message (suggest whole-product targeting);
- optionally offer collection or tag targeting (`inAnyCollection`/`hasAnyTag`) for large catalogues.

## 5. Automatic discount activation

Supported. `discountAutomaticAppCreate(automaticAppDiscount: { title, functionHandle (or functionId), discountClasses: [PRODUCT], startsAt, endsAt, combinesWith, metafields })` creates an active automatic discount (stable `functionHandle` is supported from API 2025-10). Status mapping:

| BundleBoost | Shopify action |
| --- | --- |
| DRAFT | nothing created |
| ACTIVE | create (first time) or update, with `startsAt` = now or campaign start |
| PAUSED | `discountAutomaticDeactivate` |
| ARCHIVED | `discountAutomaticDelete` (or deactivate, keeping history) |
| edit while ACTIVE | `discountAutomaticAppUpdate` (title, dates, metafield) |

`Campaign.shopifyDiscountId` and `lastSyncedAt` record the link. The sync must be idempotent and recoverable: write the DB, then Shopify, and if Shopify fails, store a sync error and surface "Not live at checkout".

**Limit:** Shopify documents that a store can have **at most 25 active discount functions**. That budget is shared with other apps. Phase 2 must surface `userErrors` from Shopify when it's exceeded and show the active-campaign count in the UI.

## 6. Overlapping campaigns

All discount functions run concurrently and independently, so one campaign's function can't see another's. Policy:

1. **Prevent at source (already implemented in Phase 1):** a campaign can't be ACTIVE if it targets a product/variant already targeted by another ACTIVE campaign in the shop. This is enforced in `campaign.service.ts` under a per-shop advisory lock, and tested.
2. **Combination with other discounts:** set `combinesWith.productDiscounts=false` by default, so if a third-party product discount also applies, Shopify picks the better one for the buyer rather than stacking. Merchants can opt in via Settings (`ShopSettings.combineWith*`). Order and shipping combination flags pass straight through.

## 7. Required configuration and permissions

| Item | Value |
| --- | --- |
| Access scope | `write_discounts` (add in Phase 2; `read_products` stays) |
| TOML | discount metafield definition `[discount.metafields.app.function-configuration]` |
| Extension | `type = "function"`, target `cart.lines.discounts.generate.run`, `input_query`, `export` |
| Merchant UI | optional `[extensions.ui]` link to `/app/campaigns/:id` so Shopify's Discounts page links back to BundleBoost |
| Deploy | `shopify app deploy` (functions ship with an app version) |
| Plan availability | Discount Functions in public apps work on all plans; the network-access fetch target is Plus/Enterprise custom apps only and **not** needed |

## 8. Resource limits to design around

11M instructions, 128 kB input and 20 kB output (scaling above 200 lines), 256 kB binary, 3,000-byte input query, 10,000-byte metafield values, query cost 30. One candidate per eligible line keeps output small. 200 lines is about 200 short candidates, well under 20 kB.

## 9. Phase 2 test plan

- Function unit tests over fixture inputs: no tiers met, boundary quantities, mixed eligible/ineligible lines, variant subsets, fixed vs percentage, multi-currency.
- `shopify app function run` with sample input JSON and an instruction-count budget check.
- Integration test of the sync service with an Admin GraphQL test double.
- Live dev-store checkout verification (manual, recorded in `PHASE_2_VERIFICATION.md`).

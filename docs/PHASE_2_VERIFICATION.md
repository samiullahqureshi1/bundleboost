# Phase 2 Verification: Checkout Discounts and Storefront Widget

Last updated 2026-11-21. macOS (arm64), Node 24.14.1, Shopify CLI 4.9.4, PostgreSQL 18 on Neon (dev database `neondb`, test database `bundleboost_test`). Local Docker Postgres was used for the earlier runs and has since been removed.

## Summary

| Area | Status |
| --- | --- |
| App linkage | ✅ Verified, unchanged |
| Function typegen, build and WASM output | ✅ Built with the official CLI |
| Function schema (input query, input/output fixtures) | ✅ Validated against the API 2026-10 schema |
| Instruction usage | ⚠️ Typical carts ~0.55M. **The worst case is over the 11M limit** (see below). |
| Extension files against the official template | ✅ Aligned (differences listed below) |
| `shopify app config validate` | ✅ `valid: true`, no issues |
| Typecheck, lint, all tests, production build | ✅ |
| Live dev-store testing (steps 6–9 of the request) | ❌ **Not performed.** The app's organization has no development store, and you chose to skip live testing. |

## 1. App linkage

`shopify app info` (account `samiullahqureshi669@gmail.com`):

- Remote app `gid://shopify/App/437060665345`, title `bundleboost`, organization **Tak ledger (194174159)**.
- Remote `apiKey` `4f89a504ab43c78ac4bd3017e4a315cc` matches `client_id` in `shopify.app.toml`.
- The CLI detects both extensions: `function` (bundleboost-quantity-breaks) and `theme_app_extension` (bundleboost-widget).
- No app was created and no credentials were changed. The app has no deployed version yet: the remote `applicationUrl` is still `https://example.com`, and granted scopes are only the default.

## 2–3. Function build and WebAssembly output

```bash
cd extensions/bundleboost-quantity-breaks
shopify app function schema --path .     # schema.graphql for api_version 2026-10
shopify app function typegen --path .    # generated/api.ts — succeeded
shopify app function build --path .      # "Function built successfully."
```

- `dist/function.wasm`: `WebAssembly (wasm) binary module version 0x1 (MVP)`, 4.1 kB. That is well under the 256 kB binary limit. It is small because Javy links dynamically against Shopify's JS provider.
- The bundle uses `@shopify/shopify_function` 2.0.1 (`ShopifyFunction.readInput/writeOutput`), which is the current runtime.
- During the build the CLI added a `uid` to both `shopify.extension.toml` files.

### Instruction usage (`shopify app function run --json`)

Measured with the final code (one consolidated operation, see the fixes below):

| Scenario | Instructions | Within 11M? |
| --- | --- | --- |
| 3 lines, 2 eligible (typical) | 546,487 | ✅ |
| 200 lines, discount class not PRODUCT (immediate return: pure input decode) | 5,665,675 | ✅ |
| 200 lines, none eligible | 6,850,910 | ✅ |
| 200 lines, all one product (1 candidate, 200 targets) | 11,277,644 | ❌ |
| 200 lines, 100 products, fixed amount + currency conversion | 13,437,540 | ❌ |
| Same as above, **before the fix** (100 operations) | 20,344,202 | ❌ |

**Finding:** the JavaScript runtime spends about 28k instructions per input line just decoding it, plus about 22k per emitted cart-line target. Shopify's budget is 11M for carts of up to 200 lines, which works out to about 55k per line. Mixed or typical carts are well within it. Carts with more than roughly 150 eligible lines can exceed it. When a Function exceeds its limit, Shopify doesn't apply that discount, but checkout still works.

**Decision (2026-11-21): keep JavaScript.** This is a **known limitation**: on carts with more than roughly 150 eligible lines, the Function can exceed its instruction limit, and Shopify then doesn't apply the BundleBoost discount to that cart (checkout itself is unaffected). A Rust port (about 10–20× cheaper) remains the documented fix if large B2B or wholesale carts become a requirement. It needs the Rust toolchain, and can reuse the logic, fixtures and config format unchanged.

## 4. Extension files against the official template

I generated a reference with `shopify app generate extension --template discount --flavor typescript`, compared the two, then moved the reference out of the project. It was never registered with the app.

| Item | Template | BundleBoost | Action |
| --- | --- | --- | --- |
| `[[extensions.targeting]]` target, `input_query`, kebab-case `export` | same | same | ✅ |
| `[extensions.build]` `command = ""`, `path = "dist/function.wasm"` | same | same | ✅ |
| `name`/`description` via `t:` keys and `locales/en.default.json` | same | same | ✅ |
| `src/index.ts` re-exporting targets; camelCase export name | same | same | ✅ |
| `package.json` scripts and `codegen` block | — | differed | **Aligned** to the template. Removed the unneeded `@graphql-codegen/*` devDependencies; added `@shopify/shopify-function-test-helpers` and `vitest`. |
| `.gitignore` (`dist`, `generated`), `vite.config.js`, `vitest.config.js` | present | missing | **Added** (copied from the template) |
| WASM fixture test `tests/default.test.js` | present | missing | **Added** with 8 BundleBoost fixtures |
| `uid` | present | missing | **Added by the CLI** during build |
| `api_version` | `2026-07` (CLI 4.9.4 default) | `2026-10` | Kept 2026-10, the latest stable per Shopify docs; schema fetch, typegen and build all succeed |
| Delivery-options target | present | omitted | Intentional: BundleBoost only discounts cart lines |
| `[extensions.ui.paths]` | absent | present | Intentional: links Shopify's Discounts page back to the app |

Theme extension: the CLI accepted it, added a `uid`, and `shopify app config validate` reports no issues. Theme Check (Dev MCP) passed earlier.

## 5. GraphQL schema verification

- **Input query:** typegen succeeded against the 2026-10 `schema.graphql`. The generated `CartLinesDiscountsGenerateRunInput` matches the hand-written input type field for field, including `presentmentCurrencyRate: string` and the `CustomProduct | ProductVariant` union.
- **Output shape:** the schema confirms `ProductDiscountSelectionStrategy { ALL FIRST MAXIMUM }`, `ProductDiscountCandidateFixedAmount { amount: Decimal!, appliesToEachItem: Boolean = false }`, and `CartLineTarget { id: ID!, quantity: Int }`.
- **Fixture tests** (`cd extensions/bundleboost-quantity-breaks && npx vitest run`): 8 of 8 pass. Each one builds the WASM, validates the input query, the input fixture and the expected output against the schema, then runs the real module:
  `percentage-sums-variants-of-product`, `below-first-tier`, `variant-restricted`, `mixed-tiers-across-products`, `fixed-amount-currency-conversion` (2.50 × 1.5 = 3.75 per item), `order-class-only`, `missing-configuration`, `custom-product-ignored`.
- **Admin operations** (create, update, activate, deactivate, delete, metafieldsSet, app installation) were validated against Admin API 2026-07 via the Dev MCP.

## 10. Full local checks

| Command | Result |
| --- | --- |
| `npm run typecheck` | ✅ |
| `npm run lint` | ✅ (after adding `/* eslint-env node */` to the template test) |
| `npm test`, unit + integration on **Neon** `bundleboost_test` | ✅ 89 passed (43 unit, 46 integration; ~11 min because of network latency) |
| Function WASM fixture tests | ✅ 8 passed |
| `npm run build` | ✅ |
| `npm ci --dry-run` | ✅ |

The integration tests that cover discount lifecycle, sync failures, recovery, overlap and the storefront config run against a stateful Admin API test double, not Shopify.

## Issues found and fixed in this pass

1. **Instruction budget.** The function emitted one `productDiscountsAdd` operation per product, costing 20.3M instructions on a 200-line cart. It now emits **one operation** with one candidate per tier reached (at most 10), each targeting disjoint lines, with `selectionStrategy: ALL`, which the schema documents as applying all candidates. The worst case dropped to 13.4M. The remaining overage is covered by the Rust recommendation above.
2. **Package manager mismatch.** The template's `pnpm-workspace.yaml` made the Shopify CLI run `pnpm` (its detection checks that file before `package-lock.json`). pnpm rewrote `node_modules`, created `pnpm-lock.yaml`, and the extension generation failed. The project uses npm (`package-lock.json`, npm `workspaces`, Dockerfile `npm ci`), so both pnpm files were **moved** (not deleted) to the session scratchpad, and `npm install` restored an npm layout. The CLI now reports `Package manager npm`. A leftover `node_modules/.pnpm` folder (561 MB, unused) can be deleted safely.
3. Lockfile: removed the extraneous entry left by the temporary template workspace.
4. `.gitignore`: fixed a missing newline that had merged two rules; added `/extensions/*/generated`.
5. **Database moved from local Docker to Neon** (PostgreSQL 18, `ap-southeast-1`). Dev uses `neondb` and tests use a separate `bundleboost_test`. Added `directUrl` for Prisma Migrate. `.env.test` is now gitignored because it holds credentials. The test setup refuses any non-`_test` database, for both `DATABASE_URL` and `DIRECT_URL`. Both migrations are applied to both databases.
6. **Remote-database latency** (~330 ms per query from this machine) exposed two problems:
   - Campaign saves used nested creates, one INSERT per variant. A 100-product × 19-variant campaign hit the 30 s transaction timeout. Saves now use `createMany`/`createManyAndReturn`, a constant 4–5 statements regardless of size.
   - Prisma's default 5 s interactive-transaction timeout was too tight for a remote database. It is now set to 30 s (`maxWait` 10 s) in `app/db.server.ts`, and the integration test timeout is 120 s.

   Production should run in the same region as the database.

## Remaining blockers

1. **No development store** in the Tak ledger organization (`shopify store list --type dev` returns none). Until one exists, none of these have been performed:
   - `shopify app dev`;
   - installing the app and approving `write_discounts`;
   - discount creation, activation, pausing, updating, deletion and sync-failure recovery against a real store;
   - checkout tests: percentage and fixed amounts, multiple lines, variants, currency conversion, overlap;
   - the widget in the theme editor and on the live storefront.
2. **Known limitation (accepted):** the discount may not apply on carts with more than roughly 150 eligible lines (JS instruction budget). The fix is a Rust port, if needed later.
3. Two Shopify behaviours are assumed by the sync code and still need a live check: a deactivated automatic discount reports `EXPIRED`, and a missing discount is reported as a userError on `id`.
4. Unchanged from Phase 1: hosting and production database, production URLs in the TOML, pricing setup.

## To finish live verification

```bash
# Create a dev store in Tak ledger (Dev Dashboard → Stores) or: shopify store create
shopify app dev --store <your-dev-store>.myshopify.com
```

Then run the checklist from the previous version of this document: activate a campaign and check Shopify → Discounts, test tier boundaries in the cart, pause and resume, test the theme block, and recreate a discount after deleting it in admin. Record the results here.

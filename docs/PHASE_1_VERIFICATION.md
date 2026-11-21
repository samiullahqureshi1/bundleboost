# Phase 1 Verification

Run on 2026-10-19, macOS (Darwin 25.6), Node 24.14.1, PostgreSQL 16 (Docker, `docker-compose.yml`).

## Automated checks

| Check | Command | Result |
| --- | --- | --- |
| Type checking | `npm run typecheck` (`react-router typegen && tsc --noEmit`, strict) | ✅ 0 errors |
| Lint | `npm run lint` (ESLint 8, TS + React + a11y rules) | ✅ 0 problems |
| Unit tests | `npm run test:unit` | ✅ 31 passed (3 files) |
| Integration tests | `npm run test:integration` (real PostgreSQL `bundleboost_test`) | ✅ 30 passed (2 files) |
| Production build | `npm run build` | ✅ client and SSR bundles built |
| Migrations | `prisma migrate status` | ✅ dev DB up to date; test DB migrated by global setup |
| All of the above | `npm run verify` | ✅ |

The suite logs one `"Webhook handler failed … db down"` line. It is expected: a test that simulates a handler failure produces it.

### What the tests cover

**Unit (`tests/unit`)**: campaign validation (names, discount types, product/variant GID format, duplicate products, tier count, quantity bounds, ascending quantities, non-decreasing discounts, percentage and fixed-amount bounds, decimal precision, date order, non-object input); status transition rules; overlap detection; widget and settings schemas; env validation (and that values aren't echoed); log redaction; formatting.

**Integration (`tests/integration`)**, against PostgreSQL:
- create draft with targets, tiers and audit row; titles taken from Shopify, not the client; variant subsets vs "all variants"; unknown products and foreign variants rejected; invalid input rejected before any Shopify call
- **tenant isolation**: another shop can't read, update, change status of, delete or list a campaign, and overlap checks are per shop
- update replaces children atomically; failed validation leaves data untouched; archived campaigns are read-only
- full lifecycle with audit trail; invalid transitions rejected; overlap blocks activation; disjoint variants allowed; **concurrent activations serialised** (only one wins); editing an active campaign into overlap rejected
- delete rules and cascades; archived campaigns hidden from the default list
- webhook idempotency: duplicate, concurrent duplicates, failure then retry, stale-claim recovery, recent claim not stolen
- shop lifecycle: tenant and default rows created on auth; uninstall revokes only that shop's sessions and keeps config; reinstall reactivates; `shop/redact` erases only that shop
- billing webhook mirroring; unknown shop ignored

The Admin GraphQL client in integration tests is a **test double** (`tests/support/admin-graphql-double.ts`) that stands in for a store catalogue. Production code always uses the authenticated Shopify client.

## Local runtime smoke test

The production build was run with `react-router-serve` on `localhost:3999`, with placeholder (non-real) API credentials and the test database:

| Request | Expected | Observed |
| --- | --- | --- |
| `GET /` | landing page | 200 |
| `GET /app` with no session | rejected by Shopify auth | 410 (library bounce) |
| `POST /webhooks/compliance`, HMAC signed with the wrong secret | 401 | **401** |
| Same, HMAC signed with the app secret (`shop/redact`) | 200, ledger row PROCESSED | **200**, row `smoke-1 / SHOP_REDACT / PROCESSED` |
| Same delivery id again | 200, handler skipped | **200**, log "Duplicate webhook ignored" |
| Server log contains secret or token strings | none | **none** |

## Not verified (no claims made)

- **Live Shopify verification was NOT performed.** No development store was connected in this session. `shopify app dev` (which needs Partner login, store selection and a tunnel) was not run. Not exercised against a real store:
  - installation and token exchange, and the `afterAuth` tenant creation;
  - App Bridge resource picker product selection;
  - rendering of the Polaris web-component screens inside the Shopify admin;
  - delivery of real webhooks from Shopify;
  - `currentAppInstallation.activeSubscriptions` behaviour for App Pricing subscriptions.
- The scope change (`read_products`) and new webhook subscriptions in `shopify.app.toml` take effect only after `shopify app dev` or `shopify app deploy`. They have not been pushed to Shopify.
- No browser or visual QA of the embedded UI was possible outside the Shopify admin. The Polaris web components and App Bridge script load only inside it.

## How to verify against a dev store

```bash
npm run db:up
npx prisma migrate dev
shopify app dev        # choose the dev store; accept the updated scopes
```

Then check:
1. Install and open the app. The Overview shows the welcome empty state, and a `Shop` row exists.
2. Create a campaign, select products in the picker, save the draft, and confirm it appears in Campaigns with "Not live at checkout".
3. Activate it. Create an overlapping campaign and confirm activation is refused.
4. Save the Widget and Settings screens. Open Billing.
5. `shopify app webhook trigger --topic app/uninstalled …` (or uninstall). Sessions are removed and `Shop.uninstalledAt` is set.

Record the results here.

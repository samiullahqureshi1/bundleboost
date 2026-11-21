# BundleBoost Architecture (Phase 1)

BundleBoost is one React Router (v7) application served by Node, embedded in the Shopify admin and backed by PostgreSQL. It has no microservices, queues or extra infrastructure. Shopify-side logic (the Discount Function and the theme block) will ship as extensions in this same app (Phase 2).

```
Shopify Admin (iframe)
  │  App Bridge session token
  ▼
React Router routes (app/routes)          ← UI + loaders/actions, thin
  │  requireAdmin(request)  → { admin, shop, actorId }
  ▼
Services (app/.server/services)           ← business rules, transactions, audit
  │                       │
  ▼                       ▼
Repositories (app/.server/repositories)   Shopify integration (app/.server/shopify)
  │  Prisma, always scoped by shopId        │  Admin GraphQL via authenticated client
  ▼                                         ▼
PostgreSQL                                Shopify Admin API (2026-07)
```

## Directory layout

| Path | Responsibility |
| --- | --- |
| `app/routes/` | Flat-file routes. Loaders/actions authenticate, call one service, and map errors. No Prisma calls except the trivial scopes webhook. |
| `app/.server/context.ts` | `requireAdmin()`: Shopify authentication plus tenant resolution. The single entry point for embedded routes. |
| `app/.server/services/` | Campaign lifecycle, settings, billing mirror, shop lifecycle, webhook idempotency, audit, analytics. |
| `app/.server/repositories/` | Prisma queries for campaigns. Every function takes `shopId`. |
| `app/.server/shopify/` | Admin GraphQL operations (`products`, `shop-info`, `billing`) behind the minimal `AdminGraphqlClient` interface. |
| `app/.server/env.ts` | Zod-validated environment, loaded on first use; errors name variables, never values. |
| `app/.server/logger.ts` | JSON-line logger with recursive redaction of token/secret/hmac/cookie keys. |
| `app/.server/errors.ts` | `AppError` hierarchy and `toActionFailure()` (safe messages; unknown errors are logged and replaced with a generic message). |
| `app/.server/webhooks.ts` | Shared webhook handler: HMAC verification, then idempotent processing, then 200/500. |
| `app/lib/` | Isomorphic code: Zod schemas for campaigns and settings, status transitions, overlap detection, formatting. Used by both client (instant feedback) and server (authoritative). |
| `app/components/` | Reusable Polaris-web-component UI: `CampaignForm`, `TierEditor`, `ProductTargets`, `Fields`, badges, notices, empty/error states, `WidgetPreview`. |
| `tests/` | Vitest `unit` and `integration` projects, plus support helpers. |

`.server` directories are excluded from the client bundle by React Router.

## Request flow (example: save a draft)

1. `CampaignForm` validates with `validateCampaignInput` and POSTs JSON via `useFetcher`.
2. `app.campaigns.new` action → `requireAdmin` (session token verified by `@shopify/shopify-app-react-router`).
3. `createDraftCampaign` re-validates, then resolves product/variant IDs with the **Admin GraphQL `nodes` query**. Titles and images come from Shopify, never from the browser, and unknown IDs are rejected.
4. One transaction inserts the campaign, targets, tiers and an `AuditLog` row.
5. The action redirects via the App Bridge-aware `redirect`.

## Security model

- **Authentication**: every `/app/*` loader and action calls `authenticate.admin` (through `requireAdmin`). Webhooks call `authenticate.webhook`, which verifies `X-Shopify-Hmac-Sha256` with the app secret (401 on mismatch, verified by the local smoke test).
- **Tenant isolation**: the shop is derived only from the verified session. Repository queries include `shopId` in every WHERE, including updates and deletes (`where: { id, shopId }`). Integration tests confirm cross-tenant reads and writes fail with `NotFoundError`.
- **Least privilege**: scopes are `read_products` only.
- **Secrets**: access tokens live only in `Session`. The logger redacts credential-like keys, and env validation never prints values.
- **Input validation**: Zod on every mutating action (campaigns, widget, settings, action intents). Request bodies must be JSON objects.
- **Concurrency**: activation takes a per-shop `pg_advisory_xact_lock` so two concurrent activations can't both pass the overlap check (covered by a test).
- **Errors**: actions return `{ ok:false, code, message, fieldErrors? }` with correct HTTP status. Route `ErrorBoundary`s render Polaris error states and pass Shopify auth responses to `boundary.error`.

## Webhooks

| Topic | Route | Handling |
| --- | --- | --- |
| `app/uninstalled` | `/webhooks/app/uninstalled` | Delete sessions (revoke tokens) and set `Shop.uninstalledAt`. Config kept for reinstall. |
| `app/scopes_update` | `/webhooks/app/scopes_update` | Update stored session scope. |
| `app_subscriptions/update` | `/webhooks/app_subscriptions/update` | Mirror status into `BillingSubscription`. |
| `customers/data_request`, `customers/redact` | `/webhooks/compliance` | Recorded; no customer data is stored. |
| `shop/redact` | `/webhooks/compliance` | Delete the `Shop` (cascades to all tenant rows) and sessions. |

Idempotency: `WebhookEvent.webhookId` is unique. The first delivery claims it (PROCESSING), duplicates return 200 without running the handler, failures are marked FAILED and return 500 so Shopify retries, and a PROCESSING claim older than 5 minutes can be re-claimed.

## Billing

- Shopify is the system of record. BundleBoost never creates or processes payments itself.
- **Chosen direction: Shopify App Pricing (managed pricing)**, which Shopify recommends by default for new public apps. Plans are defined in the Partner Dashboard, and merchants choose on Shopify's hosted page: `https://admin.shopify.com/store/{store}/charges/{app_handle}/pricing_plans`. The Billing screen links there once `SHOPIFY_APP_HANDLE` is set.
- Phase 1 mirrors state via the Admin API (`currentAppInstallation.activeSubscriptions`) and the `app_subscriptions/update` webhook.
- **Caveat**: Shopify's current App Pricing documentation names the **Partner API** `activeSubscription(appId, shopId)` as the authoritative source, and says App Pricing stopped sending the webhook after 2026-04-28. Admin API visibility of App Pricing subscriptions is unverified. Phase 2 must add a Partner API sync (needs a Partner API token) or switch to the Billing API, before any feature gating relies on plan state. No feature is gated in Phase 1.

## UI conventions

- Polaris web components only. Controlled inputs subscribe to native `input`/`change` events (`useFieldEvents`), because React 18 doesn't route `onChange` for custom elements.
- Every screen has an empty state, a route error boundary and loading states on submit buttons.
- No mock data: all numbers come from the database. Analytics explicitly shows "No sales data yet".
- Every campaign surface shows that campaigns are **not live at checkout** (`CheckoutNotice`, `CheckoutSyncBadge`).

## Local development

```bash
# .env and .env.test hold the Neon URLs (see .env.example / .env.test.example)
npx prisma migrate deploy
npm run dev          # shopify app dev
npm run verify       # typecheck + lint + tests + build
```

## Phase 2 additions: checkout and storefront

```
Campaign change (save / status / settings)
  │  DB transaction commits first
  ▼
discount-sync.service ── Admin API ──► automatic app discount (one per campaign)
  │                                      └─ $app:function-configuration metafield (≤ 9 kB)
  │                                             │ read at checkout by
  │                                             ▼
  │                               extensions/bundleboost-quantity-breaks (Discount Function)
  ▼
storefront-sync.service ── metafieldsSet ──► AppInstallation metafield bundleboost.storefront
                                                │ read by
                                                ▼
                                  extensions/bundleboost-widget (theme app block)
```

- **Status mapping:** ACTIVE → discount created/updated (re-activated if expired); PAUSED → `discountAutomaticDeactivate`; DRAFT/ARCHIVED → `discountAutomaticDelete`. A discount deleted in Shopify admin is recreated on the next sync.
- **Failure handling:** BundleBoost's change is never rolled back. The campaign gets `syncStatus=ERROR` and the message, the UI shows "Sync failed" with **Retry sync**, and toasts never claim checkout was updated when it wasn't. Activation is rejected up front if the function config would exceed 9 kB.
- **Combination settings and default label** live on each Shopify discount, so saving Settings re-syncs all ACTIVE/PAUSED campaigns.
- **Storefront data:** only ACTIVE + SYNCED campaigns are published, so the widget never advertises a discount checkout won't apply. The data lives in an app-data metafield, which needs no product write scope and is private to the app (`app.metafields` in Liquid).
- **Uninstall/reinstall:** uninstall marks synced campaigns `NOT_SYNCED` but keeps discount ids. Reinstall (`afterAuth`) re-syncs, updating existing discounts or recreating missing ones, so no duplicates are created.
- **Shopify Discounts page:** the function's `ui.paths.details` points to `/app/campaigns/discount/:id`, which resolves the owning campaign within the authenticated shop.
- **Scopes:** `read_products,write_discounts`.

## Database hosting

PostgreSQL is hosted on **Neon** (PostgreSQL 18). There is no local database container.

| Database | Used by | Env file |
| --- | --- | --- |
| `neondb` | `shopify app dev` / the running app | `.env` |
| `bundleboost_test` | integration tests only (truncated before each test) | `.env.test` |

- `DATABASE_URL` is Neon's **pooled** endpoint (`-pooler` host), used by the app at runtime.
- `DIRECT_URL` is the **direct** endpoint, used by Prisma Migrate (`directUrl` in `schema.prisma`).
- The per-shop `pg_advisory_xact_lock` is transaction-scoped, so it works through Neon's transaction-mode pooler.
- The test setup refuses to run unless both URLs point at a database whose name ends in `_test`.
- Both env files are gitignored. Credentials must never be committed, logged, or exposed to client code. Only `.server` modules read them.

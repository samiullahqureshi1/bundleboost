# Phase 1 — Repository Audit

Audit date: 2026-10-19. This records the project **as found**, before any Phase 1 change. What was changed afterwards is listed at the end.

## Summary

The repository was an unmodified **Shopify React Router app template, JavaScript variant**, linked to an existing Partner app (`client_id 4f89a504…15cc`, name `bundleboost`). It had no commits and no business logic. The scaffold worked and was a sound base, so it was **extended, not recreated**.

## Tooling and framework

| Area | Found |
| --- | --- |
| Shopify CLI | 4.9.4 (global `shopify`) |
| Template | `shopify.web.toml` name "React Router", roles frontend+backend; JS (`.jsx`) source |
| Node | v24.14.1 locally; `engines: >=20.19 <22 \|\| >=22.12` |
| React Router | 7.18.2 (`@react-router/dev`, `fs-routes`, `node`, `serve`), flat-file routes |
| React | 18.3.1 |
| TypeScript | 5.9.3 installed, `tsconfig.json` present (strict) but **no `.ts` source** |
| Shopify app package | `@shopify/shopify-app-react-router` 1.2.1 (bundles `@shopify/shopify-api` 13.1.0) |
| App Bridge | `@shopify/app-bridge-react` 4.2.13; `AppProvider` from the React Router package loads App Bridge and Polaris web components from the CDN |
| Polaris | **Polaris web components** (`<s-page>`, `<s-section>`…), typed by `@shopify/polaris-types` 1.1.0. No Polaris React. |
| Admin API version | `ApiVersion.July26` (2026-07) in code; webhooks `api_version = "2027-01"` in `shopify.app.toml` |
| Distribution | `AppDistribution.AppStore`; `future.expiringOfflineAccessTokens: true` |

## Authentication and sessions

- `shopifyApp()` with `authPathPrefix: "/auth"` and `PrismaSessionStorage`. With `embedded = true` and the TOML-managed scopes, the library uses **Shopify managed installation + token exchange**; there is no legacy OAuth redirect flow to maintain.
- `/auth/login` provided a shop-domain form for non-embedded login.
- Sessions were stored in a Prisma `Session` table (offline tokens, refresh token fields present).

## Database

- Prisma 6.19.3, **SQLite** (`file:dev.sqlite`), one migration `20240530213853_create_session_table` with only the `Session` table.
- No `dev.sqlite` file existed, so **no data could be lost** by changing provider.
- `.dockerignore` excluded `migrations` and `schema.prisma`, which would break `prisma migrate deploy` in a container.

## Shopify integration

- Admin GraphQL was used only by the template demo (`productCreate`, `productVariantsBulkUpdate`, `metaobjectUpsert`).
- Scopes: `write_products,write_metaobjects,write_metaobject_definitions`, needed only by the demo.
- TOML declared a demo product metafield (`app.demo_info`) and a demo metaobject (`app.example`).

## Webhooks (TOML subscriptions)

| Topic | Route | Behaviour found |
| --- | --- | --- |
| `app/uninstalled` | `/webhooks/app/uninstalled` | Deleted sessions; no idempotency record |
| `app/scopes_update` | `/webhooks/app/scopes_update` | Updated the session scope |

Missing for App Store: the mandatory **compliance webhooks** (`customers/data_request`, `customers/redact`, `shop/redact`).

## Environment variables

`SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SHOPIFY_APP_URL`, `SCOPES`, `SHOP_CUSTOM_DOMAIN` (optional), `PORT` and `FRONTEND_PORT` (Vite), `HOST` (CLI legacy). The CLI injects the Shopify values during `shopify app dev`. No validation, no `.env` and no `.env.example`.

## Scripts and tests

`build`, `dev`, `start`, `setup`, `lint` (ESLint 8), `typecheck` (`react-router typegen && tsc --noEmit`), plus Shopify CLI wrappers. **No test runner and no tests.**

## Gaps against the Phase 1 brief

1. JavaScript source; the brief asks for TypeScript.
2. SQLite instead of PostgreSQL.
3. No domain models, services or validation.
4. Over-broad scopes and demo TOML resources.
5. No compliance webhooks and no webhook idempotency.
6. No environment validation or structured logging.
7. No tests.
8. No local Postgres for development.

## What Phase 1 changed (summary)

- All app source converted to TypeScript. Template demo routes removed.
- Prisma switched to PostgreSQL. The SQLite migration was replaced by `20261019054726_init_postgres` (safe, because no SQLite database existed).
- Scopes reduced to `read_products`. Demo metafield and metaobject definitions removed from the TOML.
- Webhooks added for `app_subscriptions/update` and the three compliance topics.
- `.dockerignore` fixed. `docker-compose.yml`, `.env.example` and `.env.test` added.
- Vitest added with unit and integration suites. `zod` added for validation.

`client_id`, the app name and the URL/redirect settings were **not** changed. See `ARCHITECTURE.md` for the resulting structure.

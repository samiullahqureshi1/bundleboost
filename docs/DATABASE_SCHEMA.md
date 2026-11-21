# Database Schema

PostgreSQL 16 (any version ≥ 13 works), Prisma 6.19. Source of truth: `prisma/schema.prisma`. Migrations live in `prisma/migrations/`.

## Migration status

| Migration | Contents | Applied to |
| --- | --- | --- |
| `20261019054726_init_postgres` | All tables, enums and indexes below | Local dev DB `bundleboost` ✅; local test DB `bundleboost_test` ✅ (applied by the test global setup) |
| `20261120221844_campaign_discount_sync` (Phase 2, additive) | enum `SyncStatus`; `Campaign.syncStatus`, `Campaign.syncError`, index `(shopId, syncStatus)`; `Shop.storefrontSyncedAt` | Local dev ✅; local test ✅ |

The template's SQLite migration was removed: it can't run on PostgreSQL, and no SQLite database existed. Production and staging databases have **not** been migrated. Run `npm run setup` (`prisma generate && prisma migrate deploy`) on deploy. All migrations so far are additive. Destructive migrations require explicit approval.

## Entity overview

```
Shop 1─1 ShopSettings
Shop 1─1 WidgetSettings
Shop 1─1 BillingSubscription
Shop 1─* Campaign 1─* CampaignProduct 1─* CampaignVariant
                  1─* QuantityTier
Shop 1─* AuditLog
Session      (keyed by shop domain; owned by the Shopify session-storage adapter)
WebhookEvent (keyed by shop domain; intentionally not FK'd to Shop)
```

Every tenant-owned table cascades on `Shop` delete, so `shop/redact` is a single delete.

## Models

### Session
Exact shape required by `@shopify/shopify-app-session-storage-prisma`. Holds offline (and future online) access and refresh tokens. Index on `shop`. **Only table that contains credentials; never logged.**

### Shop
Tenant root. `domain` (unique, `*.myshopify.com`), `name`, `currencyCode` (from the Admin API), `installedAt`, `uninstalledAt` (set by `app/uninstalled`, cleared on reinstall), `storefrontSyncedAt` (last successful publish of the widget data).

### ShopSettings
`defaultDiscountLabel` and `combineWith{Product,Order,Shipping}Discounts`. These are the defaults the Phase 2 discount sync will pass to `combinesWith`.

### Campaign
| Column | Notes |
| --- | --- |
| `status` | enum `DRAFT \| ACTIVE \| PAUSED \| ARCHIVED` |
| `discountType` | enum `PERCENTAGE \| FIXED_AMOUNT` (applies to all tiers) |
| `discountLabel` | buyer-facing title; falls back to `ShopSettings.defaultDiscountLabel` |
| `startsAt`, `endsAt` | optional schedule (validated; not exposed in the Phase 1 UI) |
| `shopifyDiscountId`, `lastSyncedAt` | `DiscountAutomaticNode` GID of the campaign's Shopify automatic app discount; null = no discount in Shopify |
| `syncStatus`, `syncError` | `NOT_SYNCED \| SYNCED \| ERROR` and the last Shopify error. "Live at checkout" = `ACTIVE` + `SYNCED` |
| `archivedAt` | set when archived, cleared on restore |

Indexes: `(shopId, status)` and `(shopId, updatedAt)`.

Lifecycle (enforced in `app/lib/campaign-validation.ts`):

```
DRAFT ──► ACTIVE ◄──► PAUSED
  │         │           │
  └────► ARCHIVED ◄─────┘
            │
            └──► DRAFT (restore)
```

Activation requires at least one product and one tier, and no overlap with another ACTIVE campaign in the same shop. Only DRAFT and ARCHIVED campaigns can be deleted. ARCHIVED campaigns are read-only.

### CampaignProduct / CampaignVariant
`CampaignProduct` stores `productGid` plus a display snapshot (`title`, `handle`, `imageUrl`) taken from the Admin API. `shopId` is denormalised for tenant-scoped overlap queries (index `(shopId, productGid)`). Unique `(campaignId, productGid)`.
`CampaignVariant` rows narrow eligibility to specific variants. **No variant rows means every variant, including future ones.** Unique `(campaignProductId, variantGid)`.

### QuantityTier
`minQuantity` (int, ≥ 2), `value` (`Decimal(12,2)`: a percentage 0–100 or a per-item amount in shop currency), optional `label`, and `position`. Unique `(campaignId, minQuantity)`. Validation enforces strictly ascending quantities and non-decreasing discounts.

### WidgetSettings
Storefront block appearance: `heading`, `layout` (`STACKED \| GRID`), three hex colours, `borderRadius` (0–32), `showSavings`, `highlightBestDeal`.

### BillingSubscription
Cache of Shopify's subscription state: `shopifySubscriptionId`, `planName`, `status` (Shopify `AppSubscriptionStatus` or `NONE`), `test`, `trialDays`, `currentPeriodEnd`, `lastCheckedAt`.

### WebhookEvent
Idempotency ledger. `webhookId` unique, `shopDomain`, `topic`, `status` (`PROCESSING \| PROCESSED \| FAILED`), `error` (truncated to 500 chars), `receivedAt`, `processedAt`. It has no foreign key to `Shop`, so `shop/redact` can record itself after the shop is deleted. Retention: no customer PII is stored; consider pruning rows older than 90 days (Phase 3).

### AuditLog
`action` (e.g. `campaign.created`, `campaign.status_changed`), `entityType`, `entityId`, `actorId` (staff user id from the session token `sub`, when available), `metadata` JSON, `createdAt`. Written in the same transaction as the change it records.

## Data protection

- No customer personal data is stored. Product titles and images are merchant catalogue data.
- `app/uninstalled` deletes sessions immediately. `shop/redact` deletes every tenant row.
- Integration tests use a separate `*_test` database. The setup refuses to run against any other database name.

# Deploying BundleBoost to Vercel

The app is ready for Vercel (Pro plan, for the hourly renewal cron). What's
already set up in the repo:

| File | What it does |
| --- | --- |
| `react-router.config.ts` | Enables the Vercel preset when `VERCEL=1` (Vercel's build); local builds are unchanged. |
| `package.json` → `vercel-build` | `prisma generate`, migrations (production only), `react-router build`. Vercel runs this instead of `build`. |
| `scripts/vercel-migrate.mjs` | Applies migrations only when `VERCEL_ENV=production`, so preview builds never touch the live database. |
| `prisma/schema.prisma` | `binaryTargets = ["native", "rhel-openssl-3.0.x"]` for Vercel's runtime. |
| `vercel.json` | Hourly cron: `GET /jobs/renewals`. |
| `app/routes/jobs.renewals.tsx` | `export const config = { maxDuration: 300 }`; requires `CRON_SECRET`. |

## 1. Database (Neon)

Use a **separate production database** (e.g. a `production` branch in Neon),
not the development one. You need two connection strings:

- `DATABASE_URL`: the **pooled** connection (`-pooler` host).
- `DIRECT_URL`: the **direct** connection (used for migrations).

Migrations run automatically on every production deploy.

## 2. Create the Vercel project

1. Push the repo to GitHub/GitLab/Bitbucket and import it in Vercel.
2. Framework: React Router (auto-detected). Leave the build command empty:
   Vercel uses the `vercel-build` script.
3. Node.js version: **22.x** (Project → Settings → General).

## 3. Environment variables (Project → Settings → Environment Variables)

Set these for **Production** (and Preview if you use preview deployments
with their own database and app):

| Variable | Value |
| --- | --- |
| `SHOPIFY_API_KEY` | Client ID from the Dev Dashboard (`4f89a504…` for this app). |
| `SHOPIFY_API_SECRET` | Client secret from the Dev Dashboard. |
| `SHOPIFY_APP_URL` | `https://<your-vercel-domain>` (no trailing slash). |
| `SCOPES` | Same as `scopes` in `shopify.app.toml`. |
| `DATABASE_URL` | Neon pooled connection string (production). |
| `DIRECT_URL` | Neon direct connection string (production). |
| `DATABASE_ADAPTER` | `neon` |
| `CRON_SECRET` | Random string, at least 24 characters (`openssl rand -hex 32`). Required for renewals. |
| `SHOPIFY_APP_HANDLE` | Optional: app handle, for the Shopify-hosted plan page. |
| `SHOPIFY_PARTNER_ORG_ID`, `SHOPIFY_PARTNER_API_ACCESS_TOKEN`, `SHOPIFY_APP_GID` | Optional: needed to read merchants' paid plans (App Pricing). |

Never commit these values; `.env` stays local.

## 4. Point the Shopify app at Vercel

`shopify app dev` rewrites the URLs in `shopify.app.toml` to its tunnel, so
keep a separate production config:

```
shopify app config link        # choose this app, name the file e.g. "production"
```

In the new `shopify.app.production.toml` set:

```toml
application_url = "https://<your-vercel-domain>"

[auth]
redirect_urls = [ "https://<your-vercel-domain>/auth/callback" ]

[build]
automatically_update_urls_on_dev = false
```

Copy `[access_scopes]`, `[webhooks]` and `[discount.metafields…]` from
`shopify.app.toml`. Then release the configuration and extensions (the
discount Function and the theme block):

```
shopify app deploy --config production
```

`shopify app deploy` creates a new app version that goes live for every
store with the app installed, so run it only when you mean to release.

## 5. Deploy and check

1. Deploy in Vercel (production).
2. Open the app from the Shopify admin. It should load without the tunnel.
3. Vercel → Project → Settings → **Cron Jobs**: `/jobs/renewals` hourly. Use
   **Run** to trigger it once; the function log shows "Renewal job finished".
4. Settings → Webhooks are delivered to `https://<domain>/webhooks/...`
   (relative URIs in the TOML resolve against `application_url`).

## Notes

- Cron jobs run only on the production deployment, and delivery can repeat;
  the job never charges a billing cycle twice.
- `npm run build && npm start` still works for non-Vercel hosting (the
  preset is only applied on Vercel).

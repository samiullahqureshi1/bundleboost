import "@shopify/shopify-app-react-router/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";
import { env } from "./.server/env";
import { onShopAuthenticated } from "./.server/services/shop.service";

const config = env();

const shopify = shopifyApp({
  apiKey: config.SHOPIFY_API_KEY,
  apiSecretKey: config.SHOPIFY_API_SECRET,
  apiVersion: ApiVersion.July26,
  scopes: config.SCOPES?.split(","),
  appUrl: config.SHOPIFY_APP_URL,
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(prisma),
  distribution: AppDistribution.AppStore,
  future: {
    expiringOfflineAccessTokens: true,
  },
  hooks: {
    // Runs after OAuth / token exchange for both new installs and reinstalls.
    afterAuth: async ({ session, admin }) => {
      await onShopAuthenticated(session.shop, admin);
    },
  },
  ...(config.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [config.SHOP_CUSTOM_DOMAIN] }
    : {}),
});

export default shopify;
export const apiVersion = ApiVersion.July26;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;

import { useEffect } from "react";
import {
  useFetcher,
  useLoaderData,
  type ActionFunctionArgs,
  type HeadersFunction,
  type LoaderFunctionArgs,
} from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { z } from "zod";
import { requireAdmin } from "../.server/context";
import { toActionFailure, ValidationError } from "../.server/errors";
import { readJsonBody } from "../.server/request";
import { getHomeData, updateSetupGuide } from "../.server/services/home.service";
import { OverviewView, type SetupChange } from "../components/home/OverviewView";
import { RouteError } from "../components/RouteError";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop } = await requireAdmin(request);
  const data = await getHomeData(shop);
  return { ...data, currencyCode: shop.currencyCode };
};

const setupChangeSchema = z.object({
  change: z.enum(["dismiss", "restore", "confirmTheme", "unconfirmTheme"]),
});

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop } = await requireAdmin(request);
  try {
    const parsed = setupChangeSchema.safeParse(await readJsonBody(request));
    if (!parsed.success) throw new ValidationError({ form: "Unknown action" });
    await updateSetupGuide(shop.id, parsed.data.change);
    return { ok: true as const, change: parsed.data.change };
  } catch (error) {
    return toActionFailure(error, { shop: shop.domain, route: "home" });
  }
};

const TOASTS: Record<SetupChange, string> = {
  dismiss: "Setup guide hidden. You can bring it back from the sidebar.",
  restore: "Setup guide restored",
  confirmTheme: "Great — your product page shows the offer",
  unconfirmTheme: "Step marked as not done",
};

type Result = { ok: true; change: SetupChange } | { ok: false; message: string };

export default function Overview() {
  const data = useLoaderData<typeof loader>();
  const fetcher = useFetcher<Result>();
  const shopify = useAppBridge();

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    const result = fetcher.data;
    shopify.toast.show(result.ok ? TOASTS[result.change] : result.message, {
      isError: !result.ok,
    });
  }, [fetcher.state, fetcher.data, shopify]);

  return (
    <OverviewView
      data={data}
      busy={fetcher.state !== "idle"}
      onSetupChange={(change) =>
        fetcher.submit({ change }, { method: "post", encType: "application/json" })
      }
      onPreviewAddToCart={() =>
        shopify.toast.show("This is a preview. Your product pages work just like this.")
      }
    />
  );
}

export const ErrorBoundary = RouteError;

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

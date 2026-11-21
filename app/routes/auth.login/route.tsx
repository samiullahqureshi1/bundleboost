import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { useState } from "react";
import {
  Form,
  useActionData,
  useLoaderData,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "react-router";
import { login } from "../../shopify.server";
import { loginErrorMessage } from "./error.server";
import { useFieldEvents, readValue } from "../../components/use-field-events";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const errors = loginErrorMessage(await login(request));

  return { errors };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const errors = loginErrorMessage(await login(request));

  return {
    errors,
  };
};

export default function Auth() {
  const loaderData = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const [shop, setShop] = useState("");
  const { errors } = actionData || loaderData;
  const ref = useFieldEvents<HTMLElementTagNameMap["s-text-field"]>((el) => setShop(readValue(el)));

  return (
    <AppProvider embedded={false}>
      <s-page>
        <Form method="post">
          <s-section heading="Log in to BundleBoost">
            <s-text-field
              ref={ref}
              name="shop"
              label="Shop domain"
              details="example.myshopify.com"
              value={shop}
              autocomplete="on"
              error={errors.shop}
            ></s-text-field>
            <s-button type="submit">Log in</s-button>
          </s-section>
        </Form>
      </s-page>
    </AppProvider>
  );
}

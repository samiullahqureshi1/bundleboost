import type { ActionFunctionArgs } from "react-router";
import db from "../db.server";
import { handleWebhook } from "../.server/webhooks";

export const action = async ({ request }: ActionFunctionArgs) =>
  handleWebhook(request, async ({ payload, session }) => {
    const current = payload.current as string[] | undefined;
    if (session && Array.isArray(current)) {
      await db.session.update({
        where: { id: session.id },
        data: { scope: current.toString() },
      });
    }
  });

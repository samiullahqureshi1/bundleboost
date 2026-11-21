import type { Prisma } from "@prisma/client";
import prisma from "../../db.server";

export type AuditEntry = {
  shopId: string;
  actorId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Prisma.InputJsonValue;
};

/** Records a merchant-visible audit entry, inside a transaction when given. */
export async function recordAudit(
  entry: AuditEntry,
  tx: Prisma.TransactionClient = prisma,
) {
  await tx.auditLog.create({
    data: {
      shopId: entry.shopId,
      actorId: entry.actorId ?? null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      metadata: entry.metadata,
    },
  });
}

export async function listRecentAudit(shopId: string, take = 10) {
  return prisma.auditLog.findMany({
    where: { shopId },
    orderBy: { createdAt: "desc" },
    take,
  });
}

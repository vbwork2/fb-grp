import { and, eq, inArray } from "drizzle-orm";
import type { db } from "@/lib/db";
import { campaigns, queueItems } from "@/lib/db/schema";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function completeCampaignIfFinished(tx: Transaction, campaignId: string, workspaceId: string, now: Date) {
  // Serialize completion checks across devices processing different jobs.
  const [campaign] = await tx.select({ id: campaigns.id, status: campaigns.status }).from(campaigns)
    .where(and(eq(campaigns.id, campaignId), eq(campaigns.workspaceId, workspaceId))).limit(1).for("update");
  if (!campaign || campaign.status !== "RUNNING") return;
  const unfinished = await tx.select({ id: queueItems.id }).from(queueItems)
    .where(and(eq(queueItems.campaignId, campaignId), eq(queueItems.workspaceId, workspaceId), inArray(queueItems.status, ["PENDING", "READY", "OPENED", "AWAITING_CONFIRMATION", "FAILED"]))).limit(1);
  if (unfinished.length === 0) await tx.update(campaigns).set({ status: "COMPLETED", completedAt: now, updatedAt: now }).where(eq(campaigns.id, campaignId));
}

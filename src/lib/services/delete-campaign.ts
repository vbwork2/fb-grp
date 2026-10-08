import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { auditLogs, campaigns, queueItems } from "@/lib/db/schema";

export async function deleteCampaign(id: string, identity: { userId: string; workspaceId: string }) {
  return db.transaction(async (tx) => {
    const [campaign] = await tx.select().from(campaigns)
      .where(and(eq(campaigns.id, id), eq(campaigns.workspaceId, identity.workspaceId))).limit(1).for("update");
    if (!campaign) return { error: "missing" as const };
    if (campaign.status === "RUNNING") return { error: "running" as const };
    // Never erase the evidence needed to resolve a potentially submitted post.
    const [active] = await tx.select({ id: queueItems.id }).from(queueItems)
      .where(and(eq(queueItems.campaignId, id), eq(queueItems.workspaceId, identity.workspaceId), inArray(queueItems.status, ["OPENED", "AWAITING_CONFIRMATION"]))).limit(1);
    if (active) return { error: "claimed" as const };
    // Existing foreign keys remove campaign selections, queue and history only.
    await tx.delete(campaigns).where(and(eq(campaigns.id, id), eq(campaigns.workspaceId, identity.workspaceId)));
    await tx.insert(auditLogs).values({ userId: identity.userId, workspaceId: identity.workspaceId, action: "CAMPAIGN_DELETED", resourceType: "campaign", resourceId: id });
    return { error: null };
  });
}

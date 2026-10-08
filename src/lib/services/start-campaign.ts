import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { auditLogs, campaigns, campaignGroups, contentVariants, queueItems } from "@/lib/db/schema";
import { buildQueuePlan } from "@/lib/services/queue-plan";


export async function startCampaign(id: string, identity: { workspaceId: string; userId: string }) {
    return db.transaction(async (tx) => {
      const [campaign] = await tx.select().from(campaigns).where(and(eq(campaigns.id, id), eq(campaigns.workspaceId, identity.workspaceId))).limit(1).for("update");
      if (!campaign) return "missing" as const;
      if (campaign.status !== "READY") return "invalid" as const;
      const selected = await tx.select({ groupId: campaignGroups.groupId, position: campaignGroups.position }).from(campaignGroups).where(eq(campaignGroups.campaignId, id)).orderBy(asc(campaignGroups.position));
      const variants = campaign.variantStrategy === "ROUND_ROBIN" ? await tx.select({ id: contentVariants.id }).from(contentVariants).where(eq(contentVariants.contentId, campaign.contentId)).orderBy(asc(contentVariants.createdAt)) : [];
      let rows;
      try {
        rows = buildQueuePlan({ workspaceId: identity.workspaceId, campaignId: id, groups: selected, scheduledStartAt: campaign.scheduledStartAt, minIntervalSeconds: campaign.minIntervalSeconds, maxIntervalSeconds: campaign.maxIntervalSeconds, strategy: campaign.variantStrategy, variantIds: variants.map((variant) => variant.id) });
      } catch (error) {
        if (error instanceof Error && error.message.includes("variant")) return "missing_variants" as const;
        return "invalid_interval" as const;
      }
      await tx.delete(queueItems).where(and(eq(queueItems.campaignId, id), sql`${queueItems.status} in ('PENDING', 'READY')`));
      await tx.insert(queueItems).values(rows);
      await tx.update(campaigns).set({ status: "RUNNING", startedAt: campaign.startedAt ?? new Date(), updatedAt: new Date() }).where(eq(campaigns.id, id));
      await tx.insert(auditLogs).values({ userId: identity.userId, workspaceId: identity.workspaceId, action: "CAMPAIGN_STARTED", resourceType: "campaign", resourceId: campaign.id });
      return rows.length;
    });
}

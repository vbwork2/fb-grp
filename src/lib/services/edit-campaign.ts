import { randomUUID } from "node:crypto";
import { getMedia, putMedia, deleteMedia } from "@/lib/storage";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { auditLogs, campaigns, campaignGroups, contents, contentVariants, groups, media, queueItems } from "@/lib/db/schema";
import { buildQueuePlan } from "@/lib/services/queue-plan";

export type CampaignEdit = {
  name: string;
  contentId?: string;
  contentDraft?: { name: string; body: string; linkUrl?: string };
  groupIds: string[];
  minIntervalSeconds: number;
  maxIntervalSeconds: number;
};

export async function editCampaign(id: string, identity: { workspaceId: string; userId: string }, input: CampaignEdit) {
  const copiedKeys: string[] = [];
  try { return await db.transaction(async (tx) => {
    const [campaign] = await tx.select().from(campaigns).where(and(eq(campaigns.id, id), eq(campaigns.workspaceId, identity.workspaceId))).limit(1).for("update");
    if (!campaign) return { error: "missing" as const };
    if (!["READY", "PAUSED"].includes(campaign.status)) return { error: "state" as const };
    const jobs = await tx.select().from(queueItems).where(eq(queueItems.campaignId, id)).for("update");
    if (jobs.some((job) => ["OPENED", "AWAITING_CONFIRMATION"].includes(job.status))) return { error: "claimed" as const };
    const groupIds = [...new Set(input.groupIds)];
    const selected = await tx.select().from(groups).where(and(eq(groups.workspaceId, identity.workspaceId), inArray(groups.id, groupIds)));
    const currentGroups = await tx.select().from(campaignGroups).where(eq(campaignGroups.campaignId, id));
    const existingIds = new Set(currentGroups.map((group) => group.groupId));
    if (selected.length !== groupIds.length || selected.some((group) => group.status !== "ACTIVE" && !existingIds.has(group.id))) return { error: "resources" as const };
    const sourceId = input.contentId;
    const [source] = sourceId ? await tx.select().from(contents).where(and(eq(contents.id, sourceId), eq(contents.workspaceId, identity.workspaceId))).limit(1) : [];
    if (sourceId && !source) return { error: "resources" as const };
    if (!source && !input.contentDraft) return { error: "resources" as const };
    let contentId = source?.id;
    if (input.contentDraft) {
      const [created] = await tx.insert(contents).values({
        workspaceId: identity.workspaceId, createdBy: identity.userId,
        ...input.contentDraft, linkUrl: input.contentDraft.linkUrl || null,
      }).returning();
      contentId = created.id;
      // A private caption copy retains the source images without changing other campaigns.
      if (source) {
        const images = await tx.select().from(media).where(and(eq(media.contentId, source.id), eq(media.workspaceId, identity.workspaceId)));
        for (const image of images) {
          const bytes = await getMedia(image.storageKey);
          if (!bytes) throw new Error("Unable to copy this content's images.");
          const key = randomUUID();
          copiedKeys.push(key);
          await putMedia(key, bytes, { mimeType: image.mimeType });
          await tx.insert(media).values({
            workspaceId: identity.workspaceId, contentId: created.id, storageKey: key,
            mimeType: image.mimeType, originalFilename: image.originalFilename, sizeBytes: image.sizeBytes,
          });
        }

      }
    }
    const strategy = contentId === campaign.contentId ? campaign.variantStrategy : "PRIMARY_ONLY";
    const variants = strategy === "ROUND_ROBIN" ? await tx.select().from(contentVariants).where(eq(contentVariants.contentId, contentId!)).orderBy(asc(contentVariants.createdAt)) : [];
    if (strategy === "ROUND_ROBIN" && !variants.length) return { error: "variants" as const };
    const now = new Date();
    let nextStatus: "READY" | "PAUSED" | "COMPLETED" = campaign.status === "READY" ? "READY" : "PAUSED";
    await tx.delete(campaignGroups).where(eq(campaignGroups.campaignId, id));
    await tx.insert(campaignGroups).values(groupIds.map((groupId, position) => ({ campaignId: id, groupId, position })));
    // Keep terminal jobs and their history. Rebuild only jobs that have never been claimed.
    const finishedIds = new Set(jobs.filter((job) => !["PENDING", "READY"].includes(job.status)).map((job) => job.groupId));
    if (campaign.status === "PAUSED") {
      for (const job of jobs.filter((item) => item.status === "FAILED")) {
        if (!groupIds.includes(job.groupId)) {
          await tx.update(queueItems).set({ status: "SKIPPED", errorCode: null, errorMessage: null, completedAt: now, updatedAt: now }).where(eq(queueItems.id, job.id));
        } else if (contentId !== campaign.contentId) {
          await tx.update(queueItems).set({ variantId: null, updatedAt: now }).where(eq(queueItems.id, job.id));
        }
      }
      const remaining = groupIds.map((groupId, position) => ({ groupId, position })).filter((group) => !finishedIds.has(group.groupId));
      const plan = buildQueuePlan({
        workspaceId: identity.workspaceId, campaignId: id, groups: remaining,
        scheduledStartAt: campaign.scheduledStartAt, minIntervalSeconds: input.minIntervalSeconds,
        maxIntervalSeconds: input.maxIntervalSeconds, strategy, variantIds: variants.map((variant) => variant.id), now,
      });
      await tx.delete(queueItems).where(and(eq(queueItems.campaignId, id), inArray(queueItems.status, ["PENDING", "READY"])));
      if (plan.length) await tx.insert(queueItems).values(plan);
      if (!plan.length && !jobs.some((job) => job.status === "FAILED" && groupIds.includes(job.groupId))) nextStatus = "COMPLETED";
    }
    await tx.update(campaigns).set({
      name: input.name, contentId: contentId!, variantStrategy: strategy, status: nextStatus,
      ...(nextStatus === "COMPLETED" ? { completedAt: now } : {}),
      minIntervalSeconds: input.minIntervalSeconds, maxIntervalSeconds: input.maxIntervalSeconds, updatedAt: now,
    }).where(eq(campaigns.id, id));
    await tx.insert(auditLogs).values({
      userId: identity.userId, workspaceId: identity.workspaceId, action: "CAMPAIGN_EDITED",
      resourceType: "campaign", resourceId: id, metadataJson: { groupIds, contentId },
    });
    return { error: null, id, status: nextStatus };
  }); } catch (cause) {
    await Promise.all(copiedKeys.map((key) => deleteMedia(key).catch(() => undefined)));
    throw cause;
  }
}
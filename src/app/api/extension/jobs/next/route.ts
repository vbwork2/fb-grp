import { z } from "zod";
import { and, asc, count, eq, inArray, isNull, lte, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { campaigns, contents, groups, queueItems, contentVariants, media } from "@/lib/db/schema";
import { getDevice } from "@/lib/auth/device";
import { jsonError, jsonSuccess } from "@/lib/security/http";
import { config } from "@/lib/config";
import { assertQueueTransition } from "@/lib/services/queue-state-machine";

export async function GET(request: Request) {
  const device = await getDevice(request);
  if (!device) return jsonError("DEVICE_UNAUTHORIZED", "Device token is invalid, expired, or revoked.", 401);
  const campaignId = new URL(request.url).searchParams.get("campaignId");
  if (campaignId && !z.string().uuid().safeParse(campaignId).success) return jsonError("INVALID_INPUT", "Choose a campaign before starting automatic posting.");
  const now = new Date();
  const payload = await db.transaction(async (tx) => {
    await tx.update(queueItems).set({ status: "READY", claimToken: null, claimedAt: null, startedAt: null, updatedAt: now })
      .where(and(eq(queueItems.workspaceId, device.workspaceId), eq(queueItems.status, "OPENED"), lte(queueItems.claimedAt!, new Date(now.getTime() - config.queueClaimTtlMinutes * 60 * 1000))));
    const [job] = await tx.select({ item: queueItems, group: groups, campaign: campaigns, content: contents, variant: contentVariants }).from(queueItems)
      .innerJoin(groups, eq(queueItems.groupId, groups.id)).innerJoin(campaigns, eq(queueItems.campaignId, campaigns.id)).innerJoin(contents, eq(campaigns.contentId, contents.id))
      .leftJoin(contentVariants, eq(queueItems.variantId, contentVariants.id))
      .where(and(eq(queueItems.workspaceId, device.workspaceId), campaignId ? eq(queueItems.campaignId, campaignId) : undefined, inArray(queueItems.status, ["PENDING", "READY"]), lte(queueItems.scheduledAt, now), eq(campaigns.status, "RUNNING"), eq(groups.status, "ACTIVE"), or(isNull(queueItems.claimedAt), lte(queueItems.claimedAt, new Date(now.getTime() - config.queueClaimTtlMinutes * 60 * 1000)))))
      .orderBy(asc(queueItems.scheduledAt), asc(queueItems.position)).limit(1).for("update", { of: queueItems, skipLocked: true });
    if (!job) return null;
    if (job.item.status === "PENDING") assertQueueTransition("PENDING", "READY");
    assertQueueTransition("READY", "OPENED");
    const claimToken = crypto.randomUUID();
    const [claimed] = await tx.update(queueItems).set({ status: "OPENED", startedAt: job.item.startedAt ?? now, claimToken, claimedAt: now, attemptCount: job.item.attemptCount + 1, updatedAt: now }).where(and(eq(queueItems.id, job.item.id), eq(queueItems.workspaceId, device.workspaceId))).returning();
    if (!claimed) return null;
    const files = await tx.select().from(media).where(and(eq(media.contentId, job.content.id), eq(media.workspaceId, device.workspaceId)));
    return { id: claimed.id, campaignId: job.campaign.id, campaign: job.campaign.name, group: { id: job.group.id, name: job.group.name, url: job.group.facebookUrl }, content: { name: job.content.name, caption: job.variant?.body ?? job.content.body, linkUrl: job.content.linkUrl, media: files.map((file) => ({ id: file.id, mimeType: file.mimeType, filename: file.originalFilename })) }, claimToken };
  });
  if (!payload && campaignId) {
    const [campaign] = await db.select({ status: campaigns.status }).from(campaigns).where(and(eq(campaigns.id, campaignId), eq(campaigns.workspaceId, device.workspaceId))).limit(1);
    if (!campaign) return jsonError("RESOURCE_NOT_FOUND", "Campaign not found.", 404);
    const [remaining] = await db.select({ count: count() }).from(queueItems).where(and(eq(queueItems.workspaceId, device.workspaceId), eq(queueItems.campaignId, campaignId), inArray(queueItems.status, ["PENDING", "READY"])));
    return jsonSuccess({ job: null, campaignStatus: campaign.status, remaining: remaining?.count ?? 0 });
  }
  return jsonSuccess({ job: payload });
}


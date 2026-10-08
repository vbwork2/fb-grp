import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { auditLogs, groups, postHistory, queueItems } from "@/lib/db/schema";
import { completeCampaignIfFinished } from "@/lib/services/complete-campaign";
import { getDevice } from "@/lib/auth/device";
import { assertQueueTransition } from "@/lib/services/queue-state-machine";
import { jsonError, jsonSuccess } from "@/lib/security/http";
import { isFacebookPostUrl } from "@/lib/validators/urls";

const input = z.object({ claimToken: z.string().uuid(), facebookPostUrl: z.string().url().refine(isFacebookPostUrl).optional(), notes: z.string().max(2000).optional(), confirmationSource: z.enum(["user_confirmed", "ui_confirmed"]).default("user_confirmed") });

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const device = await getDevice(request);
  if (!device) return jsonError("DEVICE_UNAUTHORIZED", "Device token is invalid, expired, or revoked.", 401);
  const { id } = await context.params;
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success || !z.string().uuid().safeParse(id).success) return jsonError("INVALID_INPUT", "Invalid completion details.");
  const result = await db.transaction(async (tx) => {
    const [job] = await tx.select().from(queueItems).where(and(eq(queueItems.id, id), eq(queueItems.workspaceId, device.workspaceId), eq(queueItems.claimToken, parsed.data.claimToken))).limit(1).for("update");
    if (!job || !["OPENED", "AWAITING_CONFIRMATION"].includes(job.status)) return null;
    if (job.status === "OPENED") assertQueueTransition(job.status, "AWAITING_CONFIRMATION");
    assertQueueTransition("AWAITING_CONFIRMATION", "POSTED");
    const now = new Date();
    await tx.update(queueItems).set({ status: "POSTED", completedAt: now, updatedAt: now, claimToken: null, claimedAt: null }).where(eq(queueItems.id, job.id));
    await tx.insert(postHistory).values({ workspaceId: job.workspaceId, campaignId: job.campaignId, groupId: job.groupId, queueItemId: job.id, status: "POSTED", facebookPostUrl: parsed.data.facebookPostUrl, notes: parsed.data.notes, postedAt: now });
    await tx.update(groups).set({ lastPostedAt: now, updatedAt: now }).where(and(eq(groups.id, job.groupId), eq(groups.workspaceId, device.workspaceId)));
    await tx.insert(auditLogs).values({ userId: device.userId, workspaceId: device.workspaceId, action: "QUEUE_ITEM_POSTED", resourceType: "queue_item", resourceId: job.id, metadataJson: { confirmationSource: parsed.data.confirmationSource } });
    await completeCampaignIfFinished(tx, job.campaignId, device.workspaceId, now);
    return { status: "POSTED" };
  });
  return result ? jsonSuccess(result) : jsonError("RESOURCE_NOT_FOUND", "Job is no longer available or has already been processed.", 404);
}


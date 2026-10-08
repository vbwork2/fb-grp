import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { auditLogs, campaigns, queueItems } from "@/lib/db/schema";
import { getDevice } from "@/lib/auth/device";
import { jsonError, jsonSuccess } from "@/lib/security/http";

// Only FAILED jobs can be reset. AWAITING_CONFIRMATION is deliberately
// excluded because a Facebook post may have been sent despite missing UI
// confirmation; resetting it could publish a duplicate.
export async function POST(request: Request) {
  const device = await getDevice(request);
  if (!device) return jsonError("DEVICE_UNAUTHORIZED", "Device token is invalid, expired, or revoked.", 401);
  const parsed = z.object({ campaignId: z.string().uuid(), jobId: z.string().uuid().optional() }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("INVALID_INPUT", "Choose a campaign or failed group.");
  const reset = await db.transaction(async (tx) => {
    const [campaign] = await tx.select().from(campaigns)
      .where(and(eq(campaigns.id, parsed.data.campaignId), eq(campaigns.workspaceId, device.workspaceId)))
      .limit(1).for("update");
    if (!campaign) return null;
    if (!["RUNNING", "PAUSED"].includes(campaign.status)) return -1;
    const now = new Date();
    const items = await tx.update(queueItems).set({
      status: "READY", scheduledAt: now, claimToken: null, claimedAt: null,
      completedAt: null, startedAt: null, errorCode: null, errorMessage: null, updatedAt: now,
    }).where(and(eq(queueItems.campaignId, campaign.id), eq(queueItems.workspaceId, device.workspaceId),
      eq(queueItems.status, "FAILED"),
      parsed.data.jobId ? eq(queueItems.id, parsed.data.jobId) : undefined)).returning({ id: queueItems.id });
    if (items.length) {
      await tx.update(campaigns).set({ status: "RUNNING", updatedAt: now }).where(eq(campaigns.id, campaign.id));
      await tx.insert(auditLogs).values({
        userId: device.userId, workspaceId: device.workspaceId,
        action: "CAMPAIGN_RETRIED", resourceType: "campaign", resourceId: campaign.id,
        metadataJson: { failedJobsReset: items.length },
      });
    }
    return items.length;
  });
  if (reset === null) return jsonError("RESOURCE_NOT_FOUND", "Campaign not found.", 404);
  if (reset === -1) return jsonError("INVALID_STATE", "Cancelled or completed campaigns cannot reset failed jobs.", 409);
  return jsonSuccess({ reset });
}

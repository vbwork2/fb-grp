import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { auditLogs, campaigns } from "@/lib/db/schema";
import { getDevice } from "@/lib/auth/device";
import { jsonError, jsonSuccess } from "@/lib/security/http";

// Cancel a campaign in the authenticated device's workspace. No pending jobs
// can be claimed afterwards; already submitted Facebook posts cannot be undone.
export async function POST(request: Request) {
  const device = await getDevice(request);
  if (!device) return jsonError("DEVICE_UNAUTHORIZED", "Device token is invalid, expired, or revoked.", 401);
  const parsed = z.object({ campaignId: z.string().uuid() }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("INVALID_INPUT", "Choose a valid campaign.");
  const updated = await db.transaction(async (tx) => {
    const [campaign] = await tx.select().from(campaigns)
      .where(and(eq(campaigns.id, parsed.data.campaignId), eq(campaigns.workspaceId, device.workspaceId),
        inArray(campaigns.status, ["READY", "RUNNING", "PAUSED"]))).limit(1).for("update");
    if (!campaign) return false;
    await tx.update(campaigns).set({ status: "CANCELLED", updatedAt: new Date() }).where(eq(campaigns.id, campaign.id));
    await tx.insert(auditLogs).values({
      userId: device.userId, workspaceId: device.workspaceId,
      action: "CAMPAIGN_CANCELLED", resourceType: "campaign", resourceId: campaign.id,
    });
    return true;
  });
  return updated ? jsonSuccess({ status: "CANCELLED" }) : jsonError("INVALID_STATE", "Campaign was already cancelled or completed.", 409);
}

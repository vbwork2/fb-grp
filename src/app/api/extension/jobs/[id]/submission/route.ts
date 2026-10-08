import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { auditLogs, campaigns, groups, queueItems } from "@/lib/db/schema";
import { getDevice } from "@/lib/auth/device";
import { config } from "@/lib/config";
import { jsonError, jsonSuccess } from "@/lib/security/http";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const device = await getDevice(request);
  if (!device) return jsonError("DEVICE_UNAUTHORIZED", "Device token is invalid, expired, or revoked.", 401);
  const { id } = await context.params;
  const parsed = z.object({ claimToken: z.string().uuid(), action: z.enum(["begin", "release", "clicked"]), automatic: z.boolean().default(false), clickSource: z.enum(["user", "automatic"]).default("user") }).safeParse(await request.json().catch(() => null));
  if (!parsed.success || !z.string().uuid().safeParse(id).success) return jsonError("INVALID_INPUT", "Invalid completion details.");
  const result = await db.transaction(async (tx) => {
    const [row] = await tx.select({ job: queueItems, campaignStatus: campaigns.status, groupStatus: groups.status }).from(queueItems)
      .innerJoin(campaigns, eq(campaigns.id, queueItems.campaignId)).innerJoin(groups, eq(groups.id, queueItems.groupId))
      .where(and(eq(queueItems.id, id), eq(queueItems.workspaceId, device.workspaceId), eq(queueItems.claimToken, parsed.data.claimToken)))
      .limit(1).for("update", { of: queueItems });
    if (!row) return false;
    const { job } = row;
    if (parsed.data.action === "begin") {
      if (job.status !== "OPENED" || !job.claimedAt || job.claimedAt.getTime() <= Date.now() - config.queueClaimTtlMinutes * 60_000 || row.campaignStatus !== "RUNNING" || row.groupStatus !== "ACTIVE") return false;
      // Reserve before clicking so an uncertain attempt cannot be claimed again.
      await tx.update(queueItems).set({ status: "AWAITING_CONFIRMATION", updatedAt: new Date() }).where(eq(queueItems.id, id));
    } else {
      if (job.status !== "AWAITING_CONFIRMATION") return false;
      const [clicked] = await tx.select({ id: auditLogs.id }).from(auditLogs).where(and(eq(auditLogs.workspaceId, device.workspaceId), eq(auditLogs.resourceId, job.id), eq(auditLogs.action, "QUEUE_ITEM_USER_CLICKED"))).limit(1);
      if (parsed.data.action === "clicked") {
        if (!clicked) await tx.insert(auditLogs).values({ userId: device.userId, workspaceId: device.workspaceId, action: "QUEUE_ITEM_USER_CLICKED", resourceType: "queue_item", resourceId: job.id, metadataJson: { clickSource: parsed.data.clickSource ?? "user" } });
        return true;
      }
      if (clicked) return false;
      // Release only after an explicit adapter response stating that no click occurred.
      await tx.update(queueItems).set({ status: "OPENED", updatedAt: new Date() }).where(eq(queueItems.id, id));
    }
    return true;
  });
  return result ? jsonSuccess({ allowed: true }) : jsonError("INVALID_STATE", "This job is expired, paused, cancelled, or already processed. Refresh the queue before publishing.", 409);
}

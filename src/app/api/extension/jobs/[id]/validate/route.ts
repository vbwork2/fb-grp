import { and, eq, gt } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { campaigns, groups, queueItems } from "@/lib/db/schema";
import { getDevice } from "@/lib/auth/device";
import { config } from "@/lib/config";
import { jsonError, jsonSuccess } from "@/lib/security/http";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const device = await getDevice(request);
  if (!device) return jsonError("DEVICE_UNAUTHORIZED", "Device token is invalid, expired, or revoked.", 401);
  const { id } = await context.params;
  const parsed = z.object({ claimToken: z.string().uuid() }).safeParse(await request.json().catch(() => null));
  if (!parsed.success || !z.string().uuid().safeParse(id).success) return jsonError("INVALID_INPUT", "Invalid completion details.");
  const [job] = await db.select({ id: queueItems.id }).from(queueItems)
    .innerJoin(campaigns, eq(campaigns.id, queueItems.campaignId))
    .innerJoin(groups, eq(groups.id, queueItems.groupId))
    .where(and(eq(queueItems.id, id), eq(queueItems.workspaceId, device.workspaceId), eq(queueItems.claimToken, parsed.data.claimToken), eq(queueItems.status, "OPENED"), gt(queueItems.claimedAt, new Date(Date.now() - config.queueClaimTtlMinutes * 60_000)), eq(campaigns.status, "RUNNING"), eq(groups.status, "ACTIVE"))).limit(1);
  return job ? jsonSuccess({ allowed: true }) : jsonError("RESOURCE_NOT_FOUND", "This job is expired, paused, cancelled, or already processed. Refresh the queue before publishing.", 409);
}

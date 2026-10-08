import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { auditLogs, postHistory, queueItems } from "@/lib/db/schema";
import { getDevice } from "@/lib/auth/device";
import { assertQueueTransition } from "@/lib/services/queue-state-machine";
import { jsonError, jsonSuccess } from "@/lib/security/http";

const input = z.object({ claimToken: z.string().uuid(), errorCode: z.string().max(80).default("USER_REPORTED"), errorMessage: z.string().trim().min(1).max(2000) });

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const device = await getDevice(request);
  if (!device) return jsonError("DEVICE_UNAUTHORIZED", "Device token is invalid, expired, or revoked.", 401);
  const { id } = await context.params;
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success || !z.string().uuid().safeParse(id).success) return jsonError("INVALID_INPUT", "Describe why this job could not be continued.");
  const result = await db.transaction(async (tx) => {
    const [job] = await tx.select().from(queueItems).where(and(eq(queueItems.id, id), eq(queueItems.workspaceId, device.workspaceId), eq(queueItems.claimToken, parsed.data.claimToken))).limit(1).for("update");
    if (!job || job.status !== "OPENED") return null;
    assertQueueTransition(job.status, "FAILED");
    const now = new Date();
    await tx.update(queueItems).set({ status: "FAILED", errorCode: parsed.data.errorCode, errorMessage: parsed.data.errorMessage, completedAt: now, updatedAt: now, claimToken: null, claimedAt: null }).where(eq(queueItems.id, job.id));
    await tx.insert(postHistory).values({ workspaceId: job.workspaceId, campaignId: job.campaignId, groupId: job.groupId, queueItemId: job.id, status: "FAILED", notes: parsed.data.errorMessage });
    await tx.insert(auditLogs).values({ userId: device.userId, workspaceId: device.workspaceId, action: "QUEUE_ITEM_FAILED", resourceType: "queue_item", resourceId: job.id });
    return { status: "FAILED" };
  });
  return result ? jsonSuccess(result) : jsonError("RESOURCE_NOT_FOUND", "Job is no longer available or has already been processed.", 404);
}


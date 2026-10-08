import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { auditLogs, campaigns, queueItems } from "@/lib/db/schema";
import { getIdentity } from "@/lib/auth/session";
import { jsonError, jsonSuccess, verifySameOrigin } from "@/lib/security/http";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!verifySameOrigin(request)) return jsonError("INVALID_ORIGIN", "Request origin is not allowed.", 403);
  const identity = await getIdentity();
  if (!identity) return jsonError("UNAUTHORIZED", "Sign in to continue.", 401);
  const { id } = await context.params;
  const result = await db.transaction(async (tx) => {
    const [campaign] = await tx.select().from(campaigns).where(and(eq(campaigns.id, id), eq(campaigns.workspaceId, identity.workspaceId))).limit(1).for("update");
    if (!campaign) return null;
    const retried = await tx.update(queueItems).set({ status: "READY", scheduledAt: new Date(), claimToken: null, claimedAt: null, errorCode: null, errorMessage: null, updatedAt: new Date() }).where(and(eq(queueItems.campaignId, campaign.id), eq(queueItems.workspaceId, identity.workspaceId), eq(queueItems.status, "FAILED"))).returning({ id: queueItems.id });
    if (retried.length) {
      await tx.update(campaigns).set({ status: "RUNNING", startedAt: campaign.startedAt ?? new Date(), updatedAt: new Date() }).where(eq(campaigns.id, campaign.id));
      await tx.insert(auditLogs).values({ userId: identity.userId, workspaceId: identity.workspaceId, action: "CAMPAIGN_RETRIED", resourceType: "campaign", resourceId: campaign.id, metadataJson: { count: retried.length } });
    }
    return retried.length;
  });
  return result === null ? jsonError("RESOURCE_NOT_FOUND", "Campaign not found.", 404) : jsonSuccess({ retried: result });
}

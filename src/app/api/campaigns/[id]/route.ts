import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { auditLogs, campaigns } from "@/lib/db/schema";
import { getIdentity } from "@/lib/auth/session";
import { jsonError, jsonSuccess, verifySameOrigin } from "@/lib/security/http";

const input = z.object({ status: z.enum(["PAUSED", "RUNNING", "CANCELLED"]) });

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!verifySameOrigin(request)) return jsonError("INVALID_ORIGIN", "Request origin is not allowed.", 403);
  const identity = await getIdentity();
  if (!identity) return jsonError("UNAUTHORIZED", "Sign in to continue.", 401);
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("INVALID_INPUT", "Invalid campaign action.");
  const { id } = await context.params;
  const result = await db.transaction(async (tx) => {
    const [campaign] = await tx.select().from(campaigns).where(and(eq(campaigns.id, id), eq(campaigns.workspaceId, identity.workspaceId))).limit(1).for("update");
    if (!campaign) return { error: "missing" as const };
    const valid = parsed.data.status === "PAUSED" ? campaign.status === "RUNNING" : parsed.data.status === "RUNNING" ? campaign.status === "PAUSED" : ["READY", "RUNNING", "PAUSED"].includes(campaign.status);
    if (!valid) return { error: "invalid" as const };
    await tx.update(campaigns).set({ status: parsed.data.status, updatedAt: new Date() }).where(eq(campaigns.id, campaign.id));
    const action = parsed.data.status === "PAUSED" ? "CAMPAIGN_PAUSED" : parsed.data.status === "CANCELLED" ? "CAMPAIGN_CANCELLED" : "CAMPAIGN_RESUMED";
    await tx.insert(auditLogs).values({ userId: identity.userId, workspaceId: identity.workspaceId, action, resourceType: "campaign", resourceId: campaign.id });
    return { error: null };
  });
  if (result.error === "missing") return jsonError("RESOURCE_NOT_FOUND", "Campaign not found.", 404);
  if (result.error === "invalid") return jsonError("INVALID_STATE", "This campaign cannot use that action in its current state.", 409);
  return jsonSuccess({ id, status: parsed.data.status });
}

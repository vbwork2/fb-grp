import { editCampaign } from "@/lib/services/edit-campaign";
import { isHttpUrl } from "@/lib/validators/urls";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { auditLogs, campaigns } from "@/lib/db/schema";
import { getIdentity } from "@/lib/auth/session";
import { jsonError, jsonSuccess, verifySameOrigin } from "@/lib/security/http";

const statusInput = z.object({ status: z.enum(["PAUSED", "RUNNING", "CANCELLED"]) }).strict();
const editInput = z.object({
  name: z.string().trim().min(1).max(160),
  contentId: z.string().uuid().optional(),
  contentDraft: z.object({
    name: z.string().trim().min(1).max(160),
    body: z.string().trim().min(1).max(10000),
    linkUrl: z.string().url().refine(isHttpUrl).optional().or(z.literal("")),
  }).optional(),
  groupIds: z.array(z.string().uuid()).min(1).max(1000),
  minIntervalSeconds: z.number().int().min(60).max(86400),
  maxIntervalSeconds: z.number().int().min(60).max(86400),
}).strict().refine((value) => value.minIntervalSeconds <= value.maxIntervalSeconds && Boolean(value.contentId || value.contentDraft));
const input = z.union([statusInput, editInput]);

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!verifySameOrigin(request)) return jsonError("INVALID_ORIGIN", "Request origin is not allowed.", 403);
  const identity = await getIdentity();
  if (!identity) return jsonError("UNAUTHORIZED", "Sign in to continue.", 401);
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("INVALID_INPUT", "Invalid campaign action.");
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) return jsonError("INVALID_INPUT", "Invalid campaign action.");
  if (!("status" in parsed.data)) {
    const edited = await editCampaign(id, identity, parsed.data).catch(() => null);
    if (!edited) return jsonError("UPDATE_FAILED", "Unable to save changes.", 500);
    if (edited.error === "missing") return jsonError("RESOURCE_NOT_FOUND", "Campaign not found.", 404);
    if (edited.error === "state") return jsonError("INVALID_STATE", "Pause the campaign before editing. Completed or cancelled campaigns cannot be edited.", 409);
    if (edited.error === "claimed") return jsonError("ACTIVE_JOB", "Resolve opened or unconfirmed posts before editing this campaign.", 409);
    if (edited.error === "resources") return jsonError("INVALID_RESOURCES", "Choose content and groups in your workspace.", 404);
    if (edited.error === "variants") return jsonError("INVALID_VARIANTS", "Add at least one content variant before starting a round-robin campaign.", 409);
    return jsonSuccess({ id: edited.id, status: edited.status });
  }
  const nextStatus = parsed.data.status;
  const result = await db.transaction(async (tx) => {
    const [campaign] = await tx.select().from(campaigns).where(and(eq(campaigns.id, id), eq(campaigns.workspaceId, identity.workspaceId))).limit(1).for("update");
    if (!campaign) return { error: "missing" as const };
    const valid = nextStatus === "PAUSED" ? campaign.status === "RUNNING" : nextStatus === "RUNNING" ? campaign.status === "PAUSED" : ["READY", "RUNNING", "PAUSED"].includes(campaign.status);
    if (!valid) return { error: "invalid" as const };
    await tx.update(campaigns).set({ status: nextStatus, updatedAt: new Date() }).where(eq(campaigns.id, campaign.id));
    const action = nextStatus === "PAUSED" ? "CAMPAIGN_PAUSED" : nextStatus === "CANCELLED" ? "CAMPAIGN_CANCELLED" : "CAMPAIGN_RESUMED";
    await tx.insert(auditLogs).values({ userId: identity.userId, workspaceId: identity.workspaceId, action, resourceType: "campaign", resourceId: campaign.id });
    return { error: null };
  });
  if (result.error === "missing") return jsonError("RESOURCE_NOT_FOUND", "Campaign not found.", 404);
  if (result.error === "invalid") return jsonError("INVALID_STATE", "This campaign cannot use that action in its current state.", 409);
  return jsonSuccess({ id, status: nextStatus });
}

import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { campaigns, campaignGroups, contents, groups } from "@/lib/db/schema";
import { getIdentity } from "@/lib/auth/session";
import { jsonError, jsonSuccess, verifySameOrigin } from "@/lib/security/http";

const input = z.object({ name: z.string().trim().min(1).max(160), contentId: z.string().uuid(), groupIds: z.array(z.string().uuid()).min(1).max(1000), variantStrategy: z.enum(["PRIMARY_ONLY", "ROUND_ROBIN"]).default("PRIMARY_ONLY"), minIntervalSeconds: z.number().int().min(60).max(86400).default(300), maxIntervalSeconds: z.number().int().min(60).max(86400).default(600), scheduledStartAt: z.string().datetime().optional() }).refine((x) => x.minIntervalSeconds <= x.maxIntervalSeconds);

export async function GET() {
  const identity = await getIdentity();
  if (!identity) return jsonError("UNAUTHORIZED", "Sign in to continue.", 401);
  const result = await db.select({ campaign: campaigns, contentName: contents.name }).from(campaigns).innerJoin(contents, eq(campaigns.contentId, contents.id)).where(eq(campaigns.workspaceId, identity.workspaceId)).orderBy(desc(campaigns.createdAt));
  return jsonSuccess(result);
}

export async function POST(request: Request) {
  if (!verifySameOrigin(request)) return jsonError("INVALID_ORIGIN", "Request origin is not allowed.", 403);
  const identity = await getIdentity();
  if (!identity) return jsonError("UNAUTHORIZED", "Sign in to continue.", 401);
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("INVALID_INPUT", "Check the campaign settings and selected groups.");
  const campaign = await db.transaction(async (tx) => {
    const [content] = await tx.select({ id: contents.id }).from(contents).where(and(eq(contents.id, parsed.data.contentId), eq(contents.workspaceId, identity.workspaceId))).limit(1);
    const ownedGroups = await tx.select({ id: groups.id }).from(groups).where(and(eq(groups.workspaceId, identity.workspaceId), eq(groups.status, "ACTIVE")));
    const allowedIds = new Set(ownedGroups.map((group) => group.id));
    if (!content || parsed.data.groupIds.some((id) => !allowedIds.has(id))) throw new Error("INVALID_RESOURCES");
    const [created] = await tx.insert(campaigns).values({ name: parsed.data.name, contentId: content.id, workspaceId: identity.workspaceId, createdBy: identity.userId, variantStrategy: parsed.data.variantStrategy, minIntervalSeconds: parsed.data.minIntervalSeconds, maxIntervalSeconds: parsed.data.maxIntervalSeconds, scheduledStartAt: parsed.data.scheduledStartAt ? new Date(parsed.data.scheduledStartAt) : null, status: "READY" }).returning();
    await tx.insert(campaignGroups).values(parsed.data.groupIds.map((groupId, position) => ({ campaignId: created.id, groupId, position })));
    return created;
  }).catch((error: unknown) => { if (error instanceof Error && error.message === "INVALID_RESOURCES") return null; throw error; });
  return campaign ? jsonSuccess(campaign, 201) : jsonError("INVALID_RESOURCES", "Choose content and groups in your workspace.", 404);
}

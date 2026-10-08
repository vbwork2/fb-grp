import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { databaseErrorCode } from "@/lib/db/errors";
import { groups } from "@/lib/db/schema";
import { getIdentity } from "@/lib/auth/session";
import { jsonError, jsonSuccess, verifySameOrigin } from "@/lib/security/http";
import { isFacebookGroupUrl, normalizeFacebookGroupUrl } from "@/lib/validators/facebook";

const input = z.object({ name: z.string().trim().min(1).max(160).optional(), facebookUrl: z.string().url().optional(), category: z.string().max(80).nullable().optional(), description: z.string().max(2000).nullable().optional(), notes: z.string().max(2000).nullable().optional(), status: z.enum(["ACTIVE", "PAUSED", "DISABLED"]).optional() }).refine((value) => !value.facebookUrl || isFacebookGroupUrl(value.facebookUrl)).transform((value) => ({ ...value, facebookUrl: value.facebookUrl ? normalizeFacebookGroupUrl(value.facebookUrl) : undefined }));

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!verifySameOrigin(request)) return jsonError("INVALID_ORIGIN", "Request origin is not allowed.", 403);
  const identity = await getIdentity();
  if (!identity) return jsonError("UNAUTHORIZED", "Sign in to continue.", 401);
  const { id } = await context.params;
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("INVALID_INPUT", "Invalid group changes.");
  try {
    const [updated] = await db.update(groups).set({ ...parsed.data, updatedAt: new Date() }).where(and(eq(groups.id, id), eq(groups.workspaceId, identity.workspaceId))).returning();
    return updated ? jsonSuccess(updated) : jsonError("RESOURCE_NOT_FOUND", "Group not found.", 404);
  } catch (error) {
    if (databaseErrorCode(error) === "23505") return jsonError("DUPLICATE_GROUP", "That Facebook Group URL is already saved.", 409);
    return jsonError("UPDATE_FAILED", "Unable to update this group.", 500);
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!verifySameOrigin(request)) return jsonError("INVALID_ORIGIN", "Request origin is not allowed.", 403);
  const identity = await getIdentity();
  if (!identity) return jsonError("UNAUTHORIZED", "Sign in to continue.", 401);
  const { id } = await context.params;
  const [deleted] = await db.delete(groups).where(and(eq(groups.id, id), eq(groups.workspaceId, identity.workspaceId))).returning({ id: groups.id });
  return deleted ? jsonSuccess({ id }) : jsonError("RESOURCE_NOT_FOUND", "Group not found.", 404);
}

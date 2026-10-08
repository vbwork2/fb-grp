import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { contents } from "@/lib/db/schema";
import { getIdentity } from "@/lib/auth/session";
import { jsonError, jsonSuccess, verifySameOrigin } from "@/lib/security/http";
import { z } from "zod";
import { isHttpUrl } from "@/lib/validators/urls";
import { databaseErrorCode } from "@/lib/db/errors";

const input = z.object({ name: z.string().trim().min(1).max(160), body: z.string().trim().min(1).max(10000), linkUrl: z.string().url().refine(isHttpUrl).optional().or(z.literal("")) });

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!verifySameOrigin(request)) return jsonError("INVALID_ORIGIN", "Request origin is not allowed.", 403);
  const identity = await getIdentity();
  if (!identity) return jsonError("UNAUTHORIZED", "Sign in to continue.", 401);
  const { id } = await context.params;
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("INVALID_INPUT", "Enter a content name and caption.");
  const [updated] = await db.update(contents).set({ ...parsed.data, linkUrl: parsed.data.linkUrl || null, updatedAt: new Date() }).where(and(eq(contents.id, id), eq(contents.workspaceId, identity.workspaceId))).returning();
  return updated ? jsonSuccess(updated) : jsonError("RESOURCE_NOT_FOUND", "Content not found.", 404);
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!verifySameOrigin(request)) return jsonError("INVALID_ORIGIN", "Request origin is not allowed.", 403);
  const identity = await getIdentity();
  if (!identity) return jsonError("UNAUTHORIZED", "Sign in to continue.", 401);
  const { id } = await context.params;
  try {
    const [deleted] = await db.delete(contents).where(and(eq(contents.id, id), eq(contents.workspaceId, identity.workspaceId))).returning({ id: contents.id });
    return deleted ? jsonSuccess(deleted) : jsonError("RESOURCE_NOT_FOUND", "Content not found.", 404);
  } catch (error) {
    if (databaseErrorCode(error) === "23503") return jsonError("CONTENT_IN_USE", "This content is used by a campaign and cannot be deleted.", 409);
    return jsonError("DELETE_FAILED", "Unable to delete content.", 500);
  }
}

import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getIdentity } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { contentVariants, contents } from "@/lib/db/schema";
import { jsonError, jsonSuccess, verifySameOrigin } from "@/lib/security/http";

const input = z.object({ name: z.string().trim().min(1).max(120), body: z.string().trim().min(1).max(10000) });

export async function PATCH(request: Request, context: { params: Promise<{ id: string; variantId: string }> }) {
  if (!verifySameOrigin(request)) return jsonError("INVALID_ORIGIN", "Request origin is not allowed.", 403);
  const identity = await getIdentity();
  if (!identity) return jsonError("UNAUTHORIZED", "Sign in to continue.", 401);
  const { id, variantId } = await context.params;
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("INVALID_INPUT", "Enter a variant name and caption.");
  const [content] = await db.select({ id: contents.id }).from(contents).where(and(eq(contents.id, id), eq(contents.workspaceId, identity.workspaceId))).limit(1);
  if (!content) return jsonError("RESOURCE_NOT_FOUND", "Content not found.", 404);
  const [updated] = await db.update(contentVariants).set({ ...parsed.data, updatedAt: new Date() }).where(and(eq(contentVariants.id, variantId), eq(contentVariants.contentId, id))).returning();
  return updated ? jsonSuccess(updated) : jsonError("RESOURCE_NOT_FOUND", "Content variant not found.", 404);
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string; variantId: string }> }) {
  if (!verifySameOrigin(request)) return jsonError("INVALID_ORIGIN", "Request origin is not allowed.", 403);
  const identity = await getIdentity();
  if (!identity) return jsonError("UNAUTHORIZED", "Sign in to continue.", 401);
  const { id, variantId } = await context.params;
  const [content] = await db.select({ id: contents.id }).from(contents).where(and(eq(contents.id, id), eq(contents.workspaceId, identity.workspaceId))).limit(1);
  if (!content) return jsonError("RESOURCE_NOT_FOUND", "Content not found.", 404);
  const [deleted] = await db.delete(contentVariants).where(and(eq(contentVariants.id, variantId), eq(contentVariants.contentId, id))).returning({ id: contentVariants.id });
  return deleted ? jsonSuccess(deleted) : jsonError("RESOURCE_NOT_FOUND", "Content variant not found.", 404);
}

import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { getIdentity } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { contentVariants, contents } from "@/lib/db/schema";
import { jsonError, jsonSuccess, verifySameOrigin } from "@/lib/security/http";

const input = z.object({ name: z.string().trim().min(1).max(120), body: z.string().trim().min(1).max(10000) });

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const identity = await getIdentity();
  if (!identity) return jsonError("UNAUTHORIZED", "Sign in to continue.", 401);
  const { id } = await context.params;
  const [content] = await db.select({ id: contents.id }).from(contents).where(and(eq(contents.id, id), eq(contents.workspaceId, identity.workspaceId))).limit(1);
  if (!content) return jsonError("RESOURCE_NOT_FOUND", "Content not found.", 404);
  return jsonSuccess(await db.select().from(contentVariants).where(eq(contentVariants.contentId, id)).orderBy(asc(contentVariants.createdAt)));
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!verifySameOrigin(request)) return jsonError("INVALID_ORIGIN", "Request origin is not allowed.", 403);
  const identity = await getIdentity();
  if (!identity) return jsonError("UNAUTHORIZED", "Sign in to continue.", 401);
  const { id } = await context.params;
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("INVALID_INPUT", "Enter a variant name and caption.");
  const [content] = await db.select({ id: contents.id }).from(contents).where(and(eq(contents.id, id), eq(contents.workspaceId, identity.workspaceId))).limit(1);
  if (!content) return jsonError("RESOURCE_NOT_FOUND", "Content not found.", 404);
  const [variant] = await db.insert(contentVariants).values({ ...parsed.data, contentId: id }).returning();
  return jsonSuccess(variant, 201);
}

import { and, desc, eq, ilike, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { databaseErrorCode } from "@/lib/db/errors";
import { groups } from "@/lib/db/schema";
import { getIdentity } from "@/lib/auth/session";
import { jsonError, jsonSuccess, verifySameOrigin } from "@/lib/security/http";
import { isFacebookGroupUrl, normalizeFacebookGroupUrl } from "@/lib/validators/facebook";

const input = z.object({ name: z.string().trim().min(1).max(160), facebookUrl: z.string().url(), category: z.string().max(80).optional().nullable(), description: z.string().max(2000).optional().nullable(), notes: z.string().max(2000).optional().nullable() }).refine((value) => isFacebookGroupUrl(value.facebookUrl), "Enter a Facebook group URL.").transform((value) => ({ ...value, facebookUrl: normalizeFacebookGroupUrl(value.facebookUrl) }));

export async function GET(request: Request) {
  const identity = await getIdentity();
  if (!identity) return jsonError("UNAUTHORIZED", "Sign in to continue.", 401);
  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get("page") || 1));
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") || 25)));
  const search = url.searchParams.get("search")?.slice(0, 160);
  const filter = search ? and(eq(groups.workspaceId, identity.workspaceId), ilike(groups.name, `%${search}%`)) : eq(groups.workspaceId, identity.workspaceId);
  const [items, total] = await Promise.all([
    db.select().from(groups).where(filter).orderBy(desc(groups.createdAt)).limit(limit).offset((page - 1) * limit),
    db.select({ count: sql<number>`count(*)::int` }).from(groups).where(filter),
  ]);
  return jsonSuccess({ items, total: total[0]?.count ?? 0, page, limit });
}

export async function POST(request: Request) {
  if (!verifySameOrigin(request)) return jsonError("INVALID_ORIGIN", "Request origin is not allowed.", 403);
  const identity = await getIdentity();
  if (!identity) return jsonError("UNAUTHORIZED", "Sign in to continue.", 401);
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("INVALID_INPUT", "Check the group details and Facebook URL.");
  try {
    const [created] = await db.insert(groups).values({ ...parsed.data, workspaceId: identity.workspaceId, createdBy: identity.userId }).returning();
    return jsonSuccess(created, 201);
  } catch (error) {
    if (databaseErrorCode(error) === "23505") return jsonError("DUPLICATE_GROUP", "This group is already in your workspace.", 409);
    return jsonError("CREATE_FAILED", "Unable to add this group.", 500);
  }
}

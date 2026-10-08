import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { contents } from "@/lib/db/schema";
import { getIdentity } from "@/lib/auth/session";
import { jsonError, jsonSuccess, verifySameOrigin } from "@/lib/security/http";
import { isHttpUrl } from "@/lib/validators/urls";

const input = z.object({ name: z.string().trim().min(1).max(160), body: z.string().trim().min(1).max(10000), linkUrl: z.string().url().refine(isHttpUrl).optional().or(z.literal("")) });

export async function GET() {
  const identity = await getIdentity();
  if (!identity) return jsonError("UNAUTHORIZED", "Sign in to continue.", 401);
  return jsonSuccess(await db.select().from(contents).where(eq(contents.workspaceId, identity.workspaceId)).orderBy(desc(contents.updatedAt)));
}

export async function POST(request: Request) {
  if (!verifySameOrigin(request)) return jsonError("INVALID_ORIGIN", "Request origin is not allowed.", 403);
  const identity = await getIdentity();
  if (!identity) return jsonError("UNAUTHORIZED", "Sign in to continue.", 401);
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("INVALID_INPUT", "Enter a content name and caption.");
  const [created] = await db.insert(contents).values({ ...parsed.data, linkUrl: parsed.data.linkUrl || null, workspaceId: identity.workspaceId, createdBy: identity.userId }).returning();
  return jsonSuccess(created, 201);
}

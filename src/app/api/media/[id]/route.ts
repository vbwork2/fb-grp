import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { media } from "@/lib/db/schema";
import { getIdentity } from "@/lib/auth/session";
import { jsonError } from "@/lib/security/http";
import { getMedia } from "@/lib/storage";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const identity = await getIdentity();
  if (!identity) return jsonError("UNAUTHORIZED", "Sign in to continue.", 401);
  const { id } = await context.params;
  const [item] = await db.select().from(media).where(and(eq(media.id, id), eq(media.workspaceId, identity.workspaceId))).limit(1);
  if (!item) return jsonError("RESOURCE_NOT_FOUND", "Media not found.", 404);
  const bytes = await getMedia(item.storageKey);
  if (!bytes) return jsonError("RESOURCE_NOT_FOUND", "Media file not found.", 404);
  return new Response(new Blob([bytes.slice().buffer as ArrayBuffer], { type: item.mimeType }), { headers: { "content-type": item.mimeType, "content-length": String(bytes.byteLength), "cache-control": "private, no-store", "x-content-type-options": "nosniff" } });
}

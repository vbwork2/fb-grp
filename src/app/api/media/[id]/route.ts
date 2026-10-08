import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { media } from "@/lib/db/schema";
import { getIdentity } from "@/lib/auth/session";
import { jsonError, jsonSuccess, verifySameOrigin } from "@/lib/security/http";
import { deleteMedia, getMedia } from "@/lib/storage";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const identity = await getIdentity();
  if (!identity) return jsonError("UNAUTHORIZED", "Sign in to continue.", 401);
  const { id } = await context.params;
  const [item] = await db.select().from(media).where(and(eq(media.id, id), eq(media.workspaceId, identity.workspaceId))).limit(1);
  if (!item) return jsonError("RESOURCE_NOT_FOUND", "Media not found.", 404);
  let bytes: Uint8Array | null;
  try { bytes = await getMedia(item.storageKey); } catch {
    return jsonError("STORAGE_UNAVAILABLE", "Unable to load image. Try again.", 503);
  }
  if (!bytes) return jsonError("RESOURCE_NOT_FOUND", "Media file not found.", 404);
  return new Response(new Blob([bytes.slice().buffer as ArrayBuffer], { type: item.mimeType }), { headers: { "content-type": item.mimeType, "content-length": String(bytes.byteLength), "cache-control": "private, no-store", "x-content-type-options": "nosniff" } });
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!verifySameOrigin(request)) return jsonError("INVALID_ORIGIN", "Request origin is not allowed.", 403);
  const identity = await getIdentity();
  if (!identity) return jsonError("UNAUTHORIZED", "Sign in to continue.", 401);
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) return jsonError("INVALID_INPUT", "Invalid media ID.");
  try {
    const deleted = await db.transaction(async (tx) => {
      const [item] = await tx.select().from(media)
        .where(and(eq(media.id, id), eq(media.workspaceId, identity.workspaceId)))
        .limit(1).for("update");
      if (!item) return null;
      // Keep metadata when storage deletion fails so the user can retry.
      await deleteMedia(item.storageKey);
      const [removed] = await tx.delete(media)
        .where(and(eq(media.id, id), eq(media.workspaceId, identity.workspaceId)))
        .returning({ id: media.id });
      return removed;
    });
    return deleted ? jsonSuccess(deleted) : jsonError("RESOURCE_NOT_FOUND", "Media not found.", 404);
  } catch {
    return jsonError("DELETE_FAILED", "Unable to delete image. Try again.", 500);
  }
}

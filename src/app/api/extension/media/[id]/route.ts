import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { media } from "@/lib/db/schema";
import { getDevice } from "@/lib/auth/device";
import { jsonError } from "@/lib/security/http";
import { getMedia } from "@/lib/storage";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const device = await getDevice(request);
  if (!device) return jsonError("DEVICE_UNAUTHORIZED", "Device token is invalid, expired, or revoked.", 401);
  const { id } = await context.params;
  const [item] = await db.select().from(media).where(and(eq(media.id, id), eq(media.workspaceId, device.workspaceId))).limit(1);
  if (!item) return jsonError("RESOURCE_NOT_FOUND", "Media not found.", 404);
  let bytes: Uint8Array | null;
  try { bytes = await getMedia(item.storageKey); } catch {
    return jsonError("STORAGE_UNAVAILABLE", "Unable to load image. Try again.", 503);
  }
  if (!bytes) return jsonError("RESOURCE_NOT_FOUND", "Media file not found.", 404);
  return new Response(new Blob([bytes.slice().buffer as ArrayBuffer], { type: item.mimeType }), { headers: { "content-type": item.mimeType, "content-length": String(bytes.byteLength), "cache-control": "private, no-store", "x-content-type-options": "nosniff" } });
}

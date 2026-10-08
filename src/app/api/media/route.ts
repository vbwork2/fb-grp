import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { contents, media } from "@/lib/db/schema";
import { getIdentity } from "@/lib/auth/session";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { jsonError, jsonSuccess, verifySameOrigin } from "@/lib/security/http";
import { putMedia } from "@/lib/storage";
import { config } from "@/lib/config";
import { validateImageUpload } from "@/lib/validators/media";

export async function POST(request: Request) {
  if (!verifySameOrigin(request)) return jsonError("INVALID_ORIGIN", "Request origin is not allowed.", 403);
  const identity = await getIdentity();
  if (!identity) return jsonError("UNAUTHORIZED", "Sign in to continue.", 401);
  if (!(await checkRateLimit(`media:${identity.userId}`, 30, 3600))) return jsonError("RATE_LIMITED", "Too many uploads. Try later.", 429);
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  const contentId = form?.get("contentId");
  if (!(file instanceof File) || file.size > config.maxUploadSizeBytes || file.size === 0) return jsonError("INVALID_FILE", `Choose an image up to ${Math.round(config.maxUploadSizeBytes / 1024 / 1024)} MB.`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mimeType = file.type;
  if (!validateImageUpload(bytes, mimeType, file.name, file.size, config.maxUploadSizeBytes)) return jsonError("INVALID_FILE", "Upload a valid JPG, PNG, or WebP image.");
  if (typeof contentId === "string" && contentId) {
    const [owned] = await db.select({ id: contents.id }).from(contents).where(and(eq(contents.id, contentId), eq(contents.workspaceId, identity.workspaceId))).limit(1);
    if (!owned) return jsonError("RESOURCE_NOT_FOUND", "Content not found.", 404);
  }
  const key = randomUUID();
  await putMedia(key, bytes, { mimeType });
  const [created] = await db.insert(media).values({ workspaceId: identity.workspaceId, contentId: typeof contentId === "string" ? contentId || null : null, storageKey: key, mimeType, originalFilename: file.name.replace(/[\\/\0]/g, "").slice(0, 255), sizeBytes: file.size }).returning();
  return jsonSuccess(created, 201);
}

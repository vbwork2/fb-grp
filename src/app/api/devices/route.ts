import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { auditLogs, devices } from "@/lib/db/schema";
import { getIdentity } from "@/lib/auth/session";
import { jsonError, jsonSuccess, verifySameOrigin } from "@/lib/security/http";

export async function GET() {
  const identity = await getIdentity();
  if (!identity) return jsonError("UNAUTHORIZED", "Sign in to continue.", 401);
  return jsonSuccess(await db.select({ id: devices.id, name: devices.name, createdAt: devices.createdAt, lastSeenAt: devices.lastSeenAt, expiresAt: devices.expiresAt }).from(devices).where(and(eq(devices.workspaceId, identity.workspaceId), isNull(devices.revokedAt))).orderBy(desc(devices.createdAt)));
}

export async function DELETE(request: Request) {
  if (!verifySameOrigin(request)) return jsonError("INVALID_ORIGIN", "Request origin is not allowed.", 403);
  const identity = await getIdentity();
  if (!identity) return jsonError("UNAUTHORIZED", "Sign in to continue.", 401);
  const body = await request.json().catch(() => null) as { id?: string } | null;
  if (!body?.id) return jsonError("INVALID_INPUT", "A device ID is required.");
  const [device] = await db.update(devices).set({ revokedAt: new Date() }).where(and(eq(devices.id, body.id), eq(devices.workspaceId, identity.workspaceId), isNull(devices.revokedAt))).returning({ id: devices.id });
  if (!device) return jsonError("RESOURCE_NOT_FOUND", "Device not found.", 404);
  await db.insert(auditLogs).values({ userId: identity.userId, workspaceId: identity.workspaceId, action: "DEVICE_REVOKED", resourceType: "device", resourceId: device.id });
  return jsonSuccess({ id: device.id });
}

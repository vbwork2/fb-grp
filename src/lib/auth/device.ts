import "server-only";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { devices, users, workspaceMembers } from "@/lib/db/schema";
import { hashOpaqueToken } from "@/lib/security/tokens";

export async function getDevice(request: Request) {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return null;
  const token = authorization.slice(7);
  if (token.length < 32 || token.length > 256) return null;
  const tokenHash = hashOpaqueToken(token);
  const [record] = await db.select({ device: devices }).from(devices)
    .innerJoin(users, eq(users.id, devices.userId))
    .innerJoin(workspaceMembers, and(eq(workspaceMembers.userId, devices.userId), eq(workspaceMembers.workspaceId, devices.workspaceId)))
    .where(and(eq(devices.tokenHash, tokenHash), eq(users.status, "ACTIVE"), isNull(devices.revokedAt), gt(devices.expiresAt, new Date()))).limit(1);
  if (!record) return null;
  const device = record.device;
  await db.update(devices).set({ lastSeenAt: new Date() }).where(eq(devices.id, device.id));
  return device;
}

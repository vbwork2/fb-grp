import { clientIp } from "@/lib/security/client-ip";
import { createHash } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { devices, pairingCodes, auditLogs } from "@/lib/db/schema";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { jsonError, jsonSuccess } from "@/lib/security/http";
import { config } from "@/lib/config";
import { createOpaqueToken, hashOpaqueToken } from "@/lib/security/tokens";

const input = z.object({ code: z.string().regex(/^\d{3}-\d{3}$/), name: z.string().trim().min(1).max(120).default("Chrome Extension") });

export async function POST(request: Request) {
  const ip = clientIp(request);
  if (!(await checkRateLimit(`pair:${ip}`, 8, 900))) return jsonError("RATE_LIMITED", "Too many pairing attempts.", 429);
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("INVALID_INPUT", "Enter a valid pairing code.");
  const codeHash = createHash("sha256").update(parsed.data.code).digest("hex");
  const token = createOpaqueToken();
  const tokenHash = hashOpaqueToken(token);
  const now = new Date();
  const result = await db.transaction(async (tx) => {
    const [pairing] = await tx.select().from(pairingCodes).where(and(eq(pairingCodes.codeHash, codeHash), gt(pairingCodes.expiresAt, now), isNull(pairingCodes.usedAt))).limit(1).for("update");
    if (!pairing) return null;
    await tx.update(pairingCodes).set({ usedAt: now }).where(and(eq(pairingCodes.id, pairing.id), isNull(pairingCodes.usedAt)));
    const [device] = await tx.insert(devices).values({ userId: pairing.userId, workspaceId: pairing.workspaceId, name: parsed.data.name, tokenHash, expiresAt: new Date(Date.now() + config.deviceTokenTtlDays * 24 * 60 * 60 * 1000) }).returning({ id: devices.id });
    await tx.insert(auditLogs).values({ userId: pairing.userId, workspaceId: pairing.workspaceId, action: "DEVICE_PAIRED", resourceType: "device", resourceId: device.id });
    return { deviceId: device.id };
  });
  return result ? jsonSuccess({ ...result, deviceToken: token }, 201) : jsonError("INVALID_PAIRING_CODE", "This code has expired or has already been used.", 401);
}

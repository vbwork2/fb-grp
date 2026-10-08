import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { getIdentity } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { auditLogs, users } from "@/lib/db/schema";
import { jsonError, jsonSuccess, verifySameOrigin } from "@/lib/security/http";
import { hashPassword, validatePassword, verifyPassword } from "@/lib/security/password";

const input = z.object({ displayName: z.string().trim().min(1).max(120), currentPassword: z.string().max(1024).optional(), newPassword: z.string().refine(validatePassword).optional() }).refine((data) => !data.newPassword || Boolean(data.currentPassword));

export async function PATCH(request: Request) {
  if (!verifySameOrigin(request)) return jsonError("INVALID_ORIGIN", "Request origin is not allowed.", 403);
  const identity = await getIdentity();
  if (!identity) return jsonError("UNAUTHORIZED", "Sign in to continue.", 401);
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("INVALID_INPUT", "Enter a name and, if changing your password, both current and new passwords.");
  const [user] = await db.select().from(users).where(eq(users.id, identity.userId)).limit(1);
  if (!user) return jsonError("UNAUTHORIZED", "Sign in to continue.", 401);
  if (parsed.data.newPassword && (!user.passwordHash || !parsed.data.currentPassword || !(await verifyPassword(parsed.data.currentPassword, user.passwordHash)))) return jsonError("INVALID_PASSWORD", "Current password is incorrect.", 403);
  const passwordHash = parsed.data.newPassword ? await hashPassword(parsed.data.newPassword) : user.passwordHash;
  await db.transaction(async (tx) => {
    await tx.update(users).set({ displayName: parsed.data.displayName, passwordHash, sessionVersion: parsed.data.newPassword ? sql`${users.sessionVersion} + 1` : users.sessionVersion, updatedAt: new Date() }).where(eq(users.id, user.id));
    await tx.insert(auditLogs).values({ userId: user.id, workspaceId: identity.workspaceId, action: parsed.data.newPassword ? "PASSWORD_CHANGED" : "PROFILE_UPDATED" });
  });
  return jsonSuccess({ displayName: parsed.data.displayName, passwordChanged: Boolean(parsed.data.newPassword) });
}

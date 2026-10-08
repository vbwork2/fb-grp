import { createHash } from "node:crypto";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { auditLogs, passwordResets, users } from "@/lib/db/schema";
import { hashPassword, validatePassword } from "@/lib/security/password";
import { jsonError, jsonSuccess, verifySameOrigin } from "@/lib/security/http";

const input = z.object({ token: z.string().min(32).max(256), password: z.string().refine(validatePassword) });

export async function POST(request: Request) {
  if (!verifySameOrigin(request)) return jsonError("INVALID_ORIGIN", "Request origin is not allowed.", 403);
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("INVALID_INPUT", "Use a valid reset link and a password of at least 10 characters including a number.");
  const tokenHash = createHash("sha256").update(parsed.data.token).digest("hex");
  const passwordHash = await hashPassword(parsed.data.password);
  const result = await db.transaction(async (tx) => {
    const [reset] = await tx.select().from(passwordResets).where(and(eq(passwordResets.tokenHash, tokenHash), isNull(passwordResets.usedAt), gt(passwordResets.expiresAt, new Date()))).limit(1).for("update");
    if (!reset) return false;
    await tx.update(passwordResets).set({ usedAt: new Date() }).where(and(eq(passwordResets.id, reset.id), isNull(passwordResets.usedAt)));
    await tx.update(users).set({ passwordHash, sessionVersion: sql`${users.sessionVersion} + 1`, updatedAt: new Date() }).where(eq(users.id, reset.userId));
    await tx.insert(auditLogs).values({ userId: reset.userId, action: "PASSWORD_RESET" });
    return true;
  });
  return result ? jsonSuccess({ reset: true }) : jsonError("INVALID_RESET_TOKEN", "Reset link is invalid or expired.", 400);
}

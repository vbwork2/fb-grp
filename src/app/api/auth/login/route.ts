import { clientIp } from "@/lib/security/client-ip";
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { auditLogs, users } from "@/lib/db/schema";
import { verifyPassword } from "@/lib/security/password";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { createSession } from "@/lib/auth/session";
import { jsonError, verifySameOrigin } from "@/lib/security/http";

const input = z.object({ email: z.string().email().max(320), password: z.string().min(1).max(1024) });

export async function POST(request: Request) {
  if (!verifySameOrigin(request)) return jsonError("INVALID_ORIGIN", "Request origin is not allowed.", 403);
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("INVALID_CREDENTIALS", "Email or password is incorrect.", 401);
  const email = parsed.data.email.toLowerCase();
  try {
    if (!(await checkRateLimit(`login:${email}:${clientIp(request)}`, 10, 900))) return jsonError("RATE_LIMITED", "Too many sign-in attempts.", 429);
  } catch {
    return jsonError("RATE_LIMIT_UNAVAILABLE", "Unable to check sign-in limits. Check the database connection and retry.", 503);
  }
  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  const valid = user?.passwordHash ? await verifyPassword(parsed.data.password, user.passwordHash) : false;
  if (!user || !valid || user.status !== "ACTIVE") {
    await db.insert(auditLogs).values({ userId: user?.id ?? null, action: "LOGIN_FAILED" });
    return jsonError("INVALID_CREDENTIALS", "Email or password is incorrect.", 401);
  }
  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
  await db.insert(auditLogs).values({ userId: user.id, action: "LOGIN_SUCCESS" });
  await createSession(user.id);
  return NextResponse.json({ data: { id: user.id, email: user.email, displayName: user.displayName }, error: null });
}

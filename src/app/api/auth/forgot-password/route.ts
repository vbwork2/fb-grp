import { clientIp } from "@/lib/security/client-ip";
import { createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { passwordResets, users } from "@/lib/db/schema";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { sendPasswordResetEmail } from "@/lib/email";
import { jsonError, jsonSuccess, verifySameOrigin } from "@/lib/security/http";

const input = z.object({ email: z.string().email().max(320) });

export async function POST(request: Request) {
  if (!verifySameOrigin(request)) return jsonError("INVALID_ORIGIN", "Request origin is not allowed.", 403);
  const ip = clientIp(request);
  if (!(await checkRateLimit(`forgot:${ip}`, 5, 3600))) return jsonError("RATE_LIMITED", "Too many reset requests.", 429);
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("INVALID_INPUT", "Enter a valid email address.");
  const [user] = await db.select({ id: users.id, email: users.email }).from(users).where(eq(users.email, parsed.data.email.toLowerCase())).limit(1);
  if (user) {
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
    const tokenHash = createHash("sha256").update(token).digest("hex");
    await db.insert(passwordResets).values({ userId: user.id, tokenHash, expiresAt });
    const appUrl = process.env.APP_URL ?? new URL(request.url).origin;
    await sendPasswordResetEmail(user.email, new URL(`/reset-password?token=${encodeURIComponent(token)}`, appUrl).toString());
  }
  return jsonSuccess({ message: "If the account exists, a reset link will be sent." });
}

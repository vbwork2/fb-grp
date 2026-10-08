import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { databaseErrorCode } from "@/lib/db/errors";
import { users, workspaces, workspaceMembers, auditLogs } from "@/lib/db/schema";
import { hashPassword, validatePassword } from "@/lib/security/password";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { createSession } from "@/lib/auth/session";
import { jsonError, verifySameOrigin } from "@/lib/security/http";

const input = z.object({ email: z.string().email().max(320), password: z.string().refine(validatePassword), displayName: z.string().trim().min(1).max(120) });

export async function POST(request: Request) {
  if (!verifySameOrigin(request)) return jsonError("INVALID_ORIGIN", "Request origin is not allowed.", 403);
  const ip = request.headers.get("x-nf-client-connection-ip") ?? "unknown";
  try {
    if (!(await checkRateLimit(`register:${ip}`, 5, 3600))) return jsonError("RATE_LIMITED", "Too many registration attempts.", 429);
  } catch {
    return jsonError("RATE_LIMIT_UNAVAILABLE", "Unable to check registration limits. Check the database connection and retry.", 503);
  }
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("INVALID_INPUT", "Enter a valid email, name, and password with 10 or more characters including a number.");
  const email = parsed.data.email.toLowerCase();
  try {
    const passwordHash = await hashPassword(parsed.data.password);
    const created = await db.transaction(async (tx) => {
      const [user] = await tx.insert(users).values({ email, passwordHash, displayName: parsed.data.displayName }).returning();
      const [workspace] = await tx.insert(workspaces).values({ name: "Personal Workspace", ownerId: user.id }).returning();
      await tx.insert(workspaceMembers).values({ workspaceId: workspace.id, userId: user.id, role: "OWNER" });
      await tx.insert(auditLogs).values({ userId: user.id, workspaceId: workspace.id, action: "REGISTER" });
      return { user, workspace };
    });
    await createSession(created.user.id);
    return NextResponse.json({ data: { id: created.user.id, email: created.user.email, workspaceId: created.workspace.id }, error: null }, { status: 201 });
  } catch (error) {
    if (databaseErrorCode(error) === "23505") return jsonError("EMAIL_IN_USE", "An account with this email already exists.", 409);
    return jsonError("REGISTRATION_FAILED", "Unable to create your account.", 500);
  }
}

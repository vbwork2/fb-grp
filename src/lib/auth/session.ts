import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users, workspaceMembers } from "@/lib/db/schema";

const cookieName = "fbga_session";
const maxAge = 60 * 60 * 24 * 7;

function secret(): string {
  const value = process.env.AUTH_SECRET;
  if (!value || value.length < 32) throw new Error("AUTH_SECRET must contain at least 32 characters.");
  return value;
}

function sign(value: string): string {
  return createHmac("sha256", secret()).update(value).digest("base64url");
}

export async function createSession(userId: string): Promise<void> {
  const [user] = await db.select({ sessionVersion: users.sessionVersion }).from(users).where(eq(users.id, userId)).limit(1);
  if (!user) throw new Error("Unable to create session.");
  const now = Math.floor(Date.now() / 1000);
  const nonce = randomBytes(16).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ sub: userId, iat: now, exp: now + maxAge, nonce, version: user.sessionVersion })).toString("base64url");
  const token = `${payload}.${sign(payload)}`;
  (await cookies()).set(cookieName, token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge });
}

export async function clearSession(): Promise<void> {
  (await cookies()).set(cookieName, "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 0 });
}

export async function getIdentity() {
  const raw = (await cookies()).get(cookieName)?.value;
  if (!raw) return null;
  const [payload, signature] = raw.split(".");
  if (!payload || !signature) return null;
  const expected = Buffer.from(sign(payload));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { sub: string; exp: number; version: number };
    if (!data.sub || data.exp < Date.now() / 1000) return null;
    const [membership] = await db.select({ user: users, workspaceId: workspaceMembers.workspaceId })
      .from(workspaceMembers).innerJoin(users, eq(workspaceMembers.userId, users.id))
      .where(and(eq(users.id, data.sub), eq(users.status, "ACTIVE"))).limit(1);
    if (!membership || membership.user.sessionVersion !== data.version) return null;
    return { userId: membership.user.id, email: membership.user.email, name: membership.user.displayName, workspaceId: membership.workspaceId };
  } catch {
    return null;
  }
}

export async function requireIdentity() {
  const identity = await getIdentity();
  if (!identity) throw new Error("UNAUTHORIZED");
  return identity;
}

import { createHash, randomInt } from "node:crypto";
import { db } from "@/lib/db";
import { pairingCodes } from "@/lib/db/schema";
import { getIdentity } from "@/lib/auth/session";
import { jsonError, jsonSuccess, verifySameOrigin } from "@/lib/security/http";
import { config } from "@/lib/config";

export async function POST(request: Request) {
  if (!verifySameOrigin(request)) return jsonError("INVALID_ORIGIN", "Request origin is not allowed.", 403);
  const identity = await getIdentity();
  if (!identity) return jsonError("UNAUTHORIZED", "Sign in to continue.", 401);
  const code = `${String(randomInt(0, 1000)).padStart(3, "0")}-${String(randomInt(0, 1000)).padStart(3, "0")}`;
  const codeHash = createHash("sha256").update(code).digest("hex");
  const expiresAt = new Date(Date.now() + config.pairingCodeTtlSeconds * 1000);
  await db.insert(pairingCodes).values({ userId: identity.userId, workspaceId: identity.workspaceId, codeHash, expiresAt });
  return jsonSuccess({ code, expiresAt });
}

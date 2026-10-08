import { jsonError, jsonSuccess } from "@/lib/security/http";
import { getIdentity } from "@/lib/auth/session";

export async function GET() {
  const identity = await getIdentity();
  return identity ? jsonSuccess(identity) : jsonError("UNAUTHORIZED", "Sign in to continue.", 401);
}

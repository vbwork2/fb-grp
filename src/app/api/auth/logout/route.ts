import { NextResponse } from "next/server";
import { clearSession } from "@/lib/auth/session";
import { jsonError, verifySameOrigin } from "@/lib/security/http";

export async function POST(request: Request) {
  if (!verifySameOrigin(request)) return jsonError("INVALID_ORIGIN", "Request origin is not allowed.", 403);
  await clearSession();
  return NextResponse.json({ data: { loggedOut: true }, error: null });
}

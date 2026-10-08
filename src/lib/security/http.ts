import { NextResponse } from "next/server";

export function jsonError(code: string, message: string, status = 400) {
  return NextResponse.json({ data: null, error: { code, message } }, { status });
}

export function jsonSuccess(data: unknown, status = 200) {
  return NextResponse.json({ data, error: null }, { status });
}

export function verifySameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (!origin || !host) return false;
  try {
    const parsed = new URL(origin);
    return parsed.host === host && (parsed.protocol === "https:" || process.env.NODE_ENV !== "production");
  } catch {
    return false;
  }
}

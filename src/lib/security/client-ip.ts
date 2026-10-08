import { isIP } from "node:net";

export function clientIp(request: Request): string {
  // Trust the platform header only when running behind Vercel's proxy.
  if (process.env.VERCEL !== "1") return "unknown";
  const value = request.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim();
  return value && isIP(value) ? value : "unknown";
}

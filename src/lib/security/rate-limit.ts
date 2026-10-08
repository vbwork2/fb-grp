import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { rateLimits } from "@/lib/db/schema";

export async function checkRateLimit(key: string, max: number, windowSeconds: number): Promise<boolean> {
  const resetAt = new Date(Date.now() + windowSeconds * 1000);
  const rows = await db.insert(rateLimits).values({ key, count: 1, resetAt }).onConflictDoUpdate({
    target: rateLimits.key,
    set: {
      count: sql`CASE WHEN ${rateLimits.resetAt} <= now() THEN 1 ELSE ${rateLimits.count} + 1 END`,
      resetAt: sql`CASE WHEN ${rateLimits.resetAt} <= now() THEN ${resetAt.toISOString()}::timestamptz ELSE ${rateLimits.resetAt} END`,
    },
  }).returning({ count: rateLimits.count });
  return (rows[0]?.count ?? max + 1) <= max;
}

import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { campaigns, groups, postHistory } from "@/lib/db/schema";
import { getIdentity } from "@/lib/auth/session";
import { jsonError } from "@/lib/security/http";

function cell(value: string | null | undefined): string {
  const safe = (value ?? "").replaceAll('"', '""');
  return `"${safe}"`;
}

export async function GET() {
  const identity = await getIdentity();
  if (!identity) return jsonError("UNAUTHORIZED", "Sign in to continue.", 401);
  const rows = await db.select({ history: postHistory, groupName: groups.name, campaignName: campaigns.name }).from(postHistory).innerJoin(groups, eq(postHistory.groupId, groups.id)).innerJoin(campaigns, eq(postHistory.campaignId, campaigns.id)).where(eq(postHistory.workspaceId, identity.workspaceId)).orderBy(desc(postHistory.createdAt)).limit(10000);
  const csv = [["Campaign", "Group", "Status", "Posted at", "Facebook post URL", "Notes"], ...rows.map(({ history, groupName, campaignName }) => [campaignName, groupName, history.status, history.postedAt?.toISOString() ?? "", history.facebookPostUrl ?? "", history.notes ?? ""])].map((row) => row.map((value) => cell(String(value))).join(",")).join("\r\n");
  return new Response(`\uFEFF${csv}`, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": "attachment; filename=groupflow-history.csv", "cache-control": "no-store" } });
}

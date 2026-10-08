import { startCampaign } from "@/lib/services/start-campaign";
import { and, asc, count, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { campaigns, campaignGroups } from "@/lib/db/schema";
import { getDevice } from "@/lib/auth/device";
import { jsonError, jsonSuccess } from "@/lib/security/http";

export async function GET(request: Request) {
  const device = await getDevice(request);
  if (!device) return jsonError("DEVICE_UNAUTHORIZED", "Device token is invalid, expired, or revoked.", 401);
  const items = await db.select({ id: campaigns.id, name: campaigns.name, status: campaigns.status, groupCount: count(campaignGroups.id) }).from(campaigns)
    .innerJoin(campaignGroups, eq(campaignGroups.campaignId, campaigns.id))
    .where(and(eq(campaigns.workspaceId, device.workspaceId), inArray(campaigns.status, ["READY", "RUNNING", "PAUSED"])))
    .groupBy(campaigns.id).orderBy(asc(campaigns.name));
  return jsonSuccess({ items: items.filter((item) => item.groupCount > 0) });
}

export async function POST(request: Request) {
  const device = await getDevice(request);
  if (!device) return jsonError("DEVICE_UNAUTHORIZED", "Device token is invalid, expired, or revoked.", 401);
  const parsed = z.object({ campaignId: z.string().uuid() }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("INVALID_INPUT", "Choose a campaign.");
  const [campaign] = await db.select({ status: campaigns.status, groupCount: count(campaignGroups.id) }).from(campaigns)
    .innerJoin(campaignGroups, eq(campaignGroups.campaignId, campaigns.id))
    .where(and(eq(campaigns.id, parsed.data.campaignId), eq(campaigns.workspaceId, device.workspaceId))).groupBy(campaigns.id).limit(1);
  if (!campaign) return jsonError("RESOURCE_NOT_FOUND", "Campaign not found.", 404);
  if (campaign.status === "READY") {
    try {
      const result = await startCampaign(parsed.data.campaignId, { workspaceId: device.workspaceId, userId: device.userId });
      if (typeof result !== "number") return jsonError("START_FAILED", "Check the campaign settings and selected groups.", 409);
      return jsonSuccess({ allowed: true, queued: result });
    } catch { return jsonError("START_FAILED", "Unable to start the campaign.", 500); }
  }
  if (campaign.status === "PAUSED") {
    await db.update(campaigns).set({ status: "RUNNING", updatedAt: new Date() }).where(and(eq(campaigns.id, parsed.data.campaignId), eq(campaigns.workspaceId, device.workspaceId), eq(campaigns.status, "PAUSED")));
    return jsonSuccess({ allowed: true });
  }
  if (campaign.status !== "RUNNING") return jsonError("INVALID_STATE", "Start or resume this campaign in the web app first.", 409);
  return jsonSuccess({ allowed: true });
}



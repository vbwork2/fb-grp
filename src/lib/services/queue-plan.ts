import { randomInt } from "node:crypto";
import type { variantStrategy } from "@/lib/db/schema";

type GroupSelection = { groupId: string; position: number };

export function buildQueuePlan(input: {
  workspaceId: string;
  campaignId: string;
  groups: GroupSelection[];
  scheduledStartAt: Date | null;
  minIntervalSeconds: number;
  maxIntervalSeconds: number;
  strategy: (typeof variantStrategy.enumValues)[number];
  variantIds: string[];
  now?: Date;
}) {
  if (!Number.isInteger(input.minIntervalSeconds) || !Number.isInteger(input.maxIntervalSeconds) || input.minIntervalSeconds < 2 || input.minIntervalSeconds > input.maxIntervalSeconds) {
    throw new Error("Invalid queue interval range.");
  }
  if (input.strategy === "ROUND_ROBIN" && input.variantIds.length === 0) throw new Error("ROUND_ROBIN requires at least one content variant.");
  const now = input.now ?? new Date();
  const startAt = input.scheduledStartAt && input.scheduledStartAt > now ? input.scheduledStartAt : now;
  let seconds = 0;
  return input.groups.map((group, index) => {
    if (index > 0) seconds += randomInt(input.minIntervalSeconds, input.maxIntervalSeconds + 1);
    return {
      workspaceId: input.workspaceId,
      campaignId: input.campaignId,
      groupId: group.groupId,
      position: group.position,
      variantId: input.strategy === "ROUND_ROBIN" ? input.variantIds[index % input.variantIds.length] : null,
      status: index === 0 ? "READY" as const : "PENDING" as const,
      scheduledAt: new Date(startAt.getTime() + seconds * 1000),
    };
  });
}

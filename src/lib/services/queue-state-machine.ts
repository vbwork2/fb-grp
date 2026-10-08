import type { queueStatus } from "@/lib/db/schema";

export type QueueState = (typeof queueStatus.enumValues)[number];
const transitions: Record<QueueState, QueueState[]> = {
  PENDING: ["READY", "SKIPPED"],
  READY: ["OPENED", "SKIPPED", "FAILED"],
  OPENED: ["AWAITING_CONFIRMATION", "FAILED", "SKIPPED"],
  AWAITING_CONFIRMATION: ["POSTED", "FAILED", "SKIPPED"],
  POSTED: [], SKIPPED: [], FAILED: ["READY"],
};

export function assertQueueTransition(from: QueueState, to: QueueState): void {
  if (!transitions[from].includes(to)) throw new Error(`Invalid queue transition: ${from} -> ${to}`);
}

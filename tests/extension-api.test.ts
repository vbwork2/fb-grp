import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { auditLogs, campaigns, contents, groups, postHistory, queueItems, users, workspaces } from "../src/lib/db/schema";

const state = vi.hoisted(() => ({ db: undefined as unknown, device: { userId: "", workspaceId: "" } }));
vi.mock("@/lib/db", () => ({ db: state.db }));
vi.mock("@/lib/auth/device", () => ({ getDevice: async () => state.device }));
const client = new PGlite();
const db = drizzle({ client });
state.db = db;
let campaignId: string;
let groupId: string;
let jobId: string;
const claimToken = "11111111-1111-4111-8111-111111111111";

beforeAll(async () => {
  const root = resolve("netlify/database/migrations");
  for (const dir of (await readdir(root, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()) {
    await client.exec((await readFile(resolve(root, dir, "migration.sql"), "utf8")).replaceAll("--> statement-breakpoint", ""));
  }
  const [user] = await db.insert(users).values({ email: "repair@example.test", displayName: "Repair fixture" }).returning();
  const [workspace] = await db.insert(workspaces).values({ ownerId: user.id, name: "Repair" }).returning();
  state.device = { userId: user.id, workspaceId: workspace.id };
  const [content] = await db.insert(contents).values({ workspaceId: workspace.id, createdBy: user.id, name: "Fixture", body: "Reviewed caption" }).returning();
  const [group] = await db.insert(groups).values({ workspaceId: workspace.id, createdBy: user.id, name: "Fixture", facebookUrl: "https://www.facebook.com/groups/fixture/" }).returning();
  groupId = group.id;
  const [campaign] = await db.insert(campaigns).values({ workspaceId: workspace.id, createdBy: user.id, contentId: content.id, name: "Fixture", status: "RUNNING" }).returning();
  campaignId = campaign.id;
});
beforeEach(async () => {
  await db.delete(postHistory);
  await db.delete(queueItems);
  await db.update(campaigns).set({ status: "RUNNING" }).where(eq(campaigns.id, campaignId));
  const [job] = await db.insert(queueItems).values({ workspaceId: state.device.workspaceId, campaignId, groupId, position: 0, scheduledAt: new Date(), status: "AWAITING_CONFIRMATION", claimToken, claimedAt: new Date() }).returning();
  jobId = job.id;
});
afterAll(async () => { await client.close(); });
function request(body: object) { return new Request("https://example.test/api/extension", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); }
function context() { return { params: Promise.resolve({ id: jobId }) }; }

it.each(["failed", "skip"])("%s cannot unlock an uncertain Facebook submission", async (action) => {
  const route = action === "failed" ? await import("../src/app/api/extension/jobs/[id]/failed/route") : await import("../src/app/api/extension/jobs/[id]/skip/route");
  expect((await route.POST(request({ claimToken, errorMessage: "Unknown outcome" }), context())).status).toBe(404);
  expect((await db.select().from(queueItems))[0].status).toBe("AWAITING_CONFIRMATION");
  expect(await db.select().from(postHistory)).toHaveLength(0);
});
it.each(["ui_confirmed", "user_confirmed"])("records %s publication only once", async (confirmationSource) => {
  const { POST } = await import("../src/app/api/extension/jobs/[id]/posted/route");
  const body = { claimToken, confirmationSource };
  expect((await POST(request(body), context())).status).toBe(200);
  expect((await POST(request(body), context())).status).toBe(404);
  expect(await db.select().from(postHistory)).toHaveLength(1);
  const audit = (await db.select().from(auditLogs)).filter((row) => row.resourceId === jobId);
  expect(audit).toHaveLength(1);
  expect(audit[0].metadataJson.confirmationSource).toBe(confirmationSource);
});
it("reset preserves uncertain submissions and cannot reopen cancelled campaigns", async () => {
  const { POST } = await import("../src/app/api/extension/campaigns/reset/route");
  expect((await POST(request({ campaignId }))).status).toBe(200);
  expect((await db.select().from(queueItems))[0].status).toBe("AWAITING_CONFIRMATION");
  await db.update(campaigns).set({ status: "CANCELLED" }).where(eq(campaigns.id, campaignId));
  expect((await POST(request({ campaignId }))).status).toBe(409);
  expect((await db.select().from(campaigns))[0].status).toBe("CANCELLED");
});
it("wrong workspace and claim token cannot confirm publication", async () => {
  const { POST } = await import("../src/app/api/extension/jobs/[id]/posted/route");
  expect((await POST(request({ claimToken: "22222222-2222-4222-8222-222222222222" }), context())).status).toBe(404);
  const original = state.device.workspaceId;
  state.device.workspaceId = "22222222-2222-4222-8222-222222222222";
  try { expect((await POST(request({ claimToken }), context())).status).toBe(404); }
  finally { state.device.workspaceId = original; }
  expect(await db.select().from(postHistory)).toHaveLength(0);
});

it("a recorded trusted click blocks reservation release and is idempotent", async () => {
  const { POST } = await import("../src/app/api/extension/jobs/[id]/submission/route");
  expect((await POST(request({ claimToken, action: "clicked" }), context())).status).toBe(200);
  expect((await POST(request({ claimToken, action: "clicked" }), context())).status).toBe(200);
  expect((await POST(request({ claimToken, action: "release" }), context())).status).toBe(409);
  expect((await db.select().from(queueItems))[0].status).toBe("AWAITING_CONFIRMATION");
  expect((await db.select().from(auditLogs)).filter((row) => row.resourceId === jobId && row.action === "QUEUE_ITEM_USER_CLICKED")).toHaveLength(1);
});

it("simultaneous callbacks cannot duplicate publication history", async () => {
  const { POST } = await import("../src/app/api/extension/jobs/[id]/posted/route");
  const results = await Promise.all([POST(request({ claimToken }), context()), POST(request({ claimToken }), context())]);
  expect(results.map((response) => response.status).sort()).toEqual([200, 404]);
  expect(await db.select().from(postHistory)).toHaveLength(1);
});
it("two claims get one job and stale uncertain jobs are never reclaimed", async () => {
  const { GET } = await import("../src/app/api/extension/jobs/next/route");
  await db.update(queueItems).set({ claimedAt: new Date(0) }).where(eq(queueItems.id, jobId));
  expect((await (await GET(new Request("https://example.test/api/extension/jobs/next"))).json()).data.job).toBeNull();
  await db.update(queueItems).set({ status: "READY", claimToken: null, claimedAt: null }).where(eq(queueItems.id, jobId));
  const results = await Promise.all([GET(new Request("https://example.test/api/extension/jobs/next")), GET(new Request("https://example.test/api/extension/jobs/next"))]);
  const bodies = await Promise.all(results.map((response) => response.json()));
  expect(bodies.filter((body) => body.data.job)).toHaveLength(1);
});

it("automatic click evidence stays audited and prevents release", async () => {
  const { POST } = await import("../src/app/api/extension/jobs/[id]/submission/route");
  expect((await POST(request({ claimToken, action: "clicked", clickSource: "automatic" }), context())).status).toBe(200);
  const [audit] = await db.select().from(auditLogs).where(eq(auditLogs.resourceId, jobId));
  expect(audit.metadataJson.clickSource).toBe("automatic");
  expect((await POST(request({ claimToken, action: "release" }), context())).status).toBe(409);
  expect((await db.select().from(queueItems))[0].status).toBe("AWAITING_CONFIRMATION");
});

it("unverified automatic completion requires recorded automatic click evidence", async () => {
  const { POST } = await import("../src/app/api/extension/jobs/[id]/posted/route");
  expect((await POST(request({ claimToken, confirmationSource: "automatic_unverified" }), context())).status).toBe(404);
  await db.insert(auditLogs).values({ userId: state.device.userId, workspaceId: state.device.workspaceId, action: "QUEUE_ITEM_USER_CLICKED", resourceType: "queue_item", resourceId: jobId, metadataJson: { clickSource: "automatic" } });
  expect((await POST(request({ claimToken, confirmationSource: "automatic_unverified", notes: "Verified success" }), context())).status).toBe(200);
  expect((await db.select().from(queueItems))[0]).toMatchObject({ status: "POSTED", errorCode: "POST_OUTCOME_UNVERIFIED", claimToken: null });
  expect((await db.select().from(postHistory))[0]).toMatchObject({ postedAt: null, notes: expect.stringContaining("unverified") });
  expect((await db.select().from(auditLogs)).filter(row => row.resourceId === jobId).some(row => row.action === "QUEUE_ITEM_SUBMITTED_UNVERIFIED")).toBe(true);
  expect((await POST(request({ claimToken, confirmationSource: "automatic_unverified" }), context())).status).toBe(404);
});

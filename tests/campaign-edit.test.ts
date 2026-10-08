import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { campaigns, campaignGroups, contents, groups, media, postHistory, queueItems, users, workspaces } from "../src/lib/db/schema";

const client = new PGlite();
const testDb = drizzle({ client });
vi.mock("@/lib/db", () => ({ get db() { return testDb; } }));
vi.mock("@/lib/storage", () => ({ getMedia: vi.fn(async () => new Uint8Array([1, 2, 3])), putMedia: vi.fn(), deleteMedia: vi.fn() }));
const { editCampaign } = await import("../src/lib/services/edit-campaign");
let identity: { userId: string; workspaceId: string };
let campaignId: string;
let contentId: string;
let groupIds: string[];

beforeAll(async () => {
  const root = resolve("netlify/database/migrations");
  for (const entry of (await readdir(root, { withFileTypes: true })).filter((item) => item.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    await client.exec((await readFile(resolve(root, entry.name, "migration.sql"), "utf8")).replaceAll("--> statement-breakpoint", ""));
  }
});
beforeEach(async () => {
  await client.exec("TRUNCATE users CASCADE");
  const [user] = await testDb.insert(users).values({ email: "edit@example.test", displayName: "Editor" }).returning();
  const [space] = await testDb.insert(workspaces).values({ name: "Edit workspace", ownerId: user.id }).returning();
  identity = { userId: user.id, workspaceId: space.id };
  const [content] = await testDb.insert(contents).values({ workspaceId: space.id, createdBy: user.id, name: "Original", body: "Original caption" }).returning();
  contentId = content.id;
  groupIds = (await testDb.insert(groups).values([0, 1, 2].map((index) => ({ workspaceId: space.id, createdBy: user.id, name: `Group ${index}`, facebookUrl: `https://www.facebook.com/groups/edit-${index}/` }))).returning()).map((group) => group.id);
  const [campaign] = await testDb.insert(campaigns).values({ workspaceId: space.id, createdBy: user.id, contentId, name: "Original campaign", status: "READY" }).returning();
  campaignId = campaign.id;
  await testDb.insert(campaignGroups).values(groupIds.slice(0, 2).map((groupId, position) => ({ campaignId, groupId, position })));
});
afterAll(() => client.close());
function edit() { return { name: "Edited campaign", contentId, groupIds: [groupIds[0], groupIds[2]], minIntervalSeconds: 60, maxIntervalSeconds: 60 }; }

describe("campaign editing", () => {
  it("replaces selected groups on an unstarted campaign without creating its queue", async () => {
    expect(await editCampaign(campaignId, identity, edit())).toMatchObject({ error: null, status: "READY" });
    const selected = await testDb.select().from(campaignGroups).where(eq(campaignGroups.campaignId, campaignId));
    expect(selected.map((item) => item.groupId)).toEqual([groupIds[0], groupIds[2]]);
    expect(await testDb.select().from(queueItems)).toHaveLength(0);
  });
  it("rebuilds only pending jobs and preserves published history", async () => {
    await testDb.update(campaigns).set({ status: "PAUSED" }).where(eq(campaigns.id, campaignId));
    const jobs = await testDb.insert(queueItems).values(groupIds.slice(0, 2).map((groupId, position) => ({ workspaceId: identity.workspaceId, campaignId, groupId, position, scheduledAt: new Date(), status: position === 0 ? "POSTED" as const : "READY" as const }))).returning();
    await testDb.insert(postHistory).values({ workspaceId: identity.workspaceId, campaignId, groupId: groupIds[0], queueItemId: jobs[0].id, status: "POSTED" });
    expect(await editCampaign(campaignId, identity, edit())).toMatchObject({ error: null });
    const remaining = await testDb.select().from(queueItems);
    expect(remaining).toHaveLength(2);
    expect(remaining.find((item) => item.status === "POSTED")?.id).toBe(jobs[0].id);
    expect(remaining.find((item) => item.status === "READY")?.groupId).toBe(groupIds[2]);
    expect(await testDb.select().from(postHistory)).toHaveLength(1);
  });
  it.each(["OPENED", "AWAITING_CONFIRMATION"] as const)("rejects editing with a %s job", async (status) => {
    await testDb.update(campaigns).set({ status: "PAUSED" });
    await testDb.insert(queueItems).values({ workspaceId: identity.workspaceId, campaignId, groupId: groupIds[0], position: 0, scheduledAt: new Date(), status });
    expect(await editCampaign(campaignId, identity, edit())).toMatchObject({ error: "claimed" });
    expect((await testDb.select().from(campaigns))[0].name).toBe("Original campaign");
  });
  it("completes a campaign after removing its last pending group", async () => {
    await testDb.update(campaigns).set({ status: "PAUSED" });
    await testDb.insert(queueItems).values(groupIds.slice(0, 2).map((groupId, position) => ({ workspaceId: identity.workspaceId, campaignId, groupId, position, scheduledAt: new Date(), status: position === 0 ? "POSTED" as const : "READY" as const })));
    expect(await editCampaign(campaignId, identity, { ...edit(), groupIds: [groupIds[0]] })).toMatchObject({ error: null, status: "COMPLETED" });
    expect(await testDb.select().from(queueItems)).toHaveLength(1);
  });
  it("removes failed groups from retry eligibility while retaining their job records", async () => {
    await testDb.update(campaigns).set({ status: "PAUSED" });
    await testDb.insert(queueItems).values({ workspaceId: identity.workspaceId, campaignId, groupId: groupIds[1], position: 0, scheduledAt: new Date(), status: "FAILED" });
    expect(await editCampaign(campaignId, identity, edit())).toMatchObject({ error: null });
    expect((await testDb.select().from(queueItems).where(eq(queueItems.groupId, groupIds[1])))[0].status).toBe("SKIPPED");
  });
  it("copies edited content and its images without modifying shared content", async () => {
    await testDb.insert(media).values({ workspaceId: identity.workspaceId, contentId, storageKey: "image-key", mimeType: "image/png", originalFilename: "image.png", sizeBytes: 100 });
    expect(await editCampaign(campaignId, identity, { ...edit(), contentDraft: { name: "Private caption", body: "Edited caption" } })).toMatchObject({ error: null });
    const [updated] = await testDb.select().from(campaigns);
    expect(updated.contentId).not.toBe(contentId);
    expect((await testDb.select().from(contents).where(eq(contents.id, contentId)))[0].body).toBe("Original caption");
    expect((await testDb.select().from(media).where(eq(media.contentId, updated.contentId)))[0].storageKey).not.toBe("image-key");
  });
  it("rejects foreign content and groups without changing campaign selection", async () => {
    const [space] = await testDb.insert(workspaces).values({ name: "Foreign", ownerId: identity.userId }).returning();
    const [content] = await testDb.insert(contents).values({ workspaceId: space.id, createdBy: identity.userId, name: "Foreign", body: "Private" }).returning();
    const [group] = await testDb.insert(groups).values({ workspaceId: space.id, createdBy: identity.userId, name: "Foreign", facebookUrl: "https://www.facebook.com/groups/foreign/" }).returning();
    expect(await editCampaign(campaignId, identity, { ...edit(), contentId: content.id })).toMatchObject({ error: "resources" });
    expect(await editCampaign(campaignId, identity, { ...edit(), groupIds: [group.id] })).toMatchObject({ error: "resources" });
    expect(await editCampaign(campaignId, { ...identity, workspaceId: space.id }, edit())).toMatchObject({ error: "missing" });
    expect(await testDb.select().from(campaignGroups)).toHaveLength(2);
  });
  it.each(["RUNNING", "COMPLETED", "CANCELLED"] as const)("rejects editing a %s campaign", async (status) => {
    await testDb.update(campaigns).set({ status });
    expect(await editCampaign(campaignId, identity, edit())).toMatchObject({ error: "state" });
  });
});
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs, campaigns, campaignGroups, contents, groups, media, postHistory, queueItems, users, workspaces } from "../src/lib/db/schema";

const client = new PGlite();
const testDb = drizzle({ client });
vi.mock("@/lib/db", () => ({ get db() { return testDb; } }));
vi.mock("@/lib/storage", () => ({ getMedia: vi.fn(async () => new Uint8Array([1, 2, 3])), putMedia: vi.fn(), deleteMedia: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getIdentity: async () => identity }));
const { deleteCampaign } = await import("../src/lib/services/delete-campaign");
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
describe("campaign deletion", () => {
  it.each(["READY", "PAUSED", "COMPLETED", "CANCELLED", "DRAFT"] as const)("deletes a %s campaign and its dependent records, preserving shared resources", async (status) => {
    await testDb.update(campaigns).set({ status });
    const [job] = await testDb.insert(queueItems).values({ workspaceId: identity.workspaceId, campaignId, groupId: groupIds[0], position: 0, scheduledAt: new Date(), status: "POSTED" }).returning();
    await testDb.insert(postHistory).values({ workspaceId: identity.workspaceId, campaignId, groupId: groupIds[0], queueItemId: job.id, status: "POSTED" });
    expect(await deleteCampaign(campaignId, identity)).toEqual({ error: null });
    expect(await testDb.select().from(campaigns)).toHaveLength(0);
    expect(await testDb.select().from(campaignGroups)).toHaveLength(0);
    expect(await testDb.select().from(queueItems)).toHaveLength(0);
    expect(await testDb.select().from(postHistory)).toHaveLength(0);
    expect(await testDb.select().from(groups)).toHaveLength(3);
    expect(await testDb.select().from(contents)).toHaveLength(1);
    expect((await testDb.select().from(auditLogs))[0].action).toBe("CAMPAIGN_DELETED");
  });
  it("rejects deleting a running campaign", async () => {
    await testDb.update(campaigns).set({ status: "RUNNING" });
    expect(await deleteCampaign(campaignId, identity)).toEqual({ error: "running" });
    expect(await testDb.select().from(campaigns)).toHaveLength(1);
  });
  it.each(["OPENED", "AWAITING_CONFIRMATION"] as const)("preserves a cancelled campaign with a %s job", async (status) => {
    await testDb.update(campaigns).set({ status: "CANCELLED" });
    await testDb.insert(queueItems).values({ workspaceId: identity.workspaceId, campaignId, groupId: groupIds[0], position: 0, scheduledAt: new Date(), status, claimToken: "protected-claim" });
    expect(await deleteCampaign(campaignId, identity)).toEqual({ error: "claimed" });
    expect((await testDb.select().from(queueItems))[0].claimToken).toBe("protected-claim");
    expect(await testDb.select().from(auditLogs)).toHaveLength(0);
  });
  it("does not delete another workspace's campaign", async () => {
    const [foreign] = await testDb.insert(workspaces).values({ ownerId: identity.userId, name: "Foreign" }).returning();
    expect(await deleteCampaign(campaignId, { ...identity, workspaceId: foreign.id })).toEqual({ error: "missing" });
    expect(await testDb.select().from(campaigns)).toHaveLength(1);
  });
  it("DELETE endpoint enforces Origin and UUID validation", async () => {
    const { DELETE } = await import("../src/app/api/campaigns/[id]/route");
    const context = { params: Promise.resolve({ id: campaignId }) };
    expect((await DELETE(new Request("https://example.test/api/campaigns", { method: "DELETE" }), context)).status).toBe(403);
    const request = () => new Request("https://example.test/api/campaigns", { method: "DELETE", headers: { origin: "https://example.test", host: "example.test" } });
    expect((await DELETE(request(), { params: Promise.resolve({ id: "invalid" }) })).status).toBe(400);
    expect((await DELETE(request(), context)).status).toBe(200);
    expect((await DELETE(request(), context)).status).toBe(404);
  });
});

describe("content library saved images", () => {
  it("loads all saved images for displayed content and excludes other workspaces and unattached files", async () => {
    const { getContentLibraryMedia } = await import("../src/lib/services/content-library");
    const [otherSpace] = await testDb.insert(workspaces).values({ name: "Other workspace", ownerId: identity.userId }).returning();
    const [otherContent] = await testDb.insert(contents).values({ workspaceId: otherSpace.id, createdBy: identity.userId, name: "Other", body: "Other" }).returning();
    await testDb.insert(media).values([
      { workspaceId: identity.workspaceId, contentId, storageKey: "first-library-image", mimeType: "image/png", originalFilename: "first.png", sizeBytes: 100, createdAt: new Date("2026-01-01") },
      { workspaceId: identity.workspaceId, contentId, storageKey: "second-library-image", mimeType: "image/jpeg", originalFilename: "second.jpg", sizeBytes: 200, createdAt: new Date("2026-01-02") },
      { workspaceId: otherSpace.id, contentId: otherContent.id, storageKey: "other-library-image", mimeType: "image/png", originalFilename: "other.png", sizeBytes: 100 },
      { workspaceId: identity.workspaceId, contentId: null, storageKey: "unattached-library-image", mimeType: "image/png", originalFilename: "unattached.png", sizeBytes: 100 },
    ]);
    const firstLoad = await getContentLibraryMedia(identity.workspaceId, [contentId, otherContent.id]);
    expect(firstLoad[contentId].map((image) => image.originalFilename)).toEqual(["first.png", "second.jpg"]);
    expect(Object.keys(firstLoad)).toEqual([contentId]);
    expect(firstLoad[contentId][0]).not.toHaveProperty("storageKey");
    expect(await getContentLibraryMedia(identity.workspaceId, [contentId])).toEqual(firstLoad);
    expect(await getContentLibraryMedia(otherSpace.id, [contentId])).toEqual({});
  });
  it("returns an empty map for an empty library or content with no images", async () => {
    const { getContentLibraryMedia } = await import("../src/lib/services/content-library");
    expect(await getContentLibraryMedia(identity.workspaceId, [])).toEqual({});
    expect(await getContentLibraryMedia(identity.workspaceId, [contentId])).toEqual({});
  });
});

describe("content image deletion", () => {
  const deleteRequest = () => new Request("https://example.test/api/media", { method: "DELETE", headers: { origin: "https://example.test", host: "example.test" } });
  async function savedImage() {
    const [image] = await testDb.insert(media).values({ workspaceId: identity.workspaceId, contentId, storageKey: "delete-image-key", mimeType: "image/png", originalFilename: "delete.png", sizeBytes: 100 }).returning();
    return image;
  }
  it("deletes only the selected image and its stored file and persists the reduced count", async () => {
    const { DELETE } = await import("../src/app/api/media/[id]/route");
    const { deleteMedia } = await import("../src/lib/storage");
    const { getContentLibraryMedia } = await import("../src/lib/services/content-library");
    const image = await savedImage();
    const [kept] = await testDb.insert(media).values({ workspaceId: identity.workspaceId, contentId, storageKey: "keep-image-key", mimeType: "image/png", originalFilename: "keep.png", sizeBytes: 100 }).returning();
    const context = { params: Promise.resolve({ id: image.id }) };
    expect((await DELETE(deleteRequest(), context)).status).toBe(200);
    expect(deleteMedia).toHaveBeenCalledWith(image.storageKey);
    expect((await getContentLibraryMedia(identity.workspaceId, [contentId]))[contentId].map((entry) => entry.id)).toEqual([kept.id]);
    expect(await testDb.select().from(contents)).toHaveLength(1);
    expect(await testDb.select().from(campaigns)).toHaveLength(1);
    expect((await DELETE(deleteRequest(), context)).status).toBe(404);
  });
  it("rejects foreign Origin and invalid media IDs without deleting images", async () => {
    const { DELETE } = await import("../src/app/api/media/[id]/route");
    const image = await savedImage();
    expect((await DELETE(new Request("https://example.test/api/media", { method: "DELETE", headers: { origin: "https://foreign.test", host: "example.test" } }), { params: Promise.resolve({ id: image.id }) })).status).toBe(403);
    expect((await DELETE(deleteRequest(), { params: Promise.resolve({ id: "invalid" }) })).status).toBe(400);
    expect(await testDb.select().from(media)).toHaveLength(1);
  });
  it("does not delete or expose another workspace's media", async () => {
    const { DELETE } = await import("../src/app/api/media/[id]/route");
    const { deleteMedia } = await import("../src/lib/storage");
    vi.mocked(deleteMedia).mockClear();
    const [otherSpace] = await testDb.insert(workspaces).values({ name: "Other workspace", ownerId: identity.userId }).returning();
    const [image] = await testDb.insert(media).values({ workspaceId: otherSpace.id, storageKey: "foreign-image-key", mimeType: "image/png", originalFilename: "private.png", sizeBytes: 100 }).returning();
    expect((await DELETE(deleteRequest(), { params: Promise.resolve({ id: image.id }) })).status).toBe(404);
    expect(deleteMedia).not.toHaveBeenCalled();
    expect(await testDb.select().from(media)).toHaveLength(1);
  });
  it("retains metadata on storage failure and permits retry", async () => {
    const { DELETE } = await import("../src/app/api/media/[id]/route");
    const { deleteMedia } = await import("../src/lib/storage");
    const image = await savedImage();
    vi.mocked(deleteMedia).mockRejectedValueOnce(new Error("Storage unavailable"));
    const context = { params: Promise.resolve({ id: image.id }) };
    expect((await DELETE(deleteRequest(), context)).status).toBe(500);
    expect(await testDb.select().from(media)).toHaveLength(1);
    expect((await DELETE(deleteRequest(), context)).status).toBe(200);
    expect(await testDb.select().from(media)).toHaveLength(0);
  });
  it("inline content updates preserve saved images and other content", async () => {
    const { PATCH } = await import("../src/app/api/content/[id]/route");
    const image = await savedImage();
    const [other] = await testDb.insert(contents).values({ workspaceId: identity.workspaceId, createdBy: identity.userId, name: "Unchanged", body: "Unchanged caption" }).returning();
    const response = await PATCH(new Request("https://example.test/api/content", { method: "PATCH", headers: { origin: "https://example.test", host: "example.test", "content-type": "application/json" }, body: JSON.stringify({ name: "Updated name", body: "Updated caption", linkUrl: "https://example.test/item" }) }), { params: Promise.resolve({ id: contentId }) });
    expect(response.status).toBe(200);
    expect((await testDb.select().from(contents).where(eq(contents.id, contentId)))[0]).toMatchObject({ name: "Updated name", body: "Updated caption" });
    expect((await testDb.select().from(contents).where(eq(contents.id, other.id)))[0].body).toBe("Unchanged caption");
    expect((await testDb.select().from(media))[0].id).toBe(image.id);
  });
});

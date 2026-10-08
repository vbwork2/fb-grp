import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { and, eq, gt, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { campaigns, campaignGroups, contents, devices, groups, media, pairingCodes, postHistory, queueItems, users, workspaces, workspaceMembers } from "../src/lib/db/schema";

const client = new PGlite();
const testDb = drizzle({ client });
let workspaceA = "";
let workspaceB = "";
const resourceIds: Record<string, string> = {};

beforeAll(async () => {
  const migrationRoot = resolve(process.cwd(), "netlify/database/migrations");
  const directories = (await readdir(migrationRoot, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  for (const directory of directories) {
    const migration = await readFile(resolve(migrationRoot, directory, "migration.sql"), "utf8");
    await client.exec(migration.replaceAll("--> statement-breakpoint", ""));
  }
  const [userA] = await testDb.insert(users).values({ email: "tenant-a@example.test", displayName: "Tenant A" }).returning();
  const [userB] = await testDb.insert(users).values({ email: "tenant-b@example.test", displayName: "Tenant B" }).returning();
  const [spaceA] = await testDb.insert(workspaces).values({ name: "Workspace A", ownerId: userA.id }).returning();
  const [spaceB] = await testDb.insert(workspaces).values({ name: "Workspace B", ownerId: userB.id }).returning();
  workspaceA = spaceA.id;
  workspaceB = spaceB.id;
  await testDb.insert(workspaceMembers).values([{ workspaceId: workspaceA, userId: userA.id, role: "OWNER" }, { workspaceId: workspaceB, userId: userB.id, role: "OWNER" }]);
  const [group] = await testDb.insert(groups).values({ workspaceId: workspaceB, createdBy: userB.id, name: "Private Group", facebookUrl: "https://www.facebook.com/groups/private-b/" }).returning();
  const [content] = await testDb.insert(contents).values({ workspaceId: workspaceB, createdBy: userB.id, name: "Private Content", body: "Private caption" }).returning();
  const [campaign] = await testDb.insert(campaigns).values({ workspaceId: workspaceB, createdBy: userB.id, name: "Private Campaign", contentId: content.id }).returning();
  await testDb.insert(campaignGroups).values({ campaignId: campaign.id, groupId: group.id, position: 0 });
  const [job] = await testDb.insert(queueItems).values({ workspaceId: workspaceB, campaignId: campaign.id, groupId: group.id, position: 0, scheduledAt: new Date(), status: "READY" }).returning();
  const [history] = await testDb.insert(postHistory).values({ workspaceId: workspaceB, campaignId: campaign.id, groupId: group.id, queueItemId: job.id, status: "POSTED" }).returning();
  const [device] = await testDb.insert(devices).values({ userId: userB.id, workspaceId: workspaceB, name: "Private Device", tokenHash: "b".repeat(64), expiresAt: new Date(Date.now() + 86_400_000) }).returning();
  const [file] = await testDb.insert(media).values({ workspaceId: workspaceB, contentId: content.id, storageKey: "private-file", mimeType: "image/png", originalFilename: "private.png", sizeBytes: 8 }).returning();
  Object.assign(resourceIds, { group: group.id, content: content.id, campaign: campaign.id, queue: job.id, history: history.id, device: device.id, media: file.id });
});

afterAll(async () => { await client.close(); });

describe("workspace isolation for guessed resource IDs", () => {
  const cases: Array<[string, () => Promise<unknown[]>]> = [
    ["groups", () => testDb.select().from(groups).where(and(eq(groups.id, resourceIds.group), eq(groups.workspaceId, workspaceA)))],
    ["content", () => testDb.select().from(contents).where(and(eq(contents.id, resourceIds.content), eq(contents.workspaceId, workspaceA)))],
    ["campaigns", () => testDb.select().from(campaigns).where(and(eq(campaigns.id, resourceIds.campaign), eq(campaigns.workspaceId, workspaceA)))],
    ["queue", () => testDb.select().from(queueItems).where(and(eq(queueItems.id, resourceIds.queue), eq(queueItems.workspaceId, workspaceA)))],
    ["history", () => testDb.select().from(postHistory).where(and(eq(postHistory.id, resourceIds.history), eq(postHistory.workspaceId, workspaceA)))],
    ["devices", () => testDb.select().from(devices).where(and(eq(devices.id, resourceIds.device), eq(devices.workspaceId, workspaceA)))],
    ["media", () => testDb.select().from(media).where(and(eq(media.id, resourceIds.media), eq(media.workspaceId, workspaceA)))],
  ];

  it.each(cases)("does not return User B %s to User A", async (_resource, lookup) => {
    expect(await lookup()).toHaveLength(0);
  });

  it("does not mutate User B's group when User A supplies its guessed ID and workspace", async () => {
    const updated = await testDb.update(groups).set({ status: "DISABLED" }).where(and(eq(groups.id, resourceIds.group), eq(groups.workspaceId, workspaceA))).returning();
    expect(updated).toHaveLength(0);
    const [ownerRow] = await testDb.select().from(groups).where(and(eq(groups.id, resourceIds.group), eq(groups.workspaceId, workspaceB))).limit(1);
    expect(ownerRow.status).toBe("ACTIVE");
  });

  it("returns no rows for an unowned guessed identifier", async () => {
    const unknown = "00000000-0000-4000-8000-000000000000";
    expect(await testDb.select().from(groups).where(and(eq(groups.id, unknown), eq(groups.workspaceId, workspaceB)))).toHaveLength(0);
  });

  it("rejects a revoked device token immediately", async () => {
    const [revoked] = await testDb.update(devices).set({ revokedAt: new Date() }).where(eq(devices.id, resourceIds.device)).returning();
    const validDevices = await testDb.select().from(devices).where(and(eq(devices.tokenHash, revoked.tokenHash), eq(devices.workspaceId, workspaceB), isNull(devices.revokedAt)));
    expect(validDevices).toHaveLength(0);
  });

  it("enforces pairing-code expiry, use, and workspace boundaries", async () => {
    const [pairing] = await testDb.insert(pairingCodes).values({ userId: (await testDb.select({ id: users.id }).from(users).where(eq(users.email, "tenant-b@example.test")))[0].id, workspaceId: workspaceB, codeHash: "c".repeat(64), expiresAt: new Date(Date.now() - 1000) }).returning();
    const expired = await testDb.select().from(pairingCodes).where(and(eq(pairingCodes.id, pairing.id), eq(pairingCodes.workspaceId, workspaceB), isNull(pairingCodes.usedAt), gt(pairingCodes.expiresAt, new Date())));
    expect(expired).toHaveLength(0);
    const userB = (await testDb.select({ id: users.id }).from(users).where(eq(users.email, "tenant-b@example.test")))[0];
    const [fresh] = await testDb.insert(pairingCodes).values({ userId: userB.id, workspaceId: workspaceB, codeHash: "d".repeat(64), expiresAt: new Date(Date.now() + 30_000) }).returning();
    const valid = await testDb.select().from(pairingCodes).where(and(eq(pairingCodes.id, fresh.id), eq(pairingCodes.workspaceId, workspaceA), isNull(pairingCodes.usedAt), gt(pairingCodes.expiresAt, new Date())));
    expect(valid).toHaveLength(0);
    await testDb.update(pairingCodes).set({ usedAt: new Date() }).where(eq(pairingCodes.id, fresh.id));
    const reused = await testDb.select().from(pairingCodes).where(and(eq(pairingCodes.id, fresh.id), eq(pairingCodes.workspaceId, workspaceB), isNull(pairingCodes.usedAt), gt(pairingCodes.expiresAt, new Date())));
    expect(reused).toHaveLength(0);
  });
});

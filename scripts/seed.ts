import { createHash } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import dotenv from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { databaseConnectionString } from "../src/lib/db/connection";
import { campaigns, campaignGroups, contents, devices, groups, postHistory, queueItems, users, workspaces, workspaceMembers } from "../src/lib/db/schema";
import { hashPassword } from "../src/lib/security/password";

async function main() {
  dotenv.config({ path: ".env.local", quiet: true });
  if (process.env.NODE_ENV === "production") throw new Error("Seed sample data only in a development environment.");
  const seedSchema = process.env.SEED_SCHEMA ?? "public";
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(seedSchema)) throw new Error("Invalid seed schema name.");
  const db = drizzle({ client: postgres(databaseConnectionString(), { max: 1, connection: { search_path: seedSchema } }) });

  const password = process.env.SEED_PASSWORD;
  if (!password || password.length < 10) throw new Error("Set SEED_PASSWORD to a development-only value with at least 10 characters.");

  try {
    const people = [{ email: "alex@example.test", name: "Alex Example" }, { email: "sam@example.test", name: "Sam Example" }];
    for (const [personIndex, person] of people.entries()) {
      await db.transaction(async (tx) => {
        await tx.execute(sql.raw(`SET LOCAL search_path TO "${seedSchema}"`));
        const [existing] = await tx.select().from(users).where(eq(users.email, person.email)).limit(1);
        if (existing) return;
        const [user] = await tx.insert(users).values({ email: person.email, displayName: person.name, passwordHash: await hashPassword(password) }).returning();
        const [workspace] = await tx.insert(workspaces).values({ name: "Personal Workspace", ownerId: user.id }).returning();
        await tx.insert(workspaceMembers).values({ workspaceId: workspace.id, userId: user.id, role: "OWNER" });
        const sampleGroups = Array.from({ length: 10 }, (_, index) => ({ workspaceId: workspace.id, createdBy: user.id, name: `Demo Group ${index + 1}`, facebookUrl: `https://www.facebook.com/groups/groupflow-demo-${index + 1}/`, category: index % 2 === 0 ? "Technology" : "Community", status: "ACTIVE" as const }));
        const createdGroups = await tx.insert(groups).values(sampleGroups).returning();
        const createdContent = await tx.insert(contents).values(Array.from({ length: personIndex === 0 ? 3 : 2 }, (_, index) => ({ workspaceId: workspace.id, createdBy: user.id, name: `Demo Caption ${index + 1}`, body: `Example campaign caption ${index + 1}. Review and edit this text before posting.` }))).returning();
        const createdCampaigns = await tx.insert(campaigns).values(Array.from({ length: personIndex === 0 ? 2 : 1 }, (_, index) => ({ workspaceId: workspace.id, createdBy: user.id, contentId: createdContent[index % createdContent.length].id, name: `Demo Campaign ${index + 1}`, status: "READY" as const }))).returning();
        for (const campaign of createdCampaigns) await tx.insert(campaignGroups).values(createdGroups.slice(0, 3).map((group, position) => ({ campaignId: campaign.id, groupId: group.id, position })));
        const campaign = createdCampaigns[0];
        const jobs = await tx.insert(queueItems).values(createdGroups.slice(0, 3).map((group, position) => ({ workspaceId: workspace.id, campaignId: campaign.id, groupId: group.id, position, scheduledAt: new Date(Date.now() + position * 300_000), status: "PENDING" as const }))).returning();
        await tx.insert(postHistory).values({ workspaceId: workspace.id, campaignId: campaign.id, groupId: createdGroups[0].id, queueItemId: jobs[0].id, status: "SKIPPED", notes: "Seed example only." });
        const tokenHash = createHash("sha256").update(`seed-device-${user.id}`).digest("hex");
        await tx.insert(devices).values({ userId: user.id, workspaceId: workspace.id, name: "Demo Chrome Extension", tokenHash, expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000) });
      });
    }

  } finally {
    await db.$client.end({ timeout: 5 });
  }
}
void main().catch(() => {
  console.error("Sample data could not be created. Check the database connection, migrations, and SEED_PASSWORD.");
  process.exitCode = 1;
});




import { T } from "@/components/language-provider";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { campaigns, contents, groups } from "@/lib/db/schema";
import { getIdentity } from "@/lib/auth/session";
import { CampaignsPanel } from "@/components/workspace-panel";

export default async function CampaignsPage() {
  const identity = await getIdentity(); if (!identity) return null;
  const [items, groupItems, contentItems] = await Promise.all([
    db.select({ campaign: campaigns, contentName: contents.name }).from(campaigns).innerJoin(contents, eq(campaigns.contentId, contents.id)).where(eq(campaigns.workspaceId, identity.workspaceId)).orderBy(desc(campaigns.createdAt)).limit(100),
    db.select().from(groups).where(eq(groups.workspaceId, identity.workspaceId)),
    db.select().from(contents).where(eq(contents.workspaceId, identity.workspaceId)).limit(100),
  ]);
  return <main className="content"><div className="page-head"><div><div className="eyebrow"><T>{"Planning"}</T></div><h1><T>{"Campaigns"}</T></h1><p><T>{"Build a queue across selected groups, then start it when ready."}</T></p></div></div><CampaignsPanel initialCampaigns={items} groups={groupItems} contents={contentItems} /></main>;
}

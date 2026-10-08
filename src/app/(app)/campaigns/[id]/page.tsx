import { T } from "@/components/language-provider";
import { and, asc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import Link from "next/link";
import { getIdentity } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { campaigns, campaignGroups, contents, groups, queueItems } from "@/lib/db/schema";
import CampaignDetail from "@/components/campaign-detail";
import { ChevronRightIcon } from "@/components/icons";

export default async function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const identity = await getIdentity();
  if (!identity) return null;
  const { id } = await params;
  const [campaignRow] = await db
    .select({ campaign: campaigns, content: contents })
    .from(campaigns)
    .innerJoin(contents, eq(campaigns.contentId, contents.id))
    .where(and(eq(campaigns.id, id), eq(campaigns.workspaceId, identity.workspaceId)))
    .limit(1);
  if (!campaignRow) notFound();

  const [selectedGroups, queue, availableGroups, availableContents] = await Promise.all([
    db
      .select({ group: groups, position: campaignGroups.position })
      .from(campaignGroups)
      .innerJoin(groups, eq(campaignGroups.groupId, groups.id))
      .where(eq(campaignGroups.campaignId, id))
      .orderBy(asc(campaignGroups.position)),
    db
      .select({ item: queueItems, groupName: groups.name })
      .from(queueItems)
      .innerJoin(groups, eq(queueItems.groupId, groups.id))
      .where(and(eq(queueItems.campaignId, id), eq(queueItems.workspaceId, identity.workspaceId)))
      .orderBy(asc(queueItems.position)),
    db.select().from(groups).where(eq(groups.workspaceId, identity.workspaceId)).orderBy(asc(groups.name)),
    db.select().from(contents).where(eq(contents.workspaceId, identity.workspaceId)).orderBy(asc(contents.name)),
  ]);

  return (
    <main className="content">
      <div className="page-head flex-wrap items-center">
        <div>
          <div className="flex items-center gap-1.5 text-xs text-slate-500 mb-1">
            <Link href="/campaigns" className="hover:text-blue-600 transition-colors">
              <T>{"Campaigns"}</T>
            </Link>
            <ChevronRightIcon className="w-3 h-3 text-slate-400" />
            <span className="text-slate-800 font-semibold">{campaignRow.campaign.name}</span>
          </div>
          <div className="eyebrow">
            <T>{"Campaign"}</T>
          </div>
          <h1>{campaignRow.campaign.name}</h1>
          <p>
            <T>{"Review the selected content, groups, schedule, and queue progress."}</T>
          </p>
        </div>
        <div>
          <Link href="/campaigns" className="button small">
            <T>{"Back to campaigns"}</T>
          </Link>
        </div>
      </div>
      <CampaignDetail
        availableGroups={availableGroups}
        availableContents={availableContents}
        campaign={campaignRow.campaign}
        contentName={campaignRow.content.name}
        contentBody={campaignRow.content.body}
        groups={selectedGroups.map((entry) => ({
          id: entry.group.id,
          name: entry.group.name,
          url: entry.group.facebookUrl,
        }))}
        queue={queue.map((entry) => ({
          id: entry.item.id,
          status: entry.item.status,
          scheduledAt: entry.item.scheduledAt,
          groupName: entry.groupName,
          errorMessage: entry.item.errorMessage,
        }))}
      />
    </main>
  );
}

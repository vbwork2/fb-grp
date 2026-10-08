
import { T } from "@/components/language-provider";
import { and, count, desc, eq, gte, inArray, sql } from "drizzle-orm";
import Link from "next/link";
import { db } from "@/lib/db";
import { campaigns, groups, postHistory, queueItems } from "@/lib/db/schema";
import { getIdentity } from "@/lib/auth/session";

export default async function DashboardPage() {
  const identity = await getIdentity();
  if (!identity) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const [groupCount, activeCampaignCount, pendingCount, postedTodayCount, failedCount, recent, active, progressRows] = await Promise.all([
    db.select({ value: count() }).from(groups).where(eq(groups.workspaceId, identity.workspaceId)),
    db.select({ value: count() }).from(campaigns).where(and(eq(campaigns.workspaceId, identity.workspaceId), eq(campaigns.status, "RUNNING"))),
    db.select({ value: count() }).from(queueItems).where(and(eq(queueItems.workspaceId, identity.workspaceId), inArray(queueItems.status, ["PENDING", "READY", "OPENED", "AWAITING_CONFIRMATION"]))),
    db.select({ value: count() }).from(postHistory).where(and(eq(postHistory.workspaceId, identity.workspaceId), eq(postHistory.status, "POSTED"), gte(postHistory.createdAt, today))),
    db.select({ value: count() }).from(queueItems).where(and(eq(queueItems.workspaceId, identity.workspaceId), eq(queueItems.status, "FAILED"))),
    db.select({ history: postHistory, groupName: groups.name }).from(postHistory).innerJoin(groups, eq(postHistory.groupId, groups.id)).where(eq(postHistory.workspaceId, identity.workspaceId)).orderBy(desc(postHistory.createdAt)).limit(8),
    db.select({ campaign: campaigns }).from(campaigns).where(and(eq(campaigns.workspaceId, identity.workspaceId), eq(campaigns.status, "RUNNING"))).limit(4),
    db.select({ campaignId: queueItems.campaignId, total: count(), posted: sql<number>`count(*) filter (where ${queueItems.status} = 'POSTED')::int` }).from(queueItems).where(eq(queueItems.workspaceId, identity.workspaceId)).groupBy(queueItems.campaignId),
  ]);
  const progress = new Map(progressRows.map((row) => [row.campaignId, { total: row.total, posted: row.posted }]));
  const metrics = [["Total Groups", groupCount[0]?.value ?? 0], ["Active Campaigns", activeCampaignCount[0]?.value ?? 0], ["Pending Posts", pendingCount[0]?.value ?? 0], ["Posted Today", postedTodayCount[0]?.value ?? 0], ["Failed", failedCount[0]?.value ?? 0]];
  return <main className="content"><div className="page-head"><div><div className="eyebrow"><T>{"Overview"}</T></div><h1><T>{"Dashboard"}</T></h1><p><T>{"Your posting workflow at a glance."}</T></p></div></div><section className="cards">{metrics.map(([label, value]) => <article key={label} className="card"><div className="card-label"><T>{label}</T></div><div className="card-value">{value}</div><div className="card-note"><T>{"Current workspace"}</T></div></article>)}</section><section className="panel"><div className="panel-head"><h2><T>{"Active campaigns"}</T></h2><Link href="/campaigns" className="muted"><T>{"View campaigns"}</T></Link></div>{active.length === 0 ? <div className="empty"><strong><T>{"No active campaigns."}</T></strong><T>{"Create a campaign and start its queue when you are ready."}</T></div> : active.map(({ campaign }) => { const item = progress.get(campaign.id) ?? { total: 0, posted: 0 }; const percent = item.total ? Math.round(item.posted / item.total * 100) : 0; return <div key={campaign.id} style={{ padding: 19, borderBottom: "1px solid var(--line)" }}><div className="row"><strong>{campaign.name}</strong><span className="badge green"><T>{"RUNNING"}</T></span></div><p className="muted">{item.posted} / {item.total}<T>{" groups completed · "}</T>{percent}%</p><div className="progress"><span style={{ width: `${percent}%` }} /></div></div>; })}</section><section className="panel"><div className="panel-head"><h2><T>{"Recent activity"}</T></h2></div>{recent.length === 0 ? <div className="empty"><strong><T>{"No activity yet."}</T></strong><T>{"Posted, skipped, and failed jobs will appear here."}</T></div> : <div className="table-wrap"><table><thead><tr><th><T>{"Group"}</T></th><th><T>{"Status"}</T></th><th><T>{"When"}</T></th><th><T>{"Notes"}</T></th></tr></thead><tbody>{recent.map(({ history, groupName }) => <tr key={history.id}><td>{groupName}</td><td><span className={`badge ${history.status === "POSTED" ? "green" : history.status === "FAILED" ? "red" : "amber"}`}><T>{history.status}</T></span></td><td>{new Date(history.createdAt).toLocaleString()}</td><td>{history.notes ?? "—"}</td></tr>)}</tbody></table></div>}</section></main>;
}

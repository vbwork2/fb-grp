
import { T } from "@/components/language-provider";
import { and, asc, count, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { campaigns, groups, queueItems } from "@/lib/db/schema";
import { getIdentity } from "@/lib/auth/session";

export default async function QueuePage({ searchParams }: { searchParams: Promise<{ page?: string; campaignId?: string; groupId?: string; status?: string }> }) {
  const identity = await getIdentity(); if (!identity) return null;
  const params = await searchParams;
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const pageSize = 25;
  const conditions = [eq(queueItems.workspaceId, identity.workspaceId)];
  if (params.campaignId) conditions.push(eq(queueItems.campaignId, params.campaignId));
  if (params.groupId) conditions.push(eq(queueItems.groupId, params.groupId));
  if (["PENDING", "READY", "OPENED", "AWAITING_CONFIRMATION", "POSTED", "SKIPPED", "FAILED"].includes(params.status ?? "")) conditions.push(eq(queueItems.status, params.status as typeof queueItems.$inferSelect.status));
  const where = and(...conditions);
  const [rows, totalRows, campaignOptions, groupOptions] = await Promise.all([
    db.select({ job: queueItems, groupName: groups.name, groupUrl: groups.facebookUrl, campaignName: campaigns.name }).from(queueItems).innerJoin(groups, eq(queueItems.groupId, groups.id)).innerJoin(campaigns, eq(queueItems.campaignId, campaigns.id)).where(where).orderBy(asc(queueItems.scheduledAt)).limit(pageSize).offset((page - 1) * pageSize),
    db.select({ value: count() }).from(queueItems).where(where),
    db.select({ id: campaigns.id, name: campaigns.name }).from(campaigns).where(eq(campaigns.workspaceId, identity.workspaceId)).orderBy(asc(campaigns.name)),
    db.select({ id: groups.id, name: groups.name }).from(groups).where(eq(groups.workspaceId, identity.workspaceId)).orderBy(asc(groups.name)),
  ]);
  const total = totalRows[0]?.value ?? 0;
  const filterParams = new URLSearchParams(); if (params.campaignId) filterParams.set("campaignId", params.campaignId); if (params.groupId) filterParams.set("groupId", params.groupId); if (params.status) filterParams.set("status", params.status);
  function pageUrl(target: number) { const query = new URLSearchParams(filterParams); query.set("page", String(target)); return `/queue?${query.toString()}`; }
  return <main className="content"><div className="page-head"><div><div className="eyebrow"><T>{"Workflow"}</T></div><h1><T>{"Queue"}</T></h1><p><T>{"Scheduled jobs appear here. The extension opens one group at a time."}</T></p></div></div><div className="panel"><div className="panel-head"><h2><T>{"Queue items"}</T></h2><span className="muted">{total}<T>{" items"}</T></span></div><form method="get" className="filters" style={{ padding: "0 20px 16px" }}><label><T>{"Campaign"}</T><select name="campaignId" defaultValue={params.campaignId ?? ""}><option value=""><T>{"All campaigns"}</T></option>{campaignOptions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label><T>{"Group"}</T><select name="groupId" defaultValue={params.groupId ?? ""}><option value=""><T>{"All groups"}</T></option>{groupOptions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label><T>{"Status"}</T><select name="status" defaultValue={params.status ?? ""}><option value=""><T>{"All statuses"}</T></option>{["PENDING", "READY", "OPENED", "AWAITING_CONFIRMATION", "POSTED", "SKIPPED", "FAILED"].map((status) => <option value={status} key={status}><T>{status}</T></option>)}</select></label><button className="button small"><T>{"Filter"}</T></button></form>{rows.length === 0 ? <div className="empty"><strong><T>{total ? "No queue items on this page." : "Your queue is empty."}</T></strong><T>{total ? "Try another page or change the filters." : "Create a campaign and start it to generate queue items."}</T></div> : <div className="table-wrap"><table><thead><tr><th><T>{"Campaign"}</T></th><th><T>{"Group"}</T></th><th><T>{"Status"}</T></th><th><T>{"Scheduled"}</T></th><th><T>{"Attempts"}</T></th></tr></thead><tbody>{rows.map(({ job, groupName, groupUrl, campaignName }) => <tr key={job.id}><td>{campaignName}</td><td><a href={groupUrl} target="_blank" rel="noreferrer">{groupName}</a></td><td><span className={`badge ${job.status === "POSTED" ? "green" : job.status === "FAILED" ? "red" : "amber"}`}><T>{job.status}</T></span></td><td>{new Date(job.scheduledAt).toLocaleString()}</td><td>{job.attemptCount}</td></tr>)}</tbody></table></div>}<div className="pagination"><span className="muted"><T>{"Page "}</T>{page}<T>{" of "}</T>{Math.max(1, Math.ceil(total / pageSize))}</span><div className="buttons">{page > 1 && <a className="button small" href={pageUrl(page - 1)}><T>{"Previous"}</T></a>}{page * pageSize < total && <a className="button small" href={pageUrl(page + 1)}><T>{"Next"}</T></a>}</div></div></div></main>;
}

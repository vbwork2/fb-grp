
import { T } from "@/components/language-provider";
import { and, count, desc, eq, gte, lte } from "drizzle-orm";
import { db } from "@/lib/db";
import { campaigns, groups, postHistory } from "@/lib/db/schema";
import { getIdentity } from "@/lib/auth/session";
import ExportHistory from "@/components/export-history";

export default async function HistoryPage({ searchParams }: { searchParams: Promise<{ page?: string; campaignId?: string; groupId?: string; status?: string; from?: string; to?: string }> }) {
  const identity = await getIdentity(); if (!identity) return null;
  const params = await searchParams;
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const pageSize = 25;
  const conditions = [eq(postHistory.workspaceId, identity.workspaceId)];
  if (params.campaignId) conditions.push(eq(postHistory.campaignId, params.campaignId));
  if (params.groupId) conditions.push(eq(postHistory.groupId, params.groupId));
  if (["POSTED", "SKIPPED", "FAILED"].includes(params.status ?? "")) conditions.push(eq(postHistory.status, params.status as typeof postHistory.$inferSelect.status));
  const from = params.from && !Number.isNaN(Date.parse(params.from)) ? new Date(params.from) : null;
  const to = params.to && !Number.isNaN(Date.parse(params.to)) ? new Date(`${params.to}T23:59:59.999`) : null;
  if (from) conditions.push(gte(postHistory.createdAt, from));
  if (to) conditions.push(lte(postHistory.createdAt, to));
  const where = and(...conditions);
  const [rows, totalRows, campaignOptions, groupOptions] = await Promise.all([
    db.select({ history: postHistory, groupName: groups.name, campaignName: campaigns.name }).from(postHistory).innerJoin(groups, eq(postHistory.groupId, groups.id)).innerJoin(campaigns, eq(postHistory.campaignId, campaigns.id)).where(where).orderBy(desc(postHistory.createdAt)).limit(pageSize).offset((page - 1) * pageSize),
    db.select({ value: count() }).from(postHistory).where(where),
    db.select({ id: campaigns.id, name: campaigns.name }).from(campaigns).where(eq(campaigns.workspaceId, identity.workspaceId)).orderBy(desc(campaigns.createdAt)),
    db.select({ id: groups.id, name: groups.name }).from(groups).where(eq(groups.workspaceId, identity.workspaceId)).orderBy(desc(groups.createdAt)),
  ]);
  const total = totalRows[0]?.value ?? 0;
  const filterParams = new URLSearchParams();
  for (const key of ["campaignId", "groupId", "status", "from", "to"] as const) if (params[key]) filterParams.set(key, params[key]!);
  function pageUrl(target: number) { const query = new URLSearchParams(filterParams); query.set("page", String(target)); return `/history?${query.toString()}`; }
  return <main className="content"><div className="page-head"><div><div className="eyebrow"><T>{"Activity"}</T></div><h1><T>{"History"}</T></h1><p><T>{"Review the outcomes you confirmed from the extension."}</T></p></div><ExportHistory /></div><div className="panel"><div className="panel-head"><h2><T>{"Posting history"}</T></h2><span className="muted">{total}<T>{" records"}</T></span></div><form method="get" className="filters" style={{ padding: "0 20px 16px" }}><label><T>{"Campaign"}</T><select name="campaignId" defaultValue={params.campaignId ?? ""}><option value=""><T>{"All campaigns"}</T></option>{campaignOptions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label><T>{"Group"}</T><select name="groupId" defaultValue={params.groupId ?? ""}><option value=""><T>{"All groups"}</T></option>{groupOptions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label><T>{"Status"}</T><select name="status" defaultValue={params.status ?? ""}><option value=""><T>{"All statuses"}</T></option>{["POSTED", "SKIPPED", "FAILED"].map((status) => <option value={status} key={status}><T>{status}</T></option>)}</select></label><label><T>{"From"}</T><input type="date" name="from" defaultValue={params.from ?? ""} /></label><label><T>{"To"}</T><input type="date" name="to" defaultValue={params.to ?? ""} /></label><button className="button small"><T>{"Filter"}</T></button></form>{rows.length === 0 ? <div className="empty"><strong><T>{total ? "No history records on this page." : "No posting history yet."}</T></strong><T>{total ? "Try another page or change the filters." : "Confirm a post or skip a queue item from the extension."}</T></div> : <div className="table-wrap"><table><thead><tr><th><T>{"Campaign"}</T></th><th><T>{"Group"}</T></th><th><T>{"Status"}</T></th><th><T>{"Posted at"}</T></th><th><T>{"Facebook post"}</T></th><th><T>{"Notes"}</T></th></tr></thead><tbody>{rows.map(({ history, groupName, campaignName }) => <tr key={history.id}><td>{campaignName}</td><td>{groupName}</td><td><span className={`badge ${history.status === "POSTED" ? "green" : history.status === "FAILED" ? "red" : "amber"}`}><T>{history.status}</T></span></td><td>{history.postedAt ? new Date(history.postedAt).toLocaleString() : "—"}</td><td>{history.facebookPostUrl ? <a href={history.facebookPostUrl} target="_blank" rel="noreferrer"><T>{"Open post"}</T></a> : "—"}</td><td>{history.notes ?? "—"}</td></tr>)}</tbody></table></div>}<div className="pagination"><span className="muted"><T>{"Page "}</T>{page}<T>{" of "}</T>{Math.max(1, Math.ceil(total / pageSize))}</span><div className="buttons">{page > 1 && <a className="button small" href={pageUrl(page - 1)}><T>{"Previous"}</T></a>}{page * pageSize < total && <a className="button small" href={pageUrl(page + 1)}><T>{"Next"}</T></a>}</div></div></div></main>;
}

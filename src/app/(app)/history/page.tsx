import { T } from "@/components/language-provider";
import { and, count, desc, eq, gte, lte } from "drizzle-orm";
import { db } from "@/lib/db";
import { campaigns, groups, postHistory } from "@/lib/db/schema";
import { getIdentity } from "@/lib/auth/session";
import ExportHistory from "@/components/export-history";
import { HistoryIcon, ExternalLinkIcon } from "@/components/icons";

export default async function HistoryPage({
  searchParams,
}: {
  searchParams: Promise<{
    page?: string;
    campaignId?: string;
    groupId?: string;
    status?: string;
    from?: string;
    to?: string;
  }>;
}) {
  const identity = await getIdentity();
  if (!identity) return null;

  const params = await searchParams;
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const pageSize = 25;
  const conditions = [eq(postHistory.workspaceId, identity.workspaceId)];

  if (params.campaignId) conditions.push(eq(postHistory.campaignId, params.campaignId));
  if (params.groupId) conditions.push(eq(postHistory.groupId, params.groupId));
  if (["POSTED", "SKIPPED", "FAILED"].includes(params.status ?? "")) {
    conditions.push(eq(postHistory.status, params.status as typeof postHistory.$inferSelect.status));
  }

  const from = params.from && !Number.isNaN(Date.parse(params.from)) ? new Date(params.from) : null;
  const to =
    params.to && !Number.isNaN(Date.parse(params.to)) ? new Date(`${params.to}T23:59:59.999`) : null;
  if (from) conditions.push(gte(postHistory.createdAt, from));
  if (to) conditions.push(lte(postHistory.createdAt, to));
  const where = and(...conditions);

  const [rows, totalRows, campaignOptions, groupOptions] = await Promise.all([
    db
      .select({
        history: postHistory,
        groupName: groups.name,
        campaignName: campaigns.name,
      })
      .from(postHistory)
      .innerJoin(groups, eq(postHistory.groupId, groups.id))
      .innerJoin(campaigns, eq(postHistory.campaignId, campaigns.id))
      .where(where)
      .orderBy(desc(postHistory.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ value: count() }).from(postHistory).where(where),
    db
      .select({ id: campaigns.id, name: campaigns.name })
      .from(campaigns)
      .where(eq(campaigns.workspaceId, identity.workspaceId))
      .orderBy(desc(campaigns.createdAt)),
    db
      .select({ id: groups.id, name: groups.name })
      .from(groups)
      .where(eq(groups.workspaceId, identity.workspaceId))
      .orderBy(desc(groups.createdAt)),
  ]);

  const total = totalRows[0]?.value ?? 0;
  const filterParams = new URLSearchParams();
  for (const key of ["campaignId", "groupId", "status", "from", "to"] as const) {
    if (params[key]) filterParams.set(key, params[key]!);
  }

  function pageUrl(target: number) {
    const query = new URLSearchParams(filterParams);
    query.set("page", String(target));
    return `/history?${query.toString()}`;
  }

  return (
    <main className="content">
      <div className="page-head flex-wrap items-center">
        <div>
          <div className="eyebrow">
            <T>{"Activity"}</T>
          </div>
          <h1>
            <T>{"History"}</T>
          </h1>
          <p>
            <T>{"Review the outcomes you confirmed from the extension."}</T>
          </p>
        </div>
        <ExportHistory />
      </div>

      <div className="panel">
        <div className="panel-head">
          <div className="flex items-center gap-2">
            <HistoryIcon className="w-4 h-4 text-blue-600" />
            <h2>
              <T>{"Posting history"}</T>
            </h2>
          </div>
          <span className="badge blue text-xs font-semibold">
            {total} <T>{" records"}</T>
          </span>
        </div>

        <form method="get" className="filters p-5 bg-slate-50/50 border-b border-slate-100">
          <label>
            <T>{"Campaign"}</T>
            <select name="campaignId" defaultValue={params.campaignId ?? ""}>
              <option value="">
                <T>{"All campaigns"}</T>
              </option>
              {campaignOptions.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <T>{"Group"}</T>
            <select name="groupId" defaultValue={params.groupId ?? ""}>
              <option value="">
                <T>{"All groups"}</T>
              </option>
              {groupOptions.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <T>{"Status"}</T>
            <select name="status" defaultValue={params.status ?? ""}>
              <option value="">
                <T>{"All statuses"}</T>
              </option>
              {["POSTED", "SKIPPED", "FAILED"].map((status) => (
                <option value={status} key={status}>
                  <T>{status}</T>
                </option>
              ))}
            </select>
          </label>
          <label>
            <T>{"From"}</T>
            <input type="date" name="from" defaultValue={params.from ?? ""} />
          </label>
          <label>
            <T>{"To"}</T>
            <input type="date" name="to" defaultValue={params.to ?? ""} />
          </label>
          <button className="button small primary">
            <T>{"Filter"}</T>
          </button>
        </form>

        {rows.length === 0 ? (
          <div className="empty">
            <div className="w-12 h-12 rounded-full bg-slate-50 border border-slate-200 flex items-center justify-center mb-3">
              <HistoryIcon className="w-6 h-6 text-slate-400" />
            </div>
            <strong>
              <T>{total ? "No history records on this page." : "No posting history yet."}</T>
            </strong>
            <p className="max-w-md text-sm text-slate-500 m-0">
              <T>
                {total
                  ? "Try another page or change the filters."
                  : "Confirm a post or skip a queue item from the extension."}
              </T>
            </p>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>
                    <T>{"Campaign"}</T>
                  </th>
                  <th>
                    <T>{"Group"}</T>
                  </th>
                  <th>
                    <T>{"Status"}</T>
                  </th>
                  <th>
                    <T>{"Posted at"}</T>
                  </th>
                  <th>
                    <T>{"Facebook post"}</T>
                  </th>
                  <th>
                    <T>{"Notes"}</T>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ history, groupName, campaignName }) => (
                  <tr key={history.id}>
                    <td className="font-semibold text-slate-900">{campaignName}</td>
                    <td>{groupName}</td>
                    <td>
                      <span
                        className={`badge ${
                          history.status === "POSTED" && !history.notes?.startsWith("Automatic submission (unverified).")
                            ? "green"
                            : history.status === "FAILED"
                            ? "red"
                            : "amber"
                        }`}
                      >
                        <T>{history.notes?.startsWith("Automatic submission (unverified).") ? "Submitted (unverified)" : history.status}</T>
                      </span>
                    </td>
                    <td className="text-slate-500 text-xs">
                      {history.postedAt ? new Date(history.postedAt).toLocaleString() : "—"}
                    </td>
                    <td>
                      {history.facebookPostUrl ? (
                        <a
                          href={history.facebookPostUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-700 text-xs font-medium"
                        >
                          <span><T>{"Open post"}</T></span>
                          <ExternalLinkIcon className="w-3 h-3 text-slate-400" />
                        </a>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="text-slate-500 text-xs max-w-xs truncate">{history.notes ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="pagination">
          <span className="muted text-xs">
            <T>{"Page "}</T>
            <strong className="text-slate-800">{page}</strong>
            <T>{" of "}</T>
            <strong className="text-slate-800">{Math.max(1, Math.ceil(total / pageSize))}</strong>
          </span>
          <div className="buttons">
            {page > 1 && (
              <a className="button small" href={pageUrl(page - 1)}>
                <T>{"Previous"}</T>
              </a>
            )}
            {page * pageSize < total && (
              <a className="button small" href={pageUrl(page + 1)}>
                <T>{"Next"}</T>
              </a>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}

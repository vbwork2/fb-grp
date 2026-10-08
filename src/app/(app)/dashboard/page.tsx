import { T } from "@/components/language-provider";
import { and, count, desc, eq, gte, inArray, sql } from "drizzle-orm";
import Link from "next/link";
import { db } from "@/lib/db";
import { campaigns, groups, postHistory, queueItems } from "@/lib/db/schema";
import { getIdentity } from "@/lib/auth/session";
import {
  GroupsIcon,
  CampaignIcon,
  QueueIcon,
  CheckIcon,
  AlertCircleIcon,
  PlusIcon,
  ChevronRightIcon,
  HistoryIcon,
} from "@/components/icons";

export default async function DashboardPage() {
  const identity = await getIdentity();
  if (!identity) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [
    groupCount,
    activeCampaignCount,
    pendingCount,
    postedTodayCount,
    failedCount,
    recent,
    active,
    progressRows,
  ] = await Promise.all([
    db.select({ value: count() }).from(groups).where(eq(groups.workspaceId, identity.workspaceId)),
    db
      .select({ value: count() })
      .from(campaigns)
      .where(and(eq(campaigns.workspaceId, identity.workspaceId), eq(campaigns.status, "RUNNING"))),
    db
      .select({ value: count() })
      .from(queueItems)
      .where(
        and(
          eq(queueItems.workspaceId, identity.workspaceId),
          inArray(queueItems.status, ["PENDING", "READY", "OPENED", "AWAITING_CONFIRMATION"])
        )
      ),
    db
      .select({ value: count() })
      .from(postHistory)
      .where(
        and(
          eq(postHistory.workspaceId, identity.workspaceId),
          eq(postHistory.status, "POSTED"),
          gte(postHistory.createdAt, today)
        )
      ),
    db
      .select({ value: count() })
      .from(queueItems)
      .where(and(eq(queueItems.workspaceId, identity.workspaceId), eq(queueItems.status, "FAILED"))),
    db
      .select({ history: postHistory, groupName: groups.name })
      .from(postHistory)
      .innerJoin(groups, eq(postHistory.groupId, groups.id))
      .where(eq(postHistory.workspaceId, identity.workspaceId))
      .orderBy(desc(postHistory.createdAt))
      .limit(8),
    db
      .select({ campaign: campaigns })
      .from(campaigns)
      .where(and(eq(campaigns.workspaceId, identity.workspaceId), eq(campaigns.status, "RUNNING")))
      .limit(4),
    db
      .select({
        campaignId: queueItems.campaignId,
        total: count(),
        posted: sql<number>`count(*) filter (where ${queueItems.status} = 'POSTED')::int`,
      })
      .from(queueItems)
      .where(eq(queueItems.workspaceId, identity.workspaceId))
      .groupBy(queueItems.campaignId),
  ]);

  const progress = new Map(progressRows.map((row) => [row.campaignId, { total: row.total, posted: row.posted }]));

  const metricCards = [
    {
      label: "Total Groups",
      value: groupCount[0]?.value ?? 0,
      icon: GroupsIcon,
      color: "text-blue-600 bg-blue-50 border-blue-100",
      href: "/groups",
    },
    {
      label: "Active Campaigns",
      value: activeCampaignCount[0]?.value ?? 0,
      icon: CampaignIcon,
      color: "text-indigo-600 bg-indigo-50 border-indigo-100",
      href: "/campaigns",
    },
    {
      label: "Pending Posts",
      value: pendingCount[0]?.value ?? 0,
      icon: QueueIcon,
      color: "text-amber-600 bg-amber-50 border-amber-100",
      href: "/queue",
    },
    {
      label: "Posted Today",
      value: postedTodayCount[0]?.value ?? 0,
      icon: CheckIcon,
      color: "text-emerald-600 bg-emerald-50 border-emerald-100",
      href: "/history",
    },
    {
      label: "Failed",
      value: failedCount[0]?.value ?? 0,
      icon: AlertCircleIcon,
      color: "text-rose-600 bg-rose-50 border-rose-100",
      href: "/queue?status=FAILED",
    },
  ];

  return (
    <main className="content">
      <div className="page-head">
        <div>
          <div className="eyebrow">
            <T>{"Overview"}</T>
          </div>
          <h1>
            <T>{"Dashboard"}</T>
          </h1>
          <p>
            <T>{"Your posting workflow at a glance."}</T>
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/campaigns" className="button primary">
            <PlusIcon className="w-4 h-4" />
            <span><T>{"New campaign"}</T></span>
          </Link>
        </div>
      </div>

      <section className="cards" aria-label="Summary Metrics">
        {metricCards.map(({ label, value, icon: Icon, color, href }) => (
          <Link key={label} href={href} className="card group block">
            <div className="flex items-start justify-between">
              <div className="card-label">
                <T>{label}</T>
              </div>
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center border ${color}`}>
                <Icon className="w-4 h-4" />
              </div>
            </div>
            <div className="card-value">{value}</div>
            <div className="card-note flex items-center justify-between">
              <span><T>{"Current workspace"}</T></span>
              <ChevronRightIcon className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 transition-opacity text-slate-400" />
            </div>
          </Link>
        ))}
      </section>

      <section className="panel">
        <div className="panel-head">
          <div className="flex items-center gap-2">
            <CampaignIcon className="w-4 h-4 text-blue-600" />
            <h2>
              <T>{"Active campaigns"}</T>
            </h2>
          </div>
          <Link href="/campaigns" className="muted text-xs font-semibold hover:text-blue-600 transition-colors flex items-center gap-1">
            <span><T>{"View campaigns"}</T></span>
            <ChevronRightIcon className="w-3.5 h-3.5" />
          </Link>
        </div>
        {active.length === 0 ? (
          <div className="empty">
            <div className="w-12 h-12 rounded-full bg-slate-50 border border-slate-200 flex items-center justify-center mb-3">
              <CampaignIcon className="w-6 h-6 text-slate-400" />
            </div>
            <strong>
              <T>{"No active campaigns."}</T>
            </strong>
            <p className="max-w-md text-sm text-slate-500 m-0 mb-4">
              <T>{"Create a campaign and start its queue when you are ready."}</T>
            </p>
            <Link href="/campaigns" className="button small primary">
              <PlusIcon className="w-3.5 h-3.5" />
              <span><T>{"New campaign"}</T></span>
            </Link>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {active.map(({ campaign }) => {
              const item = progress.get(campaign.id) ?? { total: 0, posted: 0 };
              const percent = item.total ? Math.round((item.posted / item.total) * 100) : 0;
              return (
                <div key={campaign.id} className="p-5 hover:bg-slate-50/50 transition-colors">
                  <div className="row mb-2">
                    <Link
                      href={`/campaigns/${campaign.id}`}
                      className="text-sm font-semibold text-slate-900 hover:text-blue-600 transition-colors flex items-center gap-2"
                    >
                      <span>{campaign.name}</span>
                      <ChevronRightIcon className="w-3.5 h-3.5 text-slate-400" />
                    </Link>
                    <span className="badge green">
                      <T>{"RUNNING"}</T>
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs text-slate-500 mb-2">
                    <span>
                      {item.posted} / {item.total}
                      <T>{" groups completed · "}</T>
                      {percent}%
                    </span>
                  </div>
                  <div className="progress">
                    <span style={{ width: `${percent}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="panel">
        <div className="panel-head">
          <div className="flex items-center gap-2">
            <HistoryIcon className="w-4 h-4 text-slate-600" />
            <h2>
              <T>{"Recent activity"}</T>
            </h2>
          </div>
          <Link href="/history" className="muted text-xs font-semibold hover:text-blue-600 transition-colors flex items-center gap-1">
            <span><T>{"View all"}</T></span>
            <ChevronRightIcon className="w-3.5 h-3.5" />
          </Link>
        </div>
        {recent.length === 0 ? (
          <div className="empty">
            <div className="w-12 h-12 rounded-full bg-slate-50 border border-slate-200 flex items-center justify-center mb-3">
              <HistoryIcon className="w-6 h-6 text-slate-400" />
            </div>
            <strong>
              <T>{"No activity yet."}</T>
            </strong>
            <p className="max-w-md text-sm text-slate-500 m-0">
              <T>{"Posted, skipped, and failed jobs will appear here."}</T>
            </p>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>
                    <T>{"Group"}</T>
                  </th>
                  <th>
                    <T>{"Status"}</T>
                  </th>
                  <th>
                    <T>{"When"}</T>
                  </th>
                  <th>
                    <T>{"Notes"}</T>
                  </th>
                </tr>
              </thead>
              <tbody>
                {recent.map(({ history, groupName }) => (
                  <tr key={history.id}>
                    <td className="font-medium text-slate-900">{groupName}</td>
                    <td>
                      <span
                        className={`badge ${
                          history.status === "POSTED" && !history.notes?.startsWith("Automatic submission (unverified).") ? "green" : history.status === "FAILED" ? "red" : "amber"
                        }`}
                      >
                        <T>{history.notes?.startsWith("Automatic submission (unverified).") ? "Submitted (unverified)" : history.status}</T>
                      </span>
                    </td>
                    <td className="text-slate-500 text-xs">
                      {new Date(history.createdAt).toLocaleString()}
                    </td>
                    <td className="text-slate-500 text-xs">{history.notes ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}

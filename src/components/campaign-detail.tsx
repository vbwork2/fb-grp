"use client";

import { ActionButton } from "@/components/loading";

import { T } from "@/components/language-provider";
import { useState } from "react";
import { useRouter } from "next/navigation";
import DeleteCampaignButton from "@/components/delete-campaign-button";
import CampaignEditor from "@/components/campaign-editor";
import {
  PlayIcon,
  PauseIcon,
  RefreshIcon,
  ExternalLinkIcon,
  AlertCircleIcon,
  CheckIcon,
  QueueIcon,
} from "@/components/icons";

type QueueEntry = {
  id: string;
  status: string;
  scheduledAt: Date | string;
  groupName: string;
  errorMessage: string | null;
};
type CampaignData = {
  contentId: string;
  id: string;
  name: string;
  status: string;
  minIntervalSeconds: number;
  maxIntervalSeconds: number;
};

export default function CampaignDetail({
  campaign,
  availableGroups,
  availableContents,
  contentName,
  contentBody,
  groups,
  queue: initialQueue,
}: {
  campaign: CampaignData;
  availableGroups: { id: string; name: string; facebookUrl: string; status: string }[];
  availableContents: { id: string; name: string; body: string; linkUrl: string | null }[];
  contentName: string;
  contentBody: string;
  groups: { id: string; name: string; url: string }[];
  queue: QueueEntry[];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [status, setStatus] = useState(campaign.status);
  const queue = initialQueue;
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const posted = queue.filter((item) => item.status === "POSTED").length;
  const failed = queue.filter((item) => item.status === "FAILED").length;
  const progress = queue.length ? Math.round((posted / queue.length) * 100) : 0;

  async function action(actionName: "start" | "pause" | "resume" | "cancel" | "retry") {
    setBusy(true);
    setError("");
    setMessage("");
    const method = actionName === "start" || actionName === "retry" ? "POST" : "PATCH";
    const path =
      actionName === "start" || actionName === "retry"
        ? `/api/campaigns/${campaign.id}/${actionName}`
        : `/api/campaigns/${campaign.id}`;
    try {
      const response = await fetch(path, {
        method,
        headers: { "content-type": "application/json" },
        body:
          method === "POST"
            ? "{}"
            : JSON.stringify({
                status: actionName === "pause" ? "PAUSED" : actionName === "resume" ? "RUNNING" : "CANCELLED",
              }),
      });
      const result = (await response.json()) as {
        data?: { status?: string; retried?: number };
        error?: { message: string };
      };
      if (!response.ok) {
        setError(result.error?.message ?? "Campaign action failed.");
        return;
      }
      if (actionName === "retry") {
        setStatus("RUNNING");
        setMessage(`${result.data?.retried ?? 0} failed jobs returned to the queue.`);
      } else {
        const updated = actionName === "start" ? "RUNNING" : result.data?.status ?? status;
        setStatus(updated);
        setMessage(`Campaign ${updated.toLowerCase()}.`);
      }
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Campaign action failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="panel">
        <div className="panel-head"><h2><T>{"Campaign settings"}</T></h2><ActionButton type="button" className="button" disabled={busy || !["READY", "PAUSED"].includes(status)} onClick={() => setEditing((current) => !current)} aria-expanded={editing}><T>{"Edit campaign"}</T></ActionButton></div>
        {!["READY", "PAUSED"].includes(status) && <p className="muted" style={{ padding: "0 20px 20px" }}><T>{"Pause the campaign before editing. Completed or cancelled campaigns cannot be edited."}</T></p>}
      </div>
      {editing && ["READY", "PAUSED"].includes(status) && <CampaignEditor campaign={campaign} selectedGroupIds={groups.map((group) => group.id)} availableGroups={availableGroups} availableContents={availableContents} onClose={() => setEditing(false)} />}
      {/* Metric summary cards */}
      <div className="cards">
        <section className="card">
          <div className="card-label">
            <T>{"Campaign status"}</T>
          </div>
          <div style={{ marginTop: 14 }}>
            <span
              className={`badge ${
                status === "RUNNING" ? "green" : status === "CANCELLED" ? "red" : "amber"
              } text-xs px-3 py-1 font-semibold`}
            >
              <T>{status}</T>
            </span>
          </div>
          <div className="card-note">
            <T>{"Current state"}</T>
          </div>
        </section>

        <section className="card">
          <div className="flex items-center justify-between">
            <div className="card-label">
              <T>{"Posted"}</T>
            </div>
            <CheckIcon className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="card-value">
            {posted} / {queue.length}
          </div>
          <div className="card-note">
            <T>{"Target groups reached"}</T>
          </div>
        </section>

        <section className="card">
          <div className="flex items-center justify-between">
            <div className="card-label">
              <T>{"Progress"}</T>
            </div>
            <span className="text-xs font-semibold text-blue-600">{progress}%</span>
          </div>
          <div className="card-value">{progress}%</div>
          <div className="progress mt-2">
            <span style={{ width: `${progress}%` }} />
          </div>
        </section>

        <section className="card">
          <div className="flex items-center justify-between">
            <div className="card-label">
              <T>{"Failed"}</T>
            </div>
            <AlertCircleIcon className="w-4 h-4 text-rose-600" />
          </div>
          <div className="card-value text-rose-600">{failed}</div>
          <div className="card-note">
            <T>{"Errors requiring retry"}</T>
          </div>
        </section>
      </div>

      {/* Action Control Panel */}
      <div className="panel">
        <div className="panel-head flex-wrap">
          <div className="flex items-center gap-2">
            <h2>
              <T>{"Actions"}</T>
            </h2>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <DeleteCampaignButton id={campaign.id} name={campaign.name} disabled={busy || status === "RUNNING" || queue.some((item) => ["OPENED", "AWAITING_CONFIRMATION"].includes(item.status))} />
            {status === "READY" && (
              <ActionButton
                type="button"
                className="button primary"
                disabled={busy}
                onClick={() => action("start")}
              >
                <PlayIcon className="w-3.5 h-3.5" />
                <span><T>{"Start"}</T></span>
              </ActionButton>
            )}
            {status === "RUNNING" && (
              <ActionButton
                type="button"
                className="button"
                disabled={busy}
                onClick={() => action("pause")}
              >
                <PauseIcon className="w-3.5 h-3.5" />
                <span><T>{"Pause"}</T></span>
              </ActionButton>
            )}
            {status === "PAUSED" && (
              <ActionButton
                type="button"
                className="button primary"
                disabled={busy}
                onClick={() => action("resume")}
              >
                <PlayIcon className="w-3.5 h-3.5" />
                <span><T>{"Resume"}</T></span>
              </ActionButton>
            )}
            {failed > 0 && (
              <ActionButton
                type="button"
                className="button"
                disabled={busy}
                onClick={() => action("retry")}
              >
                <RefreshIcon className="w-3.5 h-3.5" />
                <span><T>{"Retry failed"}</T></span>
              </ActionButton>
            )}
            {["READY", "RUNNING", "PAUSED"].includes(status) && (
              <ActionButton
                type="button"
                className="button danger"
                disabled={busy}
                onClick={() => action("cancel")}
              >
                <T>{"Cancel"}</T>
              </ActionButton>
            )}
          </div>
        </div>

        <div style={{ padding: 20 }} className="space-y-4">
          <div className="notice flex items-start gap-3">
            <span className="text-emerald-700 text-base">ℹ</span>
            <p className="m-0 leading-relaxed">
              <T>
                To post across groups, start this campaign in Groupflow. The extension prepares each post; you click Post in Facebook and verified successes move to the next group.
              </T>
            </p>
          </div>

          {message && (
            <div className="p-3 bg-blue-50 border border-blue-200 text-blue-900 rounded-lg text-sm" role="status">
              <T>{message}</T>
            </div>
          )}

          {error && (
            <p className="error" role="alert">
              <AlertCircleIcon className="w-4 h-4 flex-shrink-0" />
              <span><T>{error}</T></span>
            </p>
          )}

          <div>
            <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
              <span><T>{"Queue completion"}</T></span>
              <span className="font-semibold">{progress}%</span>
            </div>
            <div className="progress">
              <span style={{ width: `${progress}%` }} />
            </div>
          </div>

          <p className="muted text-xs">
            <T>{"Interval: "}</T>
            <strong className="text-slate-800">{campaign.minIntervalSeconds}</strong>
            <T>{" to "}</T>
            <strong className="text-slate-800">{campaign.maxIntervalSeconds}</strong>
            <T>{" seconds."}</T>
          </p>
        </div>
      </div>

      {/* Content Preview */}
      <div className="panel">
        <div className="panel-head">
          <div className="flex items-center gap-2">
            <h2>
              <T>{"Content"}</T>
            </h2>
          </div>
          <span className="text-xs font-semibold text-slate-500 bg-slate-100 px-2.5 py-0.5 rounded-full">
            {contentName}
          </span>
        </div>
        <article style={{ padding: 22 }} className="bg-slate-50/50">
          <div className="max-w-2xl bg-white border border-slate-200 rounded-xl p-5 shadow-xs">
            <div className="flex items-center gap-2.5 mb-3 pb-3 border-b border-slate-100">
              <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-bold text-xs">
                FB
              </div>
              <div>
                <strong className="text-sm text-slate-900 block font-semibold">{contentName}</strong>
                <span className="text-[11px] text-slate-400">Post preview</span>
              </div>
            </div>
            <p className="text-slate-800 text-sm m-0 leading-relaxed" style={{ whiteSpace: "pre-wrap" }}>
              {contentBody}
            </p>
          </div>
        </article>
      </div>

      {/* Selected Groups */}
      <div className="panel">
        <div className="panel-head">
          <h2>
            <T>{"Selected groups"}</T>
          </h2>
          <span className="badge blue text-xs font-semibold">
            {groups.length}
            <T>{" groups"}</T>
          </span>
        </div>
        <div className="divide-y divide-slate-100">
          {groups.map((group) => (
            <div
              key={group.id}
              className="flex items-center justify-between p-4 hover:bg-slate-50/50 transition-colors"
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center text-xs font-bold">
                  G
                </div>
                <strong className="text-sm font-semibold text-slate-900">{group.name}</strong>
              </div>
              <a
                href={group.url}
                target="_blank"
                rel="noreferrer"
                className="button small"
                title="Open in Facebook"
              >
                <span><T>{"Open group"}</T></span>
                <ExternalLinkIcon className="w-3.5 h-3.5 text-slate-400" />
              </a>
            </div>
          ))}
        </div>
      </div>

      {/* Queue Execution */}
      <div className="panel">
        <div className="panel-head">
          <div className="flex items-center gap-2">
            <QueueIcon className="w-4 h-4 text-slate-600" />
            <h2>
              <T>{"Queue"}</T>
            </h2>
          </div>
          <span className="muted text-xs font-medium">
            {queue.length} <T>{"items"}</T>
          </span>
        </div>
        {queue.length === 0 ? (
          <div className="empty">
            <div className="w-12 h-12 rounded-full bg-slate-50 border border-slate-200 flex items-center justify-center mb-3">
              <QueueIcon className="w-6 h-6 text-slate-400" />
            </div>
            <strong>
              <T>Start the campaign to generate its queue.</T>
            </strong>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>
                    <T>Group</T>
                  </th>
                  <th>
                    <T>Status</T>
                  </th>
                  <th>
                    <T>Scheduled</T>
                  </th>
                  <th>
                    <T>Error</T>
                  </th>
                </tr>
              </thead>
              <tbody>
                {queue.map((item) => (
                  <tr key={item.id}>
                    <td className="font-semibold text-slate-900">{item.groupName}</td>
                    <td>
                      <span
                        className={`badge ${
                          item.status === "POSTED"
                            ? "green"
                            : item.status === "FAILED"
                            ? "red"
                            : "amber"
                        }`}
                      >
                        <T>{item.status}</T>
                      </span>
                    </td>
                    <td className="text-slate-500 text-xs">
                      {new Date(item.scheduledAt).toLocaleString()}
                    </td>
                    <td className="text-xs text-rose-600 max-w-xs truncate">
                      <T>{item.errorMessage ?? "—"}</T>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

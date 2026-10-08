"use client";
import { T } from "@/components/language-provider";


import { useState } from "react";

type QueueEntry = { id: string; status: string; scheduledAt: Date | string; groupName: string; errorMessage: string | null };
type CampaignData = { id: string; name: string; status: string; minIntervalSeconds: number; maxIntervalSeconds: number };

export default function CampaignDetail({ campaign, contentName, contentBody, groups, queue: initialQueue }: { campaign: CampaignData; contentName: string; contentBody: string; groups: { id: string; name: string; url: string }[]; queue: QueueEntry[] }) {
  const [status, setStatus] = useState(campaign.status);
  const [queue, setQueue] = useState(initialQueue);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const posted = queue.filter((item) => item.status === "POSTED").length;
  const failed = queue.filter((item) => item.status === "FAILED").length;
  const progress = queue.length ? Math.round(posted / queue.length * 100) : 0;
  async function action(actionName: "start" | "pause" | "resume" | "cancel" | "retry") {
    setError(""); setMessage("");
    const method = actionName === "start" || actionName === "retry" ? "POST" : "PATCH";
    const path = actionName === "start" || actionName === "retry" ? `/api/campaigns/${campaign.id}/${actionName}` : `/api/campaigns/${campaign.id}`;
    const response = await fetch(path, { method, headers: { "content-type": "application/json" }, body: method === "POST" ? "{}" : JSON.stringify({ status: actionName === "pause" ? "PAUSED" : actionName === "resume" ? "RUNNING" : "CANCELLED" }) });
    const result = await response.json() as { data?: { status?: string; retried?: number }; error?: { message: string } };
    if (!response.ok) { setError(result.error?.message ?? "Campaign action failed."); return; }
    if (actionName === "retry") { setQueue((current) => current.map((item) => item.status === "FAILED" ? { ...item, status: "READY", errorMessage: null } : item)); setStatus("RUNNING"); setMessage(`${result.data?.retried ?? 0} failed jobs returned to the queue.`); }
    else { const updated = actionName === "start" ? "RUNNING" : result.data?.status ?? status; setStatus(updated); setMessage(`Campaign ${updated.toLowerCase()}.`); }
  }
  return <><div className="cards"><section className="card"><div className="card-label"><T>{"Campaign status"}</T></div><div style={{ marginTop: 14 }}><span className={`badge ${status === "RUNNING" ? "green" : "amber"}`}><T>{status}</T></span></div></section><section className="card"><div className="card-label"><T>{"Posted"}</T></div><div className="card-value">{posted} / {queue.length}</div></section><section className="card"><div className="card-label"><T>{"Progress"}</T></div><div className="card-value">{progress}%</div></section><section className="card"><div className="card-label"><T>{"Failed"}</T></div><div className="card-value">{failed}</div></section></div><div className="panel"><div className="panel-head"><h2><T>{"Actions"}</T></h2><div style={{ display: "flex", gap: 7 }}>{status === "READY" && <button className="button primary" onClick={() => void action("start")}><T>{"Start"}</T></button>}{status === "RUNNING" && <button className="button" onClick={() => void action("pause")}><T>{"Pause"}</T></button>}{status === "PAUSED" && <button className="button primary" onClick={() => void action("resume")}><T>{"Resume"}</T></button>}{failed > 0 && <button className="button" onClick={() => void action("retry")}><T>{"Retry failed"}</T></button>}{["READY", "RUNNING", "PAUSED"].includes(status) && <button className="button danger" onClick={() => void action("cancel")}><T>{"Cancel"}</T></button>}</div></div><div style={{ padding: 18 }}><p className="muted"><T>For automatic posting, select this campaign in the extension and click Start. Maximum 3 groups per run.</T></p><p className="muted"><T>{message}</T></p>{error && <p className="error" role="alert"><T>{error}</T></p>}<div className="progress"><span style={{ width: `${progress}%` }} /></div><p className="muted"><T>{"Interval: "}</T>{campaign.minIntervalSeconds}<T>{" to "}</T>{campaign.maxIntervalSeconds}<T>{" seconds."}</T></p></div></div><div className="panel"><div className="panel-head"><h2><T>{"Content"}</T></h2></div><article style={{ padding: 19 }}><strong>{contentName}</strong><p className="muted" style={{ whiteSpace: "pre-wrap" }}>{contentBody}</p></article></div><div className="panel"><div className="panel-head"><h2><T>{"Selected groups"}</T></h2><span className="muted">{groups.length}<T>{" groups"}</T></span></div>{groups.map((group) => <div key={group.id} style={{ padding: "13px 18px", borderBottom: "1px solid var(--line)" }}><a href={group.url} target="_blank" rel="noreferrer">{group.name}</a></div>)}</div><div className="panel"><div className="panel-head"><h2><T>{"Queue"}</T></h2></div>{queue.length === 0 ? <div className="empty"><T>Start the campaign to generate its queue.</T></div> : <div className="table-wrap"><table><thead><tr><th><T>Group</T></th><th><T>Status</T></th><th><T>Scheduled</T></th><th><T>Error</T></th></tr></thead><tbody>{queue.map((item) => <tr key={item.id}><td>{item.groupName}</td><td><span className={`badge ${item.status === "POSTED" ? "green" : item.status === "FAILED" ? "red" : "amber"}`}><T>{item.status}</T></span></td><td>{new Date(item.scheduledAt).toLocaleString()}</td><td><T>{item.errorMessage ?? "—"}</T></td></tr>)}</tbody></table></div>}</div></>;
}


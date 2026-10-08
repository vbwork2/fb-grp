"use client";

import { useState } from "react";
import { T } from "@/components/language-provider";

type Group = { id: string; name: string; facebookUrl: string; status: string };
type Content = { id: string; name: string; body: string; linkUrl: string | null };
type Campaign = { id: string; name: string; contentId: string; minIntervalSeconds: number; maxIntervalSeconds: number };

async function saveResource<T>(url: string, body: unknown, method = "POST"): Promise<T> {
  const response = await fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok || result.error) throw new Error(result.error?.message ?? "Unable to save changes.");
  return result.data as T;
}

export default function CampaignEditor({ campaign, selectedGroupIds, availableGroups, availableContents, onClose }: {
  campaign: Campaign; selectedGroupIds: string[]; availableGroups: Group[]; availableContents: Content[]; onClose: () => void;
}) {
  const [groups, setGroups] = useState(availableGroups);
  const [groupIds, setGroupIds] = useState(selectedGroupIds);
  const [search, setSearch] = useState("");
  const [contentId, setContentId] = useState(campaign.contentId);
  const source = availableContents.find((item) => item.id === contentId);
  const [contentName, setContentName] = useState(source?.name ?? "");
  const [body, setBody] = useState(source?.body ?? "");
  const [linkUrl, setLinkUrl] = useState(source?.linkUrl ?? "");
  const [groupDraft, setGroupDraft] = useState<{ id?: string; name: string; facebookUrl: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [groupMessage, setGroupMessage] = useState("");
  function chooseContent(id: string) {
    const item = availableContents.find((entry) => entry.id === id);
    setContentId(id); setContentName(item?.name ?? ""); setBody(item?.body ?? ""); setLinkUrl(item?.linkUrl ?? "");
  }
  async function saveGroup() {
    if (!groupDraft?.name.trim() || !groupDraft.facebookUrl.trim()) { setError("Check the group details and Facebook URL."); return; }
    setBusy(true); setError(""); setGroupMessage("");
    try {
      const group = await saveResource<Group>(groupDraft.id ? `/api/groups/${groupDraft.id}` : "/api/groups", { name: groupDraft.name, facebookUrl: groupDraft.facebookUrl }, groupDraft.id ? "PATCH" : "POST");
      setGroups((current) => [group, ...current.filter((item) => item.id !== group.id)]);
      setGroupIds((current) => current.includes(group.id) ? current : [...current, group.id]);
      setGroupDraft(null); setGroupMessage("Group saved. Save the campaign to apply your selection.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to save changes."); }
    finally { setBusy(false); }
  }
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setError("");
    if (!groupIds.length) { setError("Select at least one group."); return; }
    if (groupDraft) { setError("Save or close the group editor before saving the campaign."); return; }
    const values = new FormData(event.currentTarget);
    const changed = !source || contentName !== source.name || body !== source.body || linkUrl !== (source.linkUrl ?? "");
    setBusy(true);
    try {
      await saveResource(`/api/campaigns/${campaign.id}`, {
        name: values.get("name"), groupIds,
        minIntervalSeconds: Number(values.get("minIntervalSeconds")),
        maxIntervalSeconds: Number(values.get("maxIntervalSeconds")),
        ...(contentId ? { contentId } : {}),
        ...(changed ? { contentDraft: { name: contentName, body, linkUrl } } : {}),
      }, "PATCH");
      window.location.reload();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to save changes."); setBusy(false); }
  }
  const groupEditor = groupDraft ? <div className="form" style={{ border: "1px solid var(--line)", padding: 16 }}>
          <h3><T>{groupDraft.id ? "Edit group" : "Add a Facebook Group"}</T></h3>
          <div className="field"><label htmlFor="campaignGroupName"><T>{"Group name"}</T></label><input id="campaignGroupName" value={groupDraft.name} maxLength={160} onChange={(event) => setGroupDraft({ ...groupDraft, name: event.target.value })} /></div>
          <div className="field"><label htmlFor="campaignGroupUrl"><T>{"Facebook Group URL"}</T></label><input id="campaignGroupUrl" type="url" value={groupDraft.facebookUrl} onChange={(event) => setGroupDraft({ ...groupDraft, facebookUrl: event.target.value })} /></div>
          <p className="muted"><T>{"Group name and URL changes apply to your workspace. Removing a group here only removes it from this campaign."}</T></p>
          <div className="buttons"><button type="button" className="button small primary" onClick={() => void saveGroup()}><T>{"Save group"}</T></button><button type="button" className="button small" onClick={() => setGroupDraft(null)}><T>{"Close"}</T></button></div>
        </div> : null;
  return <section className="panel" aria-labelledby="campaignEditorTitle">
    <div className="panel-head"><h2 id="campaignEditorTitle"><T>{"Edit campaign"}</T></h2><button className="button small" type="button" disabled={busy} onClick={onClose}><T>{"Close"}</T></button></div>
    <form className="form" style={{ padding: 20 }} onSubmit={submit}>
      <fieldset disabled={busy} className="form" style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
        <div className="field"><label htmlFor="editCampaignName"><T>{"Campaign name"}</T></label><input id="editCampaignName" name="name" defaultValue={campaign.name} required maxLength={160} /></div>
        <div className="two-col">
          <div className="field"><label htmlFor="editCampaignMin"><T>{"Minimum interval (seconds)"}</T></label><input id="editCampaignMin" name="minIntervalSeconds" type="number" min={2} defaultValue={campaign.minIntervalSeconds} required /></div>
          <div className="field"><label htmlFor="editCampaignMax"><T>{"Maximum interval (seconds)"}</T></label><input id="editCampaignMax" name="maxIntervalSeconds" type="number" min={2} defaultValue={campaign.maxIntervalSeconds} required /></div>
        </div>
        <div className="field"><label htmlFor="editCampaignContent"><T>{"Content"}</T></label><select id="editCampaignContent" value={contentId} onChange={(event) => chooseContent(event.target.value)}><option value=""><T>{"Create new content"}</T></option>{availableContents.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
        <button className="button small" type="button" style={{ justifySelf: "start" }} onClick={() => chooseContent("")}><T>{"Remove selected content"}</T></button>
        <div className="field"><label htmlFor="campaignContentName"><T>{"Content name"}</T></label><input id="campaignContentName" value={contentName} onChange={(event) => setContentName(event.target.value)} required maxLength={160} /></div>
        <div className="field"><label htmlFor="campaignContentBody"><T>{"Caption"}</T></label><textarea id="campaignContentBody" value={body} onChange={(event) => setBody(event.target.value)} required maxLength={10000} /></div>
        <div className="field"><label htmlFor="campaignContentLink"><T>{"Link (optional)"}</T></label><input id="campaignContentLink" type="url" value={linkUrl} onChange={(event) => setLinkUrl(event.target.value)} /></div>
        <p className="muted"><T>{"Edited captions are saved as a separate content copy with the original images. Other campaigns keep their content. Replacing content uses its primary caption."}</T></p>
        <div className="row"><h3><T>{"Selected groups"}</T> ({groupIds.length})</h3><button className="button small" type="button" onClick={() => { setGroupDraft({ name: "", facebookUrl: "" }); setGroupMessage(""); }}><T>{"Add a Facebook Group"}</T></button></div>
        {groupDraft && !groupDraft.id && groupEditor}
        <div className="field"><label htmlFor="campaignGroupSearch"><T>{"Search groups"}</T></label><input id="campaignGroupSearch" value={search} onChange={(event) => setSearch(event.target.value)} /></div>
        <div style={{ maxHeight: 360, overflowY: "auto" }}>
          {groups.filter((group) => (group.status === "ACTIVE" || selectedGroupIds.includes(group.id)) && group.name.toLowerCase().includes(search.toLowerCase())).map((group) => <div key={group.id} className="row" style={{ padding: "10px 0", gap: 12, flexWrap: "wrap" }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8 }}><input type="checkbox" checked={groupIds.includes(group.id)} onChange={(event) => setGroupIds((current) => event.target.checked ? [...current, group.id] : current.filter((id) => id !== group.id))} />{group.name}</label>
            <div className="buttons"><button type="button" className="button small" onClick={() => setGroupDraft({ id: group.id, name: group.name, facebookUrl: group.facebookUrl })}><T>{"Edit group"}</T></button>{groupIds.includes(group.id) && <button type="button" className="button small danger" onClick={() => setGroupIds((current) => current.filter((id) => id !== group.id))}><T>{"Remove from campaign"}</T></button>}</div>
            {groupDraft?.id === group.id && <div style={{ flexBasis: "100%", minWidth: 0 }}>{groupEditor}</div>}
          </div>)}
        </div>
        {groupMessage && <p className="notice" role="status"><T>{groupMessage}</T></p>}
        <p className="muted"><T>{"Previously processed posts keep their history and are not posted again. Pending posts are rescheduled when you save."}</T></p>
        <button className="button primary" style={{ justifySelf: "start" }}><T>{busy ? "Saving…" : "Save campaign changes"}</T></button>
      </fieldset>
      {error && <p className="error" role="alert"><T>{error}</T></p>}
    </form>
  </section>;
}
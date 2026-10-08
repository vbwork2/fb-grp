"use client";
import { T, LocalizedInput, LocalizedTextarea } from "@/components/language-provider";
import { translateDialog } from "@/lib/i18n";


import { useEffect, useState } from "react";
import { CampaignWizard } from "@/components/campaign-wizard";

type Group = { id: string; name: string; facebookUrl: string; category: string | null; status: string; lastPostedAt: Date | string | null };
type Content = { id: string; name: string; body: string; linkUrl: string | null };
type MediaItem = { id: string; mimeType: string; originalFilename: string; sizeBytes: number };
type Variant = { id: string; name: string; body: string };
type Campaign = { campaign: { id: string; contentId: string; name: string; status: string; minIntervalSeconds: number; maxIntervalSeconds: number; createdAt: Date | string }; contentName: string };
type ApiResult<T> = { data: T | null; error: { message: string } | null };

async function request<T>(url: string, body?: unknown, method?: string): Promise<T> {
  const response = await fetch(url, body ? { method: method ?? "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : { method: method ?? "GET" });
  const result = await response.json() as ApiResult<T>;
  if (!response.ok || result.error) throw new Error(result.error?.message ?? "Request failed.");
  return result.data as T;
}

function Feedback({ error, success }: { error: string; success: string }) {
  return <>{error && <p className="error" role="alert"><T>{error}</T></p>}{success && <div className="notice" role="status"><T>{success}</T></div>}</>;
}

export function GroupsPanel({ initialGroups }: { initialGroups: Group[] }) {
  const [items, setItems] = useState(initialGroups);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [editingGroup, setEditingGroup] = useState<Group | null>(null);
  async function add(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setSuccess("");
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    try {
      const item = await request<Group>("/api/groups", Object.fromEntries(form.entries()));
      setItems((current) => [item, ...current]); formElement.reset(); setSuccess("Group added to your workspace.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to add the group."); }
  }
  async function setStatus(group: Group, status: "ACTIVE" | "PAUSED" | "DISABLED") {
    try { const item = await request<Group>(`/api/groups/${group.id}`, { status }, "PATCH"); setItems((current) => current.map((entry) => entry.id === item.id ? item : entry)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to update the group."); }
  }
  async function remove(group: Group) {
    if (!window.confirm(translateDialog(`Delete ${group.name}?`))) return;
    try { await request(`/api/groups/${group.id}`, undefined, "DELETE"); setItems((current) => current.filter((entry) => entry.id !== group.id)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to delete the group."); }
  }
  async function importCsv(event: React.ChangeEvent<HTMLInputElement>) {
    const inputElement = event.currentTarget;
    const file = inputElement.files?.[0];
    if (!file) return;
    setError(""); setSuccess("");
    const form = new FormData(); form.set("file", file);
    try {
      const response = await fetch("/api/groups/import", { method: "POST", body: form });
      const result = await response.json() as ApiResult<{ total: number; imported: number; duplicate: number; invalid: number; items: Group[] }>;
      if (!response.ok || !result.data) throw new Error(result.error?.message ?? "Unable to import CSV.");
      setItems((current) => [...result.data!.items, ...current]);
      setSuccess(`Total ${result.data.total}; imported ${result.data.imported}; duplicates ${result.data.duplicate}; invalid ${result.data.invalid}.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to import CSV."); }
    finally { inputElement.value = ""; }
  }
  async function disableSelected() {
    try {
      const updated = await Promise.all(selected.map((id) => request<Group>(`/api/groups/${id}`, { status: "DISABLED" }, "PATCH")));
      const byId = new Map(updated.map((group) => [group.id, group]));
      setItems((current) => current.map((group) => byId.get(group.id) ?? group)); setSelected([]); setSuccess(`${updated.length} groups disabled.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to disable selected groups."); }
  }
  const visible = items.filter((item) => `${item.name} ${item.category ?? ""}`.toLowerCase().includes(search.toLowerCase()));
  return <>{editingGroup && <GroupEditor group={editingGroup} onClose={() => setEditingGroup(null)} onSaved={(updated) => { setItems((current) => current.map((item) => item.id === updated.id ? updated : item)); setEditingGroup(null); }} />}<div className="panel"><div className="panel-head"><h2><T>{"Add a Facebook Group"}</T></h2><span className="muted">{items.length}<T>{" total"}</T></span></div><form className="form" style={{ padding: 20 }} onSubmit={add}><div className="two-col"><div className="field"><label htmlFor="groupName"><T>{"Group name"}</T></label><input id="groupName" name="name" required maxLength={160} /></div><div className="field"><label htmlFor="groupUrl"><T>{"Facebook Group URL"}</T></label><LocalizedInput id="groupUrl" name="facebookUrl" type="url" placeholder="https://www.facebook.com/groups/..." required /></div></div><div className="field"><label htmlFor="groupCategory"><T>{"Category"}</T></label><input id="groupCategory" name="category" maxLength={80} /></div><Feedback error={error} success={success} /><button className="button primary" style={{ justifySelf: "start" }}><T>{"Add group"}</T></button></form><div style={{ padding: "0 20px 18px" }}><label className="button" htmlFor="groupCsv"><T>{"Import CSV"}</T></label><input id="groupCsv" type="file" accept=".csv,text/csv" onChange={(event) => void importCsv(event)} style={{ display: "none" }} /><p className="muted"><T>{"CSV columns: name,url,category"}</T></p></div></div><div className="panel"><div className="panel-head"><h2><T>{"Your groups"}</T></h2><div style={{ display: "flex", gap: 9, alignItems: "center" }}><LocalizedInput aria-label="Search groups" placeholder="Search groups" value={search} onChange={(event) => setSearch(event.target.value)} style={{ border: "1px solid var(--line)", borderRadius: 6, padding: "8px 10px" }} />{selected.length > 0 && <button className="button small" onClick={() => void disableSelected()}><T>{"Disable "}</T>{selected.length}</button>}</div></div>{visible.length === 0 ? <div className="empty"><strong><T>{"No Facebook Groups yet."}</T></strong><T>{"Add your first group or import a CSV to prepare a campaign."}</T></div> : <div className="table-wrap"><table><thead><tr><th><LocalizedInput aria-label="Select visible groups" type="checkbox" checked={visible.length > 0 && visible.every((group) => selected.includes(group.id))} onChange={(event) => setSelected(event.target.checked ? [...new Set([...selected, ...visible.map((group) => group.id)])] : selected.filter((id) => !visible.some((group) => group.id === id)))} /></th><th><T>{"Name"}</T></th><th><T>{"Category"}</T></th><th><T>{"Facebook URL"}</T></th><th><T>{"Status"}</T></th><th><T>{"Last posted"}</T></th><th><T>{"Actions"}</T></th></tr></thead><tbody>{visible.map((group) => <tr key={group.id}><td><LocalizedInput aria-label={`Select ${group.name}`} type="checkbox" checked={selected.includes(group.id)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, group.id] : current.filter((id) => id !== group.id))} /></td><td><strong>{group.name}</strong></td><td>{group.category ?? "—"}</td><td><a target="_blank" rel="noreferrer" href={group.facebookUrl} style={{ color: "var(--green)" }}><T>{"Open group"}</T></a></td><td><span className={`badge ${group.status === "ACTIVE" ? "green" : "amber"}`}><T>{group.status}</T></span></td><td>{group.lastPostedAt ? new Date(group.lastPostedAt).toLocaleDateString() : "—"}</td><td><div style={{ display: "flex", gap: 6 }}><button className="button small" onClick={() => setEditingGroup(group)}><T>{"Edit"}</T></button><button className="button small" onClick={() => void setStatus(group, group.status === "PAUSED" ? "ACTIVE" : "PAUSED")}><T>{group.status === "PAUSED" ? "Resume" : "Pause"}</T></button><button className="button small danger" onClick={() => void remove(group)}><T>{"Delete"}</T></button></div></td></tr>)}</tbody></table></div>}</div></>;
}

function GroupEditor({ group, onClose, onSaved }: { group: Group; onClose: () => void; onSaved: (group: Group) => void }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    try {
      const updated = await request<Group>(`/api/groups/${group.id}`, values, "PATCH");
      onSaved(updated);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to update group."); }
    finally { setBusy(false); }
  }
  return <div className="panel"><div className="panel-head"><h2><T>{"Edit group"}</T></h2><button className="button small" onClick={onClose}><T>{"Close"}</T></button></div><form className="form" style={{ padding: 20 }} onSubmit={submit}><div className="field"><label htmlFor="editGroupName"><T>{"Name"}</T></label><input id="editGroupName" name="name" defaultValue={group.name} required maxLength={160} /></div><div className="field"><label htmlFor="editGroupUrl"><T>{"Facebook Group URL"}</T></label><input id="editGroupUrl" name="facebookUrl" type="url" defaultValue={group.facebookUrl} required /></div><div className="field"><label htmlFor="editGroupCategory"><T>{"Category"}</T></label><input id="editGroupCategory" name="category" defaultValue={group.category ?? ""} maxLength={80} /></div>{error && <p className="error" role="alert"><T>{error}</T></p>}<button className="button primary" disabled={busy} style={{ justifySelf: "start" }}><T>{busy ? "Saving…" : "Save changes"}</T></button></form></div>;
}

export function ContentPanel({ initialContents }: { initialContents: Content[] }) {
  const [items, setItems] = useState(initialContents);
  const [uploads, setUploads] = useState<Record<string, MediaItem[]>>({});
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [editingContent, setEditingContent] = useState<Content | null>(null);
  async function add(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setSuccess("");
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    try { const item = await request<Content>("/api/content", Object.fromEntries(form.entries())); setItems((current) => [item, ...current]); formElement.reset(); setSuccess("Content saved."); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to save content."); }
  }
  async function remove(id: string) {
    try { await request(`/api/content/${id}`, undefined, "DELETE"); setItems((current) => current.filter((item) => item.id !== id)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to delete content."); }
  }
  async function duplicate(item: Content) {
    try {
      const copy = await request<Content>("/api/content", { name: `${item.name} copy`, body: item.body, linkUrl: item.linkUrl ?? "" });
      setItems((current) => [copy, ...current]); setSuccess("Content duplicated."); setError("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to duplicate content."); }
  }
  async function uploadImage(contentId: string, event: React.ChangeEvent<HTMLInputElement>) {
    const inputElement = event.currentTarget;
    const file = inputElement.files?.[0]; if (!file) return;
    setError(""); setSuccess("");
    const maxMegabytes = process.env.NODE_ENV === "production" ? 4 : 10;
    if (file.size > maxMegabytes * 1024 * 1024) { setError(`Choose an image up to ${maxMegabytes} MB.`); inputElement.value = ""; return; }
    const form = new FormData(); form.set("file", file); form.set("contentId", contentId);
    try {
      const response = await fetch("/api/media", { method: "POST", body: form });
      const result = await response.json() as ApiResult<MediaItem>;
      if (!response.ok || !result.data) throw new Error(result.error?.message ?? "Unable to upload image.");
      setUploads((current) => ({ ...current, [contentId]: [...(current[contentId] ?? []), result.data!] }));
      setSuccess("Image uploaded and attached to this content.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to upload image."); }
    finally { inputElement.value = ""; }
  }
  return <>{editingContent && <ContentEditor content={editingContent} onClose={() => setEditingContent(null)} onSaved={(updated) => { setItems((current) => current.map((item) => item.id === updated.id ? updated : item)); setEditingContent(null); }} />}<div className="panel"><div className="panel-head"><h2><T>{"Create reusable content"}</T></h2></div><form className="form" style={{ padding: 20 }} onSubmit={add}><div className="field"><label htmlFor="contentName"><T>{"Content name"}</T></label><input id="contentName" name="name" required maxLength={160} /></div><div className="field"><label htmlFor="contentBody"><T>{"Caption"}</T></label><LocalizedTextarea id="contentBody" name="body" required maxLength={10000} placeholder="Write the caption you will review before posting." /></div><div className="field"><label htmlFor="contentLink"><T>{"Link (optional)"}</T></label><input id="contentLink" name="linkUrl" type="url" /></div><Feedback error={error} success={success} /><button className="button primary" style={{ justifySelf: "start" }}><T>{"Save content"}</T></button></form></div><div className="panel"><div className="panel-head"><h2><T>{"Saved content"}</T></h2><span className="muted">{items.length}<T>{" items"}</T></span></div>{items.length === 0 ? <div className="empty"><strong><T>{"No saved content yet."}</T></strong><T>{"Create reusable captions for your campaigns."}</T></div> : items.map((item) => <article key={item.id} style={{ padding: 20, borderBottom: "1px solid var(--line)" }}><div className="row"><strong>{item.name}</strong><div className="buttons"><button className="button small" onClick={() => setEditingContent(item)}><T>{"Edit"}</T></button><button className="button small" onClick={() => void duplicate(item)}><T>{"Duplicate"}</T></button><button className="button small danger" onClick={() => void remove(item.id)}><T>{"Delete"}</T></button></div></div><p className="muted" style={{ whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{item.body}</p>{item.linkUrl && <a href={item.linkUrl} className="muted">{item.linkUrl}</a>}<div style={{ marginTop: 13 }}><label className="button small" htmlFor={`image-${item.id}`}><T>{"Upload image"}</T></label><input id={`image-${item.id}`} type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => void uploadImage(item.id, event)} style={{ display: "none" }} />{(uploads[item.id] ?? []).map((image) => <a key={image.id} href={`/api/media/${image.id}`} className="muted" style={{ marginLeft: 10 }}>{image.originalFilename} ({Math.ceil(image.sizeBytes / 1024)}<T>{" KB)"}</T></a>)}</div><VariantEditor contentId={item.id} /></article>)}</div></>;
}

function ContentEditor({ content, onClose, onSaved }: { content: Content; onClose: () => void; onSaved: (content: Content) => void }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    try { onSaved(await request<Content>(`/api/content/${content.id}`, values, "PATCH")); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to update content."); }
    finally { setBusy(false); }
  }
  return <div className="panel"><div className="panel-head"><h2><T>{"Edit content"}</T></h2><button className="button small" onClick={onClose}><T>{"Close"}</T></button></div><form className="form" style={{ padding: 20 }} onSubmit={submit}><div className="field"><label htmlFor="editContentName"><T>{"Content name"}</T></label><input id="editContentName" name="name" defaultValue={content.name} required maxLength={160} /></div><div className="field"><label htmlFor="editContentBody"><T>{"Caption"}</T></label><textarea id="editContentBody" name="body" defaultValue={content.body} required maxLength={10000} /></div><div className="field"><label htmlFor="editContentLink"><T>{"Link (optional)"}</T></label><input id="editContentLink" name="linkUrl" type="url" defaultValue={content.linkUrl ?? ""} /></div>{error && <p className="error" role="alert"><T>{error}</T></p>}<button className="button primary" disabled={busy} style={{ justifySelf: "start" }}><T>{busy ? "Saving…" : "Save changes"}</T></button></form></div>;
}

function VariantEditor({ contentId }: { contentId: string }) {
  const [variants, setVariants] = useState<Variant[]>([]);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editBody, setEditBody] = useState("");
  useEffect(() => { void request<Variant[]>(`/api/content/${contentId}/variants`).then(setVariants).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Unable to load variants.")); }, [contentId]);
  async function add(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const values = Object.fromEntries(new FormData(form).entries());
    try { const variant = await request<Variant>(`/api/content/${contentId}/variants`, values); setVariants((current) => [...current, variant]); form.reset(); setError(""); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to add variant."); }
  }
  async function save(id: string) {
    try { const variant = await request<Variant>(`/api/content/${contentId}/variants/${id}`, { name: editName, body: editBody }, "PATCH"); setVariants((current) => current.map((item) => item.id === id ? variant : item)); setEditing(null); setError(""); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to update variant."); }
  }
  async function remove(id: string) {
    try { await request(`/api/content/${contentId}/variants/${id}`, undefined, "DELETE"); setVariants((current) => current.filter((item) => item.id !== id)); setError(""); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to delete variant."); }
  }
  return <section style={{ marginTop: 16, borderTop: "1px solid var(--line)", paddingTop: 13 }}><div className="eyebrow"><T>{"Content variants"}</T></div>{variants.map((variant) => <div key={variant.id} style={{ padding: "10px 0", borderBottom: "1px solid var(--line)" }}>{editing === variant.id ? <div className="form"><LocalizedInput aria-label="Variant name" value={editName} onChange={(event) => setEditName(event.target.value)} /><LocalizedTextarea aria-label="Variant caption" value={editBody} onChange={(event) => setEditBody(event.target.value)} /><div className="buttons"><button className="button small primary" onClick={() => void save(variant.id)}><T>{"Save variant"}</T></button><button className="button small" onClick={() => setEditing(null)}><T>{"Cancel"}</T></button></div></div> : <><div className="row"><strong>{variant.name}</strong><div className="buttons"><button className="button small" onClick={() => { setEditing(variant.id); setEditName(variant.name); setEditBody(variant.body); }}><T>{"Edit"}</T></button><button className="button small danger" onClick={() => void remove(variant.id)}><T>{"Delete"}</T></button></div></div><p className="muted" style={{ whiteSpace: "pre-wrap" }}>{variant.body}</p></>}</div>)}<form className="form" style={{ marginTop: 12 }} onSubmit={add}><div className="two-col"><div className="field"><label htmlFor={`variantName-${contentId}`}><T>{"Variant name"}</T></label><input id={`variantName-${contentId}`} name="name" required maxLength={120} /></div><div className="field"><label htmlFor={`variantBody-${contentId}`}><T>{"Caption"}</T></label><input id={`variantBody-${contentId}`} name="body" required maxLength={10000} /></div></div><button className="button small" style={{ justifySelf: "start" }}><T>{"Add variant"}</T></button></form>{error && <p className="error" role="alert"><T>{error}</T></p>}</section>;
}

export function CampaignsPanel({ initialCampaigns, groups, contents }: { initialCampaigns: Campaign[]; groups: Group[]; contents: Content[] }) {
  const [items, setItems] = useState(initialCampaigns);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  function created(campaign: Campaign["campaign"]) {
    setItems((current) => [{ campaign, contentName: contents.find((item) => item.id === campaign.contentId)?.name ?? "Saved content" }, ...current]);
    setSuccess("Campaign created. Start it when you're ready to build the queue.");
  }
  async function start(id: string) {
    try { await request(`/api/campaigns/${id}/start`, {}); setItems((current) => current.map((entry) => entry.campaign.id === id ? { ...entry, campaign: { ...entry.campaign, status: "RUNNING" } } : entry)); setSuccess("Campaign started. Its first job is now available to the extension."); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to start campaign."); }
  }
  return <><div className="panel"><div className="panel-head"><h2><T>{"New campaign"}</T></h2></div>{contents.length === 0 || groups.filter((group) => group.status === "ACTIVE").length === 0 ? <div className="empty"><strong><T>{"Campaigns need content and groups."}</T></strong><T>{"Add at least one saved caption and one active group first."}</T></div> : <CampaignWizard groups={groups} contents={contents} onCreated={created} />}{error && <p className="error" role="alert" style={{ margin: 20 }}><T>{error}</T></p>}{success && <div className="notice" role="status" style={{ margin: 20 }}><T>{success}</T></div>}</div><div className="panel"><div className="panel-head"><h2><T>{"Campaigns"}</T></h2><span className="muted">{items.length}<T>{" total"}</T></span></div>{items.length === 0 ? <div className="empty"><strong><T>{"No campaigns yet."}</T></strong><T>{"Create a campaign to prepare your group queue."}</T></div> : <div className="table-wrap"><table><thead><tr><th><T>{"Name"}</T></th><th><T>{"Content"}</T></th><th><T>{"Status"}</T></th><th><T>{"Interval"}</T></th><th><T>{"Actions"}</T></th></tr></thead><tbody>{items.map(({ campaign, contentName }) => <tr key={campaign.id}><td><a href={`/campaigns/${campaign.id}`} style={{ color: "var(--green)", fontWeight: 700 }}>{campaign.name}</a></td><td>{contentName}</td><td><span className={`badge ${campaign.status === "RUNNING" ? "green" : "amber"}`}><T>{campaign.status}</T></span></td><td>{campaign.minIntervalSeconds}–{campaign.maxIntervalSeconds}<T>{"s"}</T></td><td>{campaign.status === "READY" ? <button className="button small primary" onClick={() => void start(campaign.id)}><T>{"Start"}</T></button> : <a href={`/campaigns/${campaign.id}`} className="button small"><T>{"Details"}</T></a>}</td></tr>)}</tbody></table></div>}</div></>;
}

export function PairingPanel() {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  async function generate() {
    setError(""); setSuccess("");
    try { const result = await request<{ code: string; expiresAt: string }>("/api/devices/pairing-code", {}); setCode(result.code); setSuccess(`Code expires at ${new Date(result.expiresAt).toLocaleTimeString()}.`); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to generate a code."); }
  }
  return <div className="panel"><div className="panel-head"><h2><T>{"Connect Chrome Extension"}</T></h2></div><div style={{ padding: 20 }} className="stack"><p className="muted"><T>{"Pair your browser to your workspace. Facebook sign-in remains on facebook.com."}</T></p><button className="button primary" style={{ justifySelf: "start" }} onClick={() => void generate()}><T>{"Generate pairing code"}</T></button>{code && <div><div className="eyebrow"><T>{"One-time code"}</T></div><strong style={{ fontSize: 26, letterSpacing: 3 }}>{code}</strong></div>}<Feedback error={error} success={success} /></div></div>;
}


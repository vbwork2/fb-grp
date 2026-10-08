"use client";
import { T, LocalizedInput } from "@/components/language-provider";


import { useMemo, useState } from "react";

type GroupOption = { id: string; name: string; category: string | null; status: string };
type ContentOption = { id: string; name: string };
type CampaignData = { id: string; contentId: string; name: string; status: string; minIntervalSeconds: number; maxIntervalSeconds: number; createdAt: Date | string };
type ApiResult<T> = { data: T | null; error: { message: string } | null };

export function CampaignWizard({ groups, contents, onCreated }: { groups: GroupOption[]; contents: ContentOption[]; onCreated: (campaign: CampaignData) => void }) {
  const [step, setStep] = useState(1);
  const [name, setName] = useState("");
  const [contentId, setContentId] = useState(contents[0]?.id ?? "");
  const [variantStrategy, setVariantStrategy] = useState("PRIMARY_ONLY");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [scheduledStartAt, setScheduledStartAt] = useState("");
  const [minIntervalSeconds, setMinIntervalSeconds] = useState(300);
  const [maxIntervalSeconds, setMaxIntervalSeconds] = useState(600);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const activeGroups = groups.filter((group) => group.status === "ACTIVE");
  const categories = useMemo(() => [...new Set(activeGroups.map((group) => group.category).filter((value): value is string => Boolean(value)))].sort(), [activeGroups]);
  const visibleGroups = activeGroups.filter((group) => group.name.toLowerCase().includes(search.toLowerCase()) && (!category || group.category === category));
  const durationMinutes = Math.ceil(Math.max(0, groupIds.length - 1) * (minIntervalSeconds + maxIntervalSeconds) / 120);

  function continueStep() {
    setError("");
    if (step === 1 && (!name.trim() || !contentId)) { setError("Enter a campaign name and choose content."); return; }
    if (step === 2 && groupIds.length === 0) { setError("Select at least one active group."); return; }
    if (step === 3 && (minIntervalSeconds < 60 || maxIntervalSeconds < minIntervalSeconds)) { setError("Use intervals of at least 60 seconds, with maximum at or above minimum."); return; }
    setStep((current) => Math.min(4, current + 1));
  }

  async function createCampaign() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/campaigns", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, contentId, groupIds, variantStrategy, minIntervalSeconds, maxIntervalSeconds, scheduledStartAt: scheduledStartAt ? new Date(scheduledStartAt).toISOString() : undefined }) });
      const result = await response.json() as ApiResult<CampaignData>;
      if (!response.ok || !result.data) throw new Error(result.error?.message ?? "Unable to create campaign.");
      onCreated(result.data);
      setStep(1); setName(""); setGroupIds([]); setScheduledStartAt("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to create campaign."); }
    finally { setBusy(false); }
  }

  return <div className="form" style={{ padding: 20 }}>
    <div className="row"><strong><T>{"Step "}</T>{step}<T>{" of 4"}</T></strong><span className="muted"><T>{["Campaign", "Groups", "Schedule", "Review"][step - 1]}</T></span></div>
    {step === 1 && <><div className="field"><label htmlFor="wizardCampaignName"><T>{"Campaign name"}</T></label><input id="wizardCampaignName" value={name} onChange={(event) => setName(event.target.value)} maxLength={160} required /></div><div className="field"><label htmlFor="wizardContent"><T>{"Content"}</T></label><select id="wizardContent" value={contentId} onChange={(event) => setContentId(event.target.value)}>{contents.map((content) => <option key={content.id} value={content.id}>{content.name}</option>)}</select></div><div className="field"><label htmlFor="wizardVariant"><T>{"Variant strategy"}</T></label><select id="wizardVariant" value={variantStrategy} onChange={(event) => setVariantStrategy(event.target.value)}><option value="PRIMARY_ONLY"><T>{"Primary caption only"}</T></option><option value="ROUND_ROBIN"><T>{"Round robin variants"}</T></option></select></div></>}
    {step === 2 && <><div className="two-col"><div className="field"><label htmlFor="wizardSearch"><T>{"Search groups"}</T></label><LocalizedInput id="wizardSearch" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Group name" /></div><div className="field"><label htmlFor="wizardCategory"><T>{"Category"}</T></label><select id="wizardCategory" value={category} onChange={(event) => setCategory(event.target.value)}><option value=""><T>{"All categories"}</T></option>{categories.map((item) => <option key={item}>{item}</option>)}</select></div></div><div className="buttons"><button type="button" className="button small" onClick={() => setGroupIds((current) => [...new Set([...current, ...visibleGroups.map((group) => group.id)])])}><T>{"Select all shown"}</T></button><button type="button" className="button small" onClick={() => setGroupIds([])}><T>{"Deselect all"}</T></button><span className="muted">{groupIds.length}<T>{" selected"}</T></span></div><div className="group-picker">{visibleGroups.length === 0 ? <p className="muted"><T>{"No active groups match these filters."}</T></p> : visibleGroups.map((group) => <label key={group.id}><input type="checkbox" checked={groupIds.includes(group.id)} onChange={(event) => setGroupIds((current) => event.target.checked ? [...current, group.id] : current.filter((id) => id !== group.id))} /><span>{group.name}</span><small>{group.category ?? <T>{"Uncategorized"}</T>}</small></label>)}</div></>}
    {step === 3 && <><div className="field"><label htmlFor="wizardStart"><T>{"Schedule start (optional)"}</T></label><input id="wizardStart" type="datetime-local" value={scheduledStartAt} onChange={(event) => setScheduledStartAt(event.target.value)} /></div><div className="two-col"><div className="field"><label htmlFor="wizardMin"><T>{"Minimum interval in seconds"}</T></label><input id="wizardMin" type="number" min={60} value={minIntervalSeconds} onChange={(event) => setMinIntervalSeconds(Number(event.target.value))} /></div><div className="field"><label htmlFor="wizardMax"><T>{"Maximum interval in seconds"}</T></label><input id="wizardMax" type="number" min={60} value={maxIntervalSeconds} onChange={(event) => setMaxIntervalSeconds(Number(event.target.value))} /></div></div><small><T>{"Intervals control normal campaign pacing."}</T></small></>}
    {step === 4 && <div className="stack"><div><div className="eyebrow"><T>{"Campaign"}</T></div><strong>{name}</strong></div><div><div className="eyebrow"><T>{"Content"}</T></div><strong>{contents.find((item) => item.id === contentId)?.name ?? "Content"}</strong><div className="muted"><T>{variantStrategy === "ROUND_ROBIN" ? "Round robin variants" : "Primary caption only"}</T></div></div><div><div className="eyebrow"><T>{"Groups"}</T></div><strong>{groupIds.length}<T>{" selected"}</T></strong></div><div><div className="eyebrow"><T>{"Workflow duration"}</T></div><strong><T>{"About "}</T>{durationMinutes}<T>{" minutes"}</T></strong></div><div><div className="eyebrow"><T>{"Scheduled start"}</T></div><strong><T>{scheduledStartAt ? new Date(scheduledStartAt).toLocaleString() : "When you start the campaign"}</T></strong></div><div className="muted"><T>{"Interval range: "}</T>{minIntervalSeconds}–{maxIntervalSeconds}<T>{" seconds"}</T></div></div>}
    {error && <p className="error" role="alert"><T>{error}</T></p>}
    <div className="buttons"><button type="button" className="button" disabled={step === 1 || busy} onClick={() => { setError(""); setStep((current) => Math.max(1, current - 1)); }}><T>{"Back"}</T></button>{step < 4 ? <button type="button" className="button primary" onClick={continueStep}><T>{"Continue"}</T></button> : <button type="button" className="button primary" disabled={busy} onClick={() => void createCampaign()}><T>{busy ? "Creating…" : "Create campaign"}</T></button>}</div>
  </div>;
}

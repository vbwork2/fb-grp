"use client";

import { workspaceFetch } from "@/lib/workspace-fetch";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { LoadingDots } from "@/components/loading";
import { T, LocalizedInput, useLocale } from "@/components/language-provider";
import { translate } from "@/lib/i18n";

type GroupOption = { id: string; name: string; category: string | null; status: string };
type ContentOption = { id: string; name: string; body?: string };
type CampaignData = {
  id: string; contentId: string; name: string; status: string;
  minIntervalSeconds: number; maxIntervalSeconds: number; createdAt: Date | string;
};
type ApiResult<T> = { data: T | null; error: { message: string } | null };
type FieldErrors = Partial<Record<"name" | "content" | "groups" | "interval" | "schedule", string>>;
const steps = ["Campaign & Content", "Select Groups", "Schedule & Review"];
const fieldIds = { name: "wizardCampaignName", content: "wizardContent", groups: "wizardSearch", interval: "wizardMin", schedule: "wizardStart" };
const descriptions = [
  "Name your campaign and choose the post you want to share.",
  "Choose your audience. Only active groups are shown.",
  "Set your timing and check the summary before saving.",
];

export function CampaignWizard({ groups, contents, onCreated }: {
  groups: GroupOption[]; contents: ContentOption[]; onCreated: (campaign: CampaignData) => void;
}) {
  const locale = useLocale();
  const [step, setStep] = useState(1);
  const [furthestStep, setFurthestStep] = useState(1);
  const [name, setName] = useState("");
  const [contentId, setContentId] = useState(contents[0]?.id ?? "");
  const [variantStrategy, setVariantStrategy] = useState("PRIMARY_ONLY");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [selectedOnly, setSelectedOnly] = useState(false);
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [scheduledStartAt, setScheduledStartAt] = useState("");
  const [minIntervalSeconds, setMinIntervalSeconds] = useState("2");
  const [maxIntervalSeconds, setMaxIntervalSeconds] = useState("2");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const previousStep = useRef(step);

  useEffect(() => {
    const firstError = Object.keys(fieldErrors)[0] as keyof FieldErrors | undefined;
    const invalidField = firstError ? document.getElementById(fieldIds[firstError]) : null;
    if (invalidField) invalidField.focus();
    else if (previousStep.current !== step) heading.current?.focus();
    previousStep.current = step;
  }, [step, fieldErrors]);
  const activeGroups = groups.filter((group) => group.status === "ACTIVE");
  const categories = [...new Set(activeGroups.map((group) => group.category).filter((value): value is string => Boolean(value)))].sort();
  const activeById = new Map(activeGroups.map((group) => [group.id, group]));
  const selectedGroups = groupIds.flatMap((id) => { const group = activeById.get(id); return group ? [group] : []; });
  const visibleGroups = activeGroups.filter((group) =>
    `${group.name} ${group.category ?? ""}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()) &&
    (!category || group.category === category) && (!selectedOnly || groupIds.includes(group.id))
  );
  const selectedContent = contents.find((item) => item.id === contentId);
  const minimum = Number(minIntervalSeconds);
  const maximum = Number(maxIntervalSeconds);
  const validIntervals = minIntervalSeconds !== "" && maxIntervalSeconds !== "" && Number.isSafeInteger(minimum) && Number.isSafeInteger(maximum) && minimum >= 2 && maximum >= minimum;

  function goToStep(next: number) {
    setStep(next);
    setError("");
  }

  function validate(target: number): boolean {
    const errors: FieldErrors = {};
    if (target === 1) {
      if (!name.trim()) errors.name = "Enter a campaign name.";
      if (!selectedContent) errors.content = "Choose saved content for this campaign.";
    }
    if (target === 2 && selectedGroups.length === 0) errors.groups = "Select at least one active group.";
    if (target === 3) {
      if (!validIntervals) errors.interval = "Use whole seconds: minimum 2, and maximum at or above minimum.";
      if (scheduledStartAt && (!Number.isFinite(new Date(scheduledStartAt).getTime()) || new Date(scheduledStartAt).getTime() <= Date.now())) errors.schedule = "Choose a future start time or leave it blank.";
    }
    setFieldErrors(errors);
    const firstError = Object.keys(errors)[0] as keyof FieldErrors | undefined;
    if (firstError) {
      setStep(target);
      return false;
    }
    return true;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (locked.current) return;
    setError("");
    if (!validate(step)) return;
    if (step < 3) {
      setFurthestStep((current) => Math.max(current, step + 1));
      goToStep(step + 1);
      return;
    }
    // Recheck earlier choices when the user returns through the step navigation.
    if (!validate(1) || !validate(2) || !validate(3)) return;
    locked.current = true;
    setBusy(true);
    try {
      const response = await workspaceFetch("/api/campaigns", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: name.trim(), contentId, groupIds: selectedGroups.map((group) => group.id), variantStrategy,
          minIntervalSeconds: minimum, maxIntervalSeconds: maximum,
          scheduledStartAt: scheduledStartAt ? new Date(scheduledStartAt).toISOString() : undefined }),
      });
      const result = (await response.json()) as ApiResult<CampaignData>;
      if (!response.ok || !result.data) throw new Error(result.error?.message ?? "Unable to create campaign.");
      onCreated(result.data);
      setStep(1); setFurthestStep(1); setName(""); setGroupIds([]); setScheduledStartAt("");
      setSearch(""); setCategory(""); setSelectedOnly(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to create campaign.");
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }

  return (
    <form className="campaign-wizard" onSubmit={submit} noValidate aria-busy={busy}>
      <ol className="wizard-steps" aria-label={translate("Campaign steps", locale)}>
        {steps.map((title, index) => <li key={title}>
          <button type="button" disabled={busy || index + 1 > furthestStep} aria-current={step === index + 1 ? "step" : undefined} onClick={() => goToStep(index + 1)}>
            <span className="step-number">{index + 1}</span><span><T>{title}</T></span>
          </button>
        </li>)}
      </ol>
      <div className="wizard-layout">
        <div className="wizard-main">
          <div className="wizard-heading">
            <span className="eyebrow"><T>{"Step"}</T> {step} / 3</span>
            <h3 ref={heading} tabIndex={-1}><T>{steps[step - 1]}</T></h3>
            <p className="muted"><T>{descriptions[step - 1]}</T></p>
          </div>
          <fieldset key={step} disabled={busy} className="wizard-fields form workspace-step-enter">
            {step === 1 && <>
              <div className="field">
                <label htmlFor="wizardCampaignName"><T>{"Campaign name"}</T></label>
                <LocalizedInput id="wizardCampaignName" value={name} maxLength={160} required placeholder="e.g. October Product Launch" onChange={(event) => setName(event.target.value)}
                  aria-invalid={Boolean(fieldErrors.name)} aria-describedby={fieldErrors.name ? "wizard-name-error" : undefined} />
                {fieldErrors.name && <small id="wizard-name-error" className="field-error" role="alert"><T>{fieldErrors.name}</T></small>}
              </div>
              <div className="field">
                <label htmlFor="wizardContent"><T>{"Content"}</T></label>
                <select id="wizardContent" value={contentId} onChange={(event) => setContentId(event.target.value)} required aria-invalid={Boolean(fieldErrors.content)} aria-describedby={fieldErrors.content ? "wizard-content-error" : undefined}>
                  {contents.map((content) => <option key={content.id} value={content.id}>{content.name}</option>)}
                </select>
                {fieldErrors.content && <small id="wizard-content-error" className="field-error" role="alert"><T>{fieldErrors.content}</T></small>}
                {selectedContent && <div className="caption-preview"><span className="eyebrow"><T>{"Caption preview"}</T></span><p>{selectedContent.body}</p></div>}
              </div>
              <details className="wizard-advanced">
                <summary><T>{"Caption options"}</T></summary>
                <div className="field">
                  <label htmlFor="wizardVariant"><T>{"Variant strategy"}</T></label>
                  <select id="wizardVariant" value={variantStrategy} onChange={(event) => setVariantStrategy(event.target.value)}>
                    <option value="PRIMARY_ONLY"><T>{"Primary caption only"}</T></option>
                    <option value="ROUND_ROBIN"><T>{"Round robin variants"}</T></option>
                  </select>
                  <small><T>{"Round robin rotates through variants if any exist to vary post text."}</T></small>
                </div>
              </details>
            </>}
            {step === 2 && <>
              <div className="two-col">
                <div className="field">
                  <label htmlFor="wizardSearch"><T>{"Search groups"}</T></label>
                  <LocalizedInput id="wizardSearch" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Group name or category" aria-describedby={fieldErrors.groups ? "wizard-groups-error" : undefined} />
                </div>
                <div className="field">
                  <label htmlFor="wizardCategory"><T>{"Category"}</T></label>
                  <select id="wizardCategory" value={category} onChange={(event) => setCategory(event.target.value)}>
                    <option value=""><T>{"All categories"}</T></option>
                    {categories.map((item) => <option key={item}>{item}</option>)}
                  </select>
                </div>
              </div>
              <div className="selection-toolbar">
                <div className="buttons">
                  <button type="button" className="button small" disabled={!visibleGroups.length} onClick={() => setGroupIds((current) => [...new Set([...current, ...visibleGroups.map((group) => group.id)])])}><T>{"Select all shown"}</T></button>
                  <button type="button" className="button small" disabled={!groupIds.length} onClick={() => setGroupIds([])}><T>{"Deselect all"}</T></button>
                </div>
                <button type="button" className="selection-toggle" aria-pressed={selectedOnly} onClick={() => setSelectedOnly((current) => !current)}><T>{"Selected only"}</T> ({selectedGroups.length})</button>
              </div>
              <div className="group-picker" role="group" aria-labelledby="group-selection-count">
                {visibleGroups.length === 0 ? <div className="picker-empty">
                  <p><T>{"No active groups match these filters."}</T></p>
                  <button type="button" className="button small" onClick={() => { setSearch(""); setCategory(""); setSelectedOnly(false); }}><T>{"Clear filters"}</T></button>
                </div> : visibleGroups.map((group) => <label key={group.id} className={groupIds.includes(group.id) ? "is-selected" : undefined}>
                  <input type="checkbox" checked={groupIds.includes(group.id)} onChange={(event) => setGroupIds((current) => event.target.checked ? [...current, group.id] : current.filter((id) => id !== group.id))} />
                  <span>{group.name}</span><small>{group.category ?? <T>{"Uncategorized"}</T>}</small>
                </label>)}
              </div>
              <small id="group-selection-count" aria-live="polite">{selectedGroups.length}<T>{" selected"}</T> / {activeGroups.length}<T>{" active groups"}</T></small>
              {fieldErrors.groups && <small id="wizard-groups-error" className="field-error" role="alert"><T>{fieldErrors.groups}</T></small>}
            </>}
            {step === 3 && <>
              <div className="field">
                <label htmlFor="wizardStart"><T>{"Schedule start (optional)"}</T></label>
                <input id="wizardStart" type="datetime-local" value={scheduledStartAt} onChange={(event) => setScheduledStartAt(event.target.value)} aria-invalid={Boolean(fieldErrors.schedule)} aria-describedby={fieldErrors.schedule ? "wizard-schedule-error" : "wizard-start-hint"} />
                <small id="wizard-start-hint"><T>{"Leave blank to start immediately when you click Start."}</T></small>
                {fieldErrors.schedule && <small id="wizard-schedule-error" className="field-error" role="alert"><T>{fieldErrors.schedule}</T></small>}
              </div>
              <div className="two-col">
                <div className="field">
                  <label htmlFor="wizardMin"><T>{"Minimum interval in seconds"}</T></label>
                  <input id="wizardMin" type="number" min={2} step={1} value={minIntervalSeconds} onChange={(event) => setMinIntervalSeconds(event.target.value)} aria-invalid={Boolean(fieldErrors.interval)} aria-describedby={fieldErrors.interval ? "wizard-interval-error" : undefined} />
                </div>
                <div className="field">
                  <label htmlFor="wizardMax"><T>{"Maximum interval in seconds"}</T></label>
                  <input id="wizardMax" type="number" min={minimum || 2} step={1} value={maxIntervalSeconds} onChange={(event) => setMaxIntervalSeconds(event.target.value)} aria-invalid={Boolean(fieldErrors.interval)} aria-describedby={fieldErrors.interval ? "wizard-interval-error" : undefined} />
                </div>
              </div>
              {fieldErrors.interval && <small id="wizard-interval-error" className="field-error" role="alert"><T>{fieldErrors.interval}</T></small>}
              <div className="wizard-info"><T>{"These intervals space out queue jobs; actual posting time depends on the extension and Facebook."}</T></div>
              <div className="wizard-info"><strong><T>{"Save first, start when ready."}</T></strong><p><T>{"Creating a campaign does not publish any posts. Open it after saving to start the queue."}</T></p></div>
            </>}
          </fieldset>
          {error && <p className="error" role="alert"><T>{error}</T></p>}
        </div>
        <aside className="wizard-summary" aria-labelledby="wizard-summary-title">
          <span className="eyebrow"><T>{"Your campaign"}</T></span>
          <h3 id="wizard-summary-title">{name.trim() || <T>{"New campaign"}</T>}</h3>
          <div className="summary-section">
            <div className="row"><strong><T>{"Content"}</T></strong>{step > 1 && <button type="button" className="text-action" disabled={busy} onClick={() => goToStep(1)}><T>{"Edit content"}</T></button>}</div>
            <p>{selectedContent?.name ?? <T>{"Not selected yet"}</T>}</p>
            <small><T>{variantStrategy === "ROUND_ROBIN" ? "Round robin variants" : "Primary caption only"}</T></small>
          </div>
          <div className="summary-section">
            <div className="row"><strong><T>{"Groups"}</T></strong>{step > 2 && <button type="button" className="text-action" disabled={busy} onClick={() => goToStep(2)}><T>{"Edit groups"}</T></button>}</div>
            <p>{selectedGroups.length}<T>{" selected"}</T></p>
            {selectedGroups.length > 0 && <ul>{selectedGroups.slice(0, 3).map((group) => <li key={group.id}>{group.name}</li>)}</ul>}
            {selectedGroups.length > 3 && <small>+{selectedGroups.length - 3}<T>{" more groups"}</T></small>}
          </div>
          <div className="summary-section"><strong><T>{"Scheduled start"}</T></strong>
            <p>{scheduledStartAt ? scheduledStartAt.replace("T", " · ") : <T>{"When you start the campaign"}</T>}</p>
            {validIntervals && <small>{minimum}–{maximum}<T>{" seconds between groups"}</T></small>}
          </div>
        </aside>
      </div>
      <div className="wizard-footer">
        <div>{step > 1 && <button type="button" className="button" disabled={busy} onClick={() => goToStep(step - 1)}><T>{"Back"}</T></button>}</div>
        <button type="submit" className="button primary" disabled={busy} aria-busy={busy}>{busy && <LoadingDots />}<T>{busy ? "Creating…" : step === 3 ? "Create campaign" : "Continue"}</T></button>
      </div>
    </form>
  );
}

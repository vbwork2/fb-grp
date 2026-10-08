"use client";

import { T, LocalizedInput } from "@/components/language-provider";
import { useMemo, useState } from "react";
import { AlertCircleIcon } from "@/components/icons";

type GroupOption = { id: string; name: string; category: string | null; status: string };
type ContentOption = { id: string; name: string; body?: string };
type CampaignData = {
  id: string;
  contentId: string;
  name: string;
  status: string;
  minIntervalSeconds: number;
  maxIntervalSeconds: number;
  createdAt: Date | string;
};
type ApiResult<T> = { data: T | null; error: { message: string } | null };

const stepTitles = ["Campaign & Content", "Select Groups", "Schedule & Pacing", "Review & Confirm"];

export function CampaignWizard({
  groups,
  contents,
  onCreated,
}: {
  groups: GroupOption[];
  contents: ContentOption[];
  onCreated: (campaign: CampaignData) => void;
}) {
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
  const categories = useMemo(
    () =>
      [...new Set(activeGroups.map((group) => group.category).filter((value): value is string => Boolean(value)))].sort(),
    [activeGroups]
  );
  const visibleGroups = activeGroups.filter(
    (group) => group.name.toLowerCase().includes(search.toLowerCase()) && (!category || group.category === category)
  );
  const durationMinutes = Math.ceil(
    (Math.max(0, groupIds.length - 1) * (minIntervalSeconds + maxIntervalSeconds)) / 120
  );

  const selectedContent = contents.find((item) => item.id === contentId);

  function continueStep() {
    setError("");
    if (step === 1 && (!name.trim() || !contentId)) {
      setError("Enter a campaign name and choose content.");
      return;
    }
    if (step === 2 && groupIds.length === 0) {
      setError("Select at least one active group.");
      return;
    }
    if (step === 3 && (minIntervalSeconds < 60 || maxIntervalSeconds < minIntervalSeconds)) {
      setError("Use intervals of at least 60 seconds, with maximum at or above minimum.");
      return;
    }
    setStep((current) => Math.min(4, current + 1));
  }

  async function createCampaign() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/campaigns", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          contentId,
          groupIds,
          variantStrategy,
          minIntervalSeconds,
          maxIntervalSeconds,
          scheduledStartAt: scheduledStartAt ? new Date(scheduledStartAt).toISOString() : undefined,
        }),
      });
      const result = (await response.json()) as ApiResult<CampaignData>;
      if (!response.ok || !result.data) throw new Error(result.error?.message ?? "Unable to create campaign.");
      onCreated(result.data);
      setStep(1);
      setName("");
      setGroupIds([]);
      setScheduledStartAt("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to create campaign.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="form p-6 max-w-3xl">
      {/* Visual Stepper */}
      <div className="mb-6 pb-6 border-b border-slate-100">
        <div className="flex items-center justify-between mb-3">
          <strong className="text-sm font-semibold text-slate-900">
            <T>{"Step "}</T>
            {step}
            <T>{" of 4"}</T>
          </strong>
          <span className="text-xs font-medium text-blue-600 bg-blue-50 px-2.5 py-1 rounded-full border border-blue-100">
            <T>{["Campaign", "Groups", "Schedule", "Review"][step - 1]}</T>
          </span>
        </div>

        {/* Stepper Progress Bar */}
        <div className="grid grid-cols-4 gap-2">
          {stepTitles.map((title, index) => {
            const stepNum = index + 1;
            const isDone = step > stepNum;
            const isCurrent = step === stepNum;
            return (
              <div key={title} className="flex flex-col gap-1.5">
                <div
                  className={`h-1.5 rounded-full transition-all duration-300 ${
                    isDone ? "bg-emerald-500" : isCurrent ? "bg-blue-600" : "bg-slate-200"
                  }`}
                />
                <span
                  className={`text-[11px] font-medium truncate ${
                    isCurrent ? "text-blue-600 font-semibold" : isDone ? "text-slate-700" : "text-slate-400"
                  }`}
                >
                  {stepNum}. <T>{["Campaign", "Groups", "Schedule", "Review"][index]}</T>
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Step 1: Campaign & Content */}
      {step === 1 && (
        <div className="space-y-4">
          <div className="field">
            <label htmlFor="wizardCampaignName">
              <T>{"Campaign name"}</T>
            </label>
            <input
              id="wizardCampaignName"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. October Product Launch"
              maxLength={160}
              required
            />
            <small>
              <T>{"Give your campaign a clear, recognizable name."}</T>
            </small>
          </div>

          <div className="field">
            <label htmlFor="wizardContent">
              <T>{"Content"}</T>
            </label>
            <select
              id="wizardContent"
              value={contentId}
              onChange={(event) => setContentId(event.target.value)}
            >
              {contents.map((content) => (
                <option key={content.id} value={content.id}>
                  {content.name}
                </option>
              ))}
            </select>
            {selectedContent && (
              <div className="mt-2 p-3.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-600">
                <span className="font-semibold text-slate-800 block mb-1">
                  <T>{"Selected Content"}</T>: {selectedContent.name}
                </span>
                <p className="line-clamp-2 text-slate-500 m-0">{selectedContent.body ?? ""}</p>
              </div>
            )}
          </div>

          <div className="field">
            <label htmlFor="wizardVariant">
              <T>{"Variant strategy"}</T>
            </label>
            <select
              id="wizardVariant"
              value={variantStrategy}
              onChange={(event) => setVariantStrategy(event.target.value)}
            >
              <option value="PRIMARY_ONLY">
                <T>{"Primary caption only"}</T>
              </option>
              <option value="ROUND_ROBIN">
                <T>{"Round robin variants"}</T>
              </option>
            </select>
            <small>
              <T>{"Round robin rotates through variants if any exist to vary post text."}</T>
            </small>
          </div>
        </div>
      )}

      {/* Step 2: Target Groups */}
      {step === 2 && (
        <div className="space-y-4">
          <div className="two-col">
            <div className="field">
              <label htmlFor="wizardSearch">
                <T>{"Search groups"}</T>
              </label>
              <div className="relative">
                <LocalizedInput
                  id="wizardSearch"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Group name"
                />
              </div>
            </div>

            <div className="field">
              <label htmlFor="wizardCategory">
                <T>{"Category"}</T>
              </label>
              <select
                id="wizardCategory"
                value={category}
                onChange={(event) => setCategory(event.target.value)}
              >
                <option value="">
                  <T>{"All categories"}</T>
                </option>
                {categories.map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex items-center justify-between flex-wrap gap-2 pt-2">
            <div className="buttons">
              <button
                type="button"
                className="button small"
                onClick={() =>
                  setGroupIds((current) => [
                    ...new Set([...current, ...visibleGroups.map((group) => group.id)]),
                  ])
                }
              >
                <T>{"Select all shown"}</T>
              </button>
              <button
                type="button"
                className="button small"
                onClick={() => setGroupIds([])}
              >
                <T>{"Deselect all"}</T>
              </button>
            </div>
            <div className="badge blue text-xs font-semibold">
              <span>{groupIds.length}</span>
              <T>{" selected"}</T>
            </div>
          </div>

          <div className="group-picker">
            {visibleGroups.length === 0 ? (
              <p className="p-4 text-center text-sm text-slate-500 m-0">
                <T>{"No active groups match these filters."}</T>
              </p>
            ) : (
              visibleGroups.map((group) => {
                const isChecked = groupIds.includes(group.id);
                return (
                  <label
                    key={group.id}
                    className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors ${
                      isChecked ? "bg-blue-50/60" : "hover:bg-slate-50"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={(event) =>
                        setGroupIds((current) =>
                          event.target.checked
                            ? [...current, group.id]
                            : current.filter((id) => id !== group.id)
                        )
                      }
                      className="w-4 h-4 rounded text-blue-600 accent-blue-600"
                    />
                    <span className="font-medium text-slate-800 text-sm flex-1">{group.name}</span>
                    <small className="text-xs text-slate-500 bg-slate-100 px-2.5 py-0.5 rounded-full">
                      {group.category ?? <T>{"Uncategorized"}</T>}
                    </small>
                  </label>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* Step 3: Schedule & Pacing */}
      {step === 3 && (
        <div className="space-y-4">
          <div className="field">
            <label htmlFor="wizardStart">
              <T>{"Schedule start (optional)"}</T>
            </label>
            <input
              id="wizardStart"
              type="datetime-local"
              value={scheduledStartAt}
              onChange={(event) => setScheduledStartAt(event.target.value)}
            />
            <small>
              <T>{"Leave blank to start immediately when you click Start."}</T>
            </small>
          </div>

          <div className="two-col">
            <div className="field">
              <label htmlFor="wizardMin">
                <T>{"Minimum interval in seconds"}</T>
              </label>
              <input
                id="wizardMin"
                type="number"
                min={60}
                value={minIntervalSeconds}
                onChange={(event) => setMinIntervalSeconds(Number(event.target.value))}
              />
            </div>
            <div className="field">
              <label htmlFor="wizardMax">
                <T>{"Maximum interval in seconds"}</T>
              </label>
              <input
                id="wizardMax"
                type="number"
                min={60}
                value={maxIntervalSeconds}
                onChange={(event) => setMaxIntervalSeconds(Number(event.target.value))}
              />
            </div>
          </div>

          <div className="p-4 bg-blue-50/70 border border-blue-100 rounded-xl text-xs text-blue-900 space-y-1">
            <div className="font-semibold flex items-center gap-1.5 text-blue-800">
              <span>⏱</span>
              <T>{"Intervals control normal campaign pacing."}</T>
            </div>
            <p className="m-0 text-blue-700">
              <T>{"Spreading posts out across random delays helps respect Facebook community guidelines."}</T>
            </p>
          </div>
        </div>
      )}

      {/* Step 4: Review & Confirm */}
      {step === 4 && (
        <div className="space-y-4 bg-slate-50 border border-slate-200 rounded-xl p-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <div className="eyebrow">
                <T>{"Campaign"}</T>
              </div>
              <strong className="text-base text-slate-900 block">{name}</strong>
            </div>

            <div>
              <div className="eyebrow">
                <T>{"Content"}</T>
              </div>
              <strong className="text-base text-slate-900 block">
                {contents.find((item) => item.id === contentId)?.name ?? "Content"}
              </strong>
              <div className="text-xs text-slate-500 mt-0.5">
                <T>
                  {variantStrategy === "ROUND_ROBIN"
                    ? "Round robin variants"
                    : "Primary caption only"}
                </T>
              </div>
            </div>

            <div>
              <div className="eyebrow">
                <T>{"Groups"}</T>
              </div>
              <strong className="text-base text-slate-900 block">
                {groupIds.length}
                <T>{" selected"}</T>
              </strong>
            </div>

            <div>
              <div className="eyebrow">
                <T>{"Workflow duration"}</T>
              </div>
              <strong className="text-base text-slate-900 block">
                <T>{"About "}</T>
                {durationMinutes}
                <T>{" minutes"}</T>
              </strong>
            </div>
          </div>

          <div className="pt-3 border-t border-slate-200/80 flex items-center justify-between text-xs text-slate-600 flex-wrap gap-2">
            <div>
              <span className="font-medium text-slate-500">
                <T>{"Scheduled start"}</T>:{" "}
              </span>
              <strong>
                <T>
                  {scheduledStartAt
                    ? new Date(scheduledStartAt).toLocaleString()
                    : "When you start the campaign"}
                </T>
              </strong>
            </div>
            <div>
              <span className="font-medium text-slate-500">
                <T>{"Interval range: "}</T>
              </span>
              <strong>
                {minIntervalSeconds}–{maxIntervalSeconds}
                <T>{" seconds"}</T>
              </strong>
            </div>
          </div>
        </div>
      )}

      {/* Error Feedback */}
      {error && (
        <p className="error" role="alert">
          <AlertCircleIcon className="w-4 h-4 flex-shrink-0" />
          <span><T>{error}</T></span>
        </p>
      )}

      {/* Stepper Buttons */}
      <div className="flex items-center justify-between pt-4 border-t border-slate-100">
        <button
          type="button"
          className="button"
          disabled={step === 1 || busy}
          onClick={() => {
            setError("");
            setStep((current) => Math.max(1, current - 1));
          }}
        >
          <T>{"Back"}</T>
        </button>

        {step < 4 ? (
          <button type="button" className="button primary" onClick={continueStep}>
            <T>{"Continue"}</T>
          </button>
        ) : (
          <button
            type="button"
            className="button primary"
            disabled={busy}
            onClick={() => void createCampaign()}
          >
            <T>{busy ? "Creating…" : "Create campaign"}</T>
          </button>
        )}
      </div>
    </div>
  );
}

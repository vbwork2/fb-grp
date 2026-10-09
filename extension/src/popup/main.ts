import { translate, type Locale } from "../../../src/lib/i18n";
export {};

type Job = { id: string; publishAttempted?: boolean; campaign: string; group: { name: string; url: string }; content: { caption: string; linkUrl: string | null; media: { id: string; filename: string; mimeType: string }[] } };
type AutomaticRun = { runId: string; campaignId: string; enabled: boolean; status: string; error?: string; errorCode?: string; attempts: number; autoClickPost?: boolean; tabId?: number; groupName?: string; phase: "WAITING" | "OPENING" | "PREPARING" | "AWAITING_USER" | "VERIFYING" | "PAUSED" };
type Campaign = { id: string; name: string; status: string; groupCount: number; failedCount: number };

const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const statusMessage = byId<HTMLDivElement>("status");
byId<HTMLElement>("extensionVersion").textContent = "v" + chrome.runtime.getManifest().version;
const setup = byId<HTMLElement>("setup");
const workflow = byId<HTMLElement>("workflow");
const groupName = byId<HTMLDivElement>("groupName");
const groupInfo = byId<HTMLDivElement>("groupInfo");
const caption = byId<HTMLDivElement>("caption");
const mediaPanel = byId<HTMLDivElement>("media");
const apiUrl = byId<HTMLInputElement>("apiUrl");
const code = byId<HTMLInputElement>("code");

let locale: Locale = "vi";
let currentJob: Job | undefined;
let currentConnected = false;
let currentStatus = "";
let currentAutomatic: AutomaticRun | undefined;
let campaigns: Campaign[] = [];
let sending = false;
let autoClickPost = false;
const t = (value: string) => translate(value, locale);

function setStatus(value: string) {
  currentStatus = value;
  statusMessage.textContent = t(value);
}

function renderLanguage() {
  document.documentElement.lang = locale;
  document.querySelectorAll<HTMLElement>("[data-i18n]").forEach((element) => { element.textContent = t(element.dataset.i18n ?? ""); });
  byId<HTMLSelectElement>("language").value = locale;
  statusMessage.textContent = t(currentStatus);
  renderAutomatic();
}

function showJob(job?: Job, connected = Boolean(job)) {
  currentJob = job;
  currentConnected = connected;
  setup.classList.toggle("hidden", connected);
  workflow.classList.toggle("hidden", !connected);
  byId<HTMLButtonElement>("disconnect").classList.toggle("hidden", !connected);
  for (const id of ["open", "prepare", "copy", "publish", "posted", "skip", "failed"]) byId<HTMLButtonElement>(id).classList.toggle("hidden", !job);
  byId("imageConfirmation").classList.toggle("hidden", !job?.content.media.length);
  byId<HTMLInputElement>("imagesAttached").checked = false;
  if (!job) {
    groupName.textContent = t("No active job");
    groupInfo.textContent = t("Request the next available group from your queue.");
    caption.classList.add("hidden");
    mediaPanel.replaceChildren();
  } else {
    groupName.textContent = job.group.name;
    groupInfo.textContent = job.campaign;
    caption.textContent = [job.content.caption, job.content.linkUrl ?? ""].filter(Boolean).join("\n\n");
    caption.classList.remove("hidden");
    mediaPanel.replaceChildren(...job.content.media.map((file) => {
      const button = document.createElement("button");
      button.textContent = t(`View ${file.filename}`);
      button.onclick = () => void chrome.runtime.sendMessage({ type: "MEDIA", mediaId: file.id })
        .then((result: { ok: boolean; dataUrl?: string; error?: string }) => {
          if (!result.ok || !result.dataUrl) { setStatus(result.error ?? "Unable to load image."); return; }
          const preview = document.createElement("img");
          preview.src = result.dataUrl;
          preview.alt = file.filename;
          preview.style.cssText = "max-width:100%;max-height:180px;object-fit:contain;background:#fff;border-radius:6px";
          mediaPanel.replaceChildren(preview);
        }).catch(() => setStatus("Unable to load image."));
      return button;
    }));
    byId<HTMLButtonElement>("open").onclick = () => { void chrome.tabs.create({ url: job.group.url }); };
    byId<HTMLButtonElement>("copy").onclick = async () => { await navigator.clipboard.writeText(caption.textContent ?? ""); setStatus("Caption copied."); };
    byId<HTMLButtonElement>("prepare").onclick = () => void send({ type: "PREPARE" });
    byId<HTMLButtonElement>("publish").onclick = () => void send({ type: "PUBLISH", jobId: job.id, mediaConfirmed: byId<HTMLInputElement>("imagesAttached").checked });
    byId<HTMLButtonElement>("posted").onclick = () => {
      if (window.confirm(t("Have you checked Facebook and verified that this post is published?"))) void send({ type: "POSTED" }, true);
    };
    byId<HTMLButtonElement>("skip").onclick = () => void send({ type: "SKIP" }, true);
    byId<HTMLButtonElement>("failed").onclick = () => void send({ type: "FAILED" }, true);
  }
  renderAutomatic();
}

function renderAutomatic() {
  byId<HTMLButtonElement>("autoStart").textContent = t(autoClickPost ? "Start automatic posting" : "Start preparing posts");
  byId<HTMLInputElement>("autoClickPost").checked = autoClickPost;
  byId<HTMLInputElement>("autoClickPost").disabled = sending || Boolean(currentAutomatic?.enabled) || Boolean(currentJob?.publishAttempted);
  byId<HTMLElement>("autoHelp").textContent = t(autoClickPost ? "On: waits 5 seconds, clicks Post without checks, then waits 5 seconds before the next group." : "Off: review each prepared post and click Post on Facebook.");
  const run = currentAutomatic;
  const running = Boolean(run?.enabled);
  const paused = Boolean(run && !run.enabled && run.phase === "PAUSED");
  const failed = Boolean(paused && run?.error);
  const select = byId<HTMLSelectElement>("autoCampaign");
  const selectedCampaign = campaigns.find((item) => item.id === select.value);
  byId<HTMLElement>("campaignHint").textContent = selectedCampaign
    ? `${selectedCampaign.groupCount} ${t("selected groups")} · ${t(selectedCampaign.status)}`
    : t("Posts are prepared one group at a time. You click Post on Facebook.");
  byId<HTMLButtonElement>("autoStart").disabled = sending || running || !select.value || Boolean(currentJob?.publishAttempted);
  byId<HTMLButtonElement>("autoStop").disabled = sending || !running;
  byId<HTMLButtonElement>("autoRetry").classList.toggle("hidden", !failed || Boolean(currentJob?.publishAttempted) || Boolean(selectedCampaign?.failedCount));
  byId<HTMLButtonElement>("autoRetry").disabled = sending;
  const postPending = Boolean(currentJob?.publishAttempted && run && (!run.autoClickPost || run.phase === "PAUSED") &&
    currentJob && ["AWAITING_USER", "VERIFYING", "PAUSED"].includes(run.phase));
  byId<HTMLButtonElement>("autoConfirm").classList.toggle("hidden", !postPending);
  byId<HTMLButtonElement>("autoConfirm").disabled = sending;
  const failedGroups = selectedCampaign?.failedCount ?? 0;
  byId<HTMLButtonElement>("autoReset").classList.toggle("hidden", !run || selectedCampaign?.id !== run.campaignId || !failedGroups || running);
  byId<HTMLButtonElement>("autoReset").disabled = sending;
  const canCancel = Boolean(run?.campaignId && !["Campaign cancelled.", "Automatic posting completed."].includes(run.status));
  byId<HTMLButtonElement>("autoCancel").classList.toggle("hidden", !canCancel);
  byId<HTMLButtonElement>("autoCancel").disabled = sending;
  byId<HTMLButtonElement>("autoRefresh").disabled = sending || running;
  select.disabled = running || sending;
  const state = byId<HTMLElement>("autoState");
  state.classList.toggle("running", running);
  state.classList.toggle("error", failed);
  byId<HTMLElement>("autoStateLabel").textContent = run?.status === "Automatic posting completed." ? t("COMPLETED") : running ? t("RUNNING") : failed ? t("NEEDS ATTENTION") : t("READY");
  const title = !run ? "Ready to post" : failed ? "Posting paused — action needed" : running
    ? run.phase === "OPENING" ? "Opening Facebook Group"
      : run.phase === "PREPARING" ? "Preparing the post"
        : run.phase === "AWAITING_USER" ? "Click Post on Facebook"
          : run.phase === "VERIFYING" ? run.autoClickPost ? "Waiting 5 seconds before the next group" : "Checking Facebook confirmation"
            : "Waiting for scheduled post"
    : run.status === "Automatic posting completed." ? "Posting completed" : "Posting stopped";
  byId<HTMLElement>("autoStatusTitle").textContent = t(title);
  const details = run ? [run.groupName, run.error || run.status, `${t("Prepared jobs")}: ${run.attempts}`].filter(Boolean).map((value) => t(String(value))).join(" · ") : t("Choose a campaign and press Start posting.");
  byId<HTMLElement>("automaticStatus").textContent = details;
  byId<HTMLElement>("debugErrorCode").textContent = run?.errorCode ?? "";
  const step = running ? run!.phase === "OPENING" ? 1 : run!.phase === "PREPARING" ? 2 :
    ["AWAITING_USER", "VERIFYING"].includes(run!.phase) ? 3 : 0 : 0;
  for (let index = 1; index <= 3; index++) {
    const element = byId<HTMLElement>(`autoStep${index}`);
    element.classList.toggle("active", step === index);
    element.classList.toggle("done", step > index);
  }
  byId<HTMLButtonElement>("autoOpen").classList.toggle("hidden", !run?.tabId);
  for (const id of ["next", "prepare", "publish", "posted", "skip", "failed", "disconnect"]) {
    byId<HTMLButtonElement>(id).disabled = running || sending || (["next", "publish", "skip", "failed"].includes(id) && Boolean(currentJob?.publishAttempted));
  }
}

async function send(message: { type: string; enabled?: boolean; apiUrl?: string; code?: string; jobId?: string; mediaConfirmed?: boolean; campaignId?: string }, clear = false) {
  if (sending) return;
  sending = true;
  setStatus(message.type === "AUTO_START" ? "Starting automation…" : "");
  if (message.type === "AUTO_START" || message.type === "AUTO_STOP") renderAutomatic();
  try {
    const result = await chrome.runtime.sendMessage(message) as { ok: boolean; message?: string; error?: string; job?: Job | null };
    if (!result.ok) throw new Error(result.error ?? "Request failed.");
    if (message.type === "PAIR") { showJob(undefined, true); setStatus("Device connected."); void refreshCampaigns(); }
    if (message.type === "NEXT") showJob(result.job ?? undefined, true);
    if (message.type === "PUBLISH") setStatus(result.message ?? "Publish was sent to Facebook. Check the result, then confirm it in history.");
    if (clear) { showJob(undefined, true); setStatus(message.type === "POSTED" ? "Post confirmed in history." : message.type === "SKIP" ? "Group skipped." : "Issue recorded in history."); }
    if (["AUTO_START", "AUTO_STOP", "AUTO_CANCEL_CAMPAIGN", "AUTO_RESET_FAILED", "AUTO_CONFIRM_POST"].includes(message.type)) {
      const saved = await chrome.storage.local.get("automatic");
      currentAutomatic = saved.automatic as AutomaticRun | undefined;
      setStatus(message.type === "AUTO_RESET_FAILED"
        ? `${(result as { reset?: number }).reset ?? 0} ${t("failed groups reset.")}`
        : "");
      if (["AUTO_RESET_FAILED", "AUTO_CANCEL_CAMPAIGN", "AUTO_CONFIRM_POST"].includes(message.type)) {
        await refreshCampaigns();
        const current = await chrome.storage.local.get("job");
        currentJob = current.job as Job | undefined;
        showJob(currentJob, currentConnected);
      }
    }
  } catch (cause) {
    const saved = await chrome.storage.local.get("deviceToken");
    if (!saved.deviceToken) showJob(undefined, false);
    setStatus(cause instanceof Error ? cause.message : "Request failed.");
  } finally {
    sending = false;
    if (message.type === "PUBLISH") {
      const saved = await chrome.storage.local.get("job");
      if (saved.job) currentJob = saved.job as Job;
    }
    renderAutomatic();
  }
}

async function refreshCampaigns() {
  try {
    const result = await chrome.runtime.sendMessage({ type: "AUTO_CAMPAIGNS" }) as { ok: boolean; error?: string; items?: Campaign[] };
    if (!result.ok) throw new Error(result.error ?? "Request failed.");
    campaigns = result.items ?? [];
    const select = byId<HTMLSelectElement>("autoCampaign");
    const selected = currentAutomatic?.enabled ? currentAutomatic.campaignId : select.value || currentAutomatic?.campaignId;
    select.replaceChildren(...(campaigns.length ? campaigns.map((campaign) => {
      const option = document.createElement("option");
      option.value = campaign.id;
      option.textContent = `${campaign.name} (${campaign.groupCount})`;
      return option;
    }) : [(() => {
      const option = document.createElement("option"); option.value = ""; option.textContent = t("No campaigns available"); return option;
    })()]));
    if ([...select.options].some((option) => option.value === selected)) select.value = selected!;
    renderAutomatic();
  } catch (cause) {
    setStatus(cause instanceof Error ? cause.message : "Request failed.");
  }
}

void chrome.storage.local.get(["apiUrl", "deviceToken", "job", "locale", "automatic", "autoClickPost"]).then((saved) => {
  autoClickPost = saved.autoClickPost === true;
  locale = saved.locale === "en" ? "en" : "vi";
  apiUrl.value = String(saved.apiUrl ?? "");
  currentAutomatic = saved.automatic as AutomaticRun | undefined;
  showJob(saved.job as Job | undefined, Boolean(saved.deviceToken));
  renderLanguage();
  if (saved.deviceToken) void refreshCampaigns();
});

byId<HTMLButtonElement>("pair").onclick = () => {
  void (async () => {
    try {
      const url = new URL(apiUrl.value);
      if (url.protocol !== "https:" && url.origin !== "http://localhost:3000") throw new Error("Use HTTPS for the application URL.");
      // Request only the selected app origin during this user gesture.
      const granted = await chrome.permissions.request({ origins: [url.origin + "/*"] });
      if (!granted) throw new Error("Allow access to the application domain to pair this extension.");
      await send({ type: "PAIR", apiUrl: url.origin, code: code.value });
    } catch (error) { setStatus(error instanceof Error ? error.message : "Pairing failed."); }
  })();
};
byId<HTMLButtonElement>("next").onclick = () => void send({ type: "NEXT" });
byId<HTMLButtonElement>("disconnect").onclick = () => void send({ type: "DISCONNECT" }).then(() => { showJob(undefined, false); setStatus("Device disconnected from this browser."); });
byId<HTMLSelectElement>("language").onchange = async (event) => {
  locale = (event.target as HTMLSelectElement).value === "en" ? "en" : "vi";
  await chrome.storage.local.set({ locale });
  renderLanguage();
  showJob(currentJob, currentConnected);
  await refreshCampaigns();
};
byId<HTMLInputElement>("autoClickPost").onchange = async (event) => {
  autoClickPost = (event.target as HTMLInputElement).checked;
  await send({ type: "AUTO_SET_PUBLISH", enabled: autoClickPost });
  autoClickPost = (await chrome.storage.local.get("autoClickPost")).autoClickPost === true;
  renderAutomatic();
};
byId<HTMLSelectElement>("autoCampaign").onchange = () => renderAutomatic();
byId<HTMLButtonElement>("autoRefresh").onclick = () => void refreshCampaigns();
byId<HTMLButtonElement>("autoStart").onclick = () => void send({ type: "AUTO_START", campaignId: byId<HTMLSelectElement>("autoCampaign").value });
byId<HTMLButtonElement>("autoStop").onclick = () => void send({ type: "AUTO_STOP" });
byId<HTMLButtonElement>("autoCancel").onclick = () => {
  if (window.confirm(t("Cancel this campaign? Unposted groups will not continue."))) void send({ type: "AUTO_CANCEL_CAMPAIGN" });
};
byId<HTMLButtonElement>("autoReset").onclick = () => {
  if (window.confirm(t("Reset failed groups? Only confirmed failures are reset; uncertain posts stay locked.")))
    void send({ type: "AUTO_RESET_FAILED" });
};
byId<HTMLButtonElement>("autoConfirm").onclick = () => {
  if (window.confirm(t("Have you checked Facebook and verified that this post is published?")))
    void send({ type: "AUTO_CONFIRM_POST" });
};
byId<HTMLButtonElement>("autoRetry").onclick = () => void send({ type: "AUTO_START", campaignId: currentAutomatic?.campaignId });
byId<HTMLButtonElement>("autoOpen").onclick = async () => {
  try {
    const tabId = currentAutomatic?.tabId;
    if (!tabId) return;
    const tab = await chrome.tabs.get(tabId);
    if (!tab.windowId) return;
    await chrome.windows.update(tab.windowId, { focused: true });
    await chrome.tabs.update(tabId, { active: true });
  } catch { setStatus("The Facebook Group could not be opened."); }
};
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.autoClickPost) autoClickPost = changes.autoClickPost.newValue === true;
  if (changes.automatic) {
    currentAutomatic = changes.automatic.newValue as AutomaticRun | undefined;
    // Preparation failures update the server queue before pausing the worker.
    // Refresh counts so recovery shows Reset failed groups rather than Retry.
    if (currentAutomatic?.phase === "PAUSED" && currentAutomatic.error) void refreshCampaigns();
  }
  if (changes.job) showJob(changes.job.newValue as Job | undefined, currentConnected);
  renderAutomatic();
});

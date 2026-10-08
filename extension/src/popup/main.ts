import { translate, type Locale } from "../../../src/lib/i18n";
export {};

type Job = { id: string; publishAttempted?: boolean; campaign: string; group: { name: string; url: string }; content: { caption: string; linkUrl: string | null; media: { id: string; filename: string; mimeType: string }[] } };

const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const statusMessage = byId<HTMLDivElement>("status");
const setup = byId<HTMLElement>("setup");
const workflow = byId<HTMLElement>("workflow");
const groupName = byId<HTMLDivElement>("groupName");
const groupInfo = byId<HTMLDivElement>("groupInfo");
const caption = byId<HTMLDivElement>("caption");
const mediaPanel = byId<HTMLDivElement>("media");
const apiUrl = byId<HTMLInputElement>("apiUrl");
const code = byId<HTMLInputElement>("code");

let locale: Locale = "en";
let currentJob: Job | undefined;
let currentConnected = false;
let currentStatus = "";
type AutomaticRun = { enabled: boolean; status: string; error?: string; attempts: number };
let currentAutomatic: AutomaticRun | undefined;
const t = (text: string) => translate(text, locale);
function setStatus(text: string) { currentStatus = text; statusMessage.textContent = t(text); }
function renderLanguage() {
  document.documentElement.lang = locale;
  document.querySelectorAll<HTMLElement>("[data-i18n]").forEach((element) => { element.textContent = t(element.dataset.i18n ?? ""); });
  byId<HTMLLabelElement>("languageLabel").textContent = locale === "vi" ? "Ngôn ngữ" : "Language";
  byId<HTMLSelectElement>("language").value = locale;
  statusMessage.textContent = t(currentStatus);
  renderAutomatic();
}
function showJob(job?: Job, connected = Boolean(job)) {
  currentJob = job; currentConnected = connected;
  setup.classList.toggle("hidden", connected);
  workflow.classList.toggle("hidden", !connected);
  for (const id of ["open", "prepare", "copy", "publish", "posted", "skip", "failed"]) byId<HTMLButtonElement>(id).classList.toggle("hidden", !job);
  byId("imageConfirmation").classList.toggle("hidden", !job?.content.media.length);
  byId<HTMLInputElement>("imagesAttached").checked = false;
  byId<HTMLButtonElement>("publish").disabled = Boolean(job?.publishAttempted);
  if (!job) { groupName.textContent = t("No active job"); groupInfo.textContent = t("Request the next available group from your queue."); caption.classList.add("hidden"); mediaPanel.replaceChildren(); return; }
  groupName.textContent = job.group.name;
  groupInfo.textContent = job.campaign;
  caption.textContent = [job.content.caption, job.content.linkUrl ?? ""].filter(Boolean).join("\n\n");
  caption.classList.remove("hidden");
  mediaPanel.replaceChildren(...job.content.media.map((file) => {
    const button = document.createElement("button"); button.textContent = t(`View ${file.filename}`);
    button.onclick = () => void chrome.runtime.sendMessage({ type: "MEDIA", mediaId: file.id }).then((result: { ok: boolean; dataUrl?: string; error?: string }) => {
      if (!result.ok || !result.dataUrl) { setStatus(result.error ?? "Unable to load image."); return; }
      const preview = document.createElement("img"); preview.src = result.dataUrl; preview.alt = file.filename; preview.style.maxWidth = "100%"; preview.style.maxHeight = "180px"; preview.style.objectFit = "contain"; preview.style.background = "white"; preview.style.borderRadius = "6px"; mediaPanel.replaceChildren(preview);
    });
    return button;
  }));
  byId<HTMLButtonElement>("open").onclick = () => { void chrome.tabs.create({ url: job.group.url }); };
  byId<HTMLButtonElement>("copy").onclick = async () => { await navigator.clipboard.writeText(caption.textContent ?? ""); setStatus("Caption copied."); };
  byId<HTMLButtonElement>("prepare").onclick = () => void send({ type: "PREPARE" });
  byId<HTMLButtonElement>("publish").onclick = () => void send({ type: "PUBLISH", jobId: job.id, mediaConfirmed: byId<HTMLInputElement>("imagesAttached").checked });
  byId<HTMLButtonElement>("posted").onclick = () => void send({ type: "POSTED" }, true);
  byId<HTMLButtonElement>("skip").onclick = () => void send({ type: "SKIP" }, true);
  byId<HTMLButtonElement>("failed").onclick = () => void send({ type: "FAILED" }, true);
}

async function send(message: { type: string; apiUrl?: string; code?: string; jobId?: string; mediaConfirmed?: boolean; campaignId?: string }, clear = false) {
  setStatus("");
  if (message.type === "PUBLISH") byId<HTMLButtonElement>("publish").disabled = true;
  try {
    const result = await chrome.runtime.sendMessage(message) as { ok: boolean; message?: string; error?: string; job?: Job | null };
    if (!result.ok) throw new Error(result.error ?? "Request failed.");
    if (message.type === "PAIR") { showJob(undefined, true); setStatus("Device connected."); void refreshCampaigns(); }
    if (message.type === "NEXT") showJob(result.job ?? undefined, true);
    if (message.type === "PUBLISH") setStatus(result.message ?? "Publish was sent to Facebook. Check the result, then confirm it in history.");
    if (clear) { showJob(undefined, true); setStatus(message.type === "POSTED" ? "Post confirmed in history." : message.type === "SKIP" ? "Group skipped." : "Issue recorded in history."); }
  } catch (cause) {
    const saved = await chrome.storage.local.get("deviceToken");
    if (!saved.deviceToken) showJob(undefined, false);
    setStatus(cause instanceof Error ? cause.message : "Request failed.");
  } finally {
    if (message.type === "PUBLISH") {
      const saved = await chrome.storage.local.get("job");
      if (saved.job) currentJob = saved.job as Job;
      byId<HTMLButtonElement>("publish").disabled = Boolean((saved.job as Job | undefined)?.publishAttempted);
    }
  }
}

void chrome.storage.local.get(["apiUrl", "deviceToken", "job", "locale", "automatic"]).then((saved) => {
  locale = saved.locale === "vi" ? "vi" : "en";
  renderLanguage();
  apiUrl.value = String(saved.apiUrl ?? "");
  setup.classList.toggle("hidden", Boolean(saved.deviceToken));
  workflow.classList.toggle("hidden", !saved.deviceToken);
  showJob(saved.job as Job | undefined, Boolean(saved.deviceToken));
  currentAutomatic = saved.automatic as AutomaticRun | undefined;
  renderAutomatic();
  if (saved.deviceToken) void refreshCampaigns();
});

byId<HTMLButtonElement>("pair").onclick = () => void send({ type: "PAIR", apiUrl: apiUrl.value, code: code.value });
byId<HTMLButtonElement>("next").onclick = () => void send({ type: "NEXT" });
byId<HTMLButtonElement>("disconnect").onclick = () => void send({ type: "DISCONNECT" }).then(() => { setStatus("Device disconnected from this browser."); showJob(undefined, false); });

byId<HTMLSelectElement>("language").onchange = async (event) => {
  locale = (event.target as HTMLSelectElement).value === "vi" ? "vi" : "en";
  await chrome.storage.local.set({ locale });
  renderLanguage();
  showJob(currentJob, currentConnected);
  renderAutomatic();
};


function renderAutomatic() {
  const running = Boolean(currentAutomatic?.enabled);
  byId<HTMLButtonElement>("autoStart").disabled = running || !byId<HTMLSelectElement>("autoCampaign").value;
  byId<HTMLButtonElement>("autoStop").disabled = !running;
  byId<HTMLSelectElement>("autoCampaign").disabled = running;
  byId("automaticStatus").textContent = currentAutomatic ? [t(currentAutomatic.status), currentAutomatic.error ? t(currentAutomatic.error) : ""].filter(Boolean).join(" ") : "";
  for (const id of ["next", "prepare", "publish", "posted", "skip", "failed", "disconnect"]) byId<HTMLButtonElement>(id).disabled = running || (["next", "publish"].includes(id) && Boolean(currentJob?.publishAttempted));
}

async function refreshCampaigns() {
  const result = await chrome.runtime.sendMessage({ type: "AUTO_CAMPAIGNS" }) as { ok: boolean; error?: string; items?: { id: string; name: string; status: string }[] };
  if (!result.ok) { setStatus(result.error ?? "Request failed."); return; }
  const select = byId<HTMLSelectElement>("autoCampaign");
  const selected = select.value;
  select.replaceChildren(...(result.items ?? []).map((campaign) => {
    const option = document.createElement("option"); option.value = campaign.id; option.textContent = campaign.name; return option;
  }));
  if ([...select.options].some((option) => option.value === selected)) select.value = selected;
  renderAutomatic();
}

byId<HTMLSelectElement>("autoCampaign").onchange = () => renderAutomatic();
byId<HTMLButtonElement>("autoRefresh").onclick = () => void refreshCampaigns();
byId<HTMLButtonElement>("autoStart").onclick = () => void send({ type: "AUTO_START", campaignId: byId<HTMLSelectElement>("autoCampaign").value });
byId<HTMLButtonElement>("autoStop").onclick = () => void send({ type: "AUTO_STOP" });
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.automatic) currentAutomatic = changes.automatic.newValue as AutomaticRun | undefined;
  if (changes.job) showJob(changes.job.newValue as Job | undefined, currentConnected);
  renderAutomatic();
});

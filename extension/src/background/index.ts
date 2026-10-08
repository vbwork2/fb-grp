type Job = { id: string; claimToken: string; publishAttempted?: boolean; campaignId?: string; campaign: string; group: { id: string; name: string; url: string }; content: { name: string; caption: string; linkUrl: string | null; media: { id: string; mimeType: string; filename: string }[] } };

async function settings() {
  return chrome.storage.local.get(["apiUrl", "deviceToken", "job"]) as Promise<{ apiUrl?: string; deviceToken?: string; job?: Job }>;
}

async function api<T>(path: string, body?: unknown): Promise<T> {
  const saved = await settings();
  if (!saved.apiUrl || !saved.deviceToken) throw new Error("Pair this extension with your Groupflow account first.");
  const url = new URL(path, `${saved.apiUrl.replace(/\/$/, "")}/`);
  const response = await fetch(url, { method: body ? "POST" : "GET", headers: { authorization: `Bearer ${saved.deviceToken}`, ...(body ? { "content-type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const result = await response.json() as { data: T | null; error: { code: string; message: string } | null };
  if (!response.ok || result.error) {
    if (response.status === 401) await chrome.storage.local.remove(["deviceToken", "job"]);
    throw new Error(result.error?.message ?? "Request failed.");
  }
  return result.data as T;
}

async function mediaData(id: string): Promise<string> {
  const saved = await settings();
  if (!saved.apiUrl || !saved.deviceToken) throw new Error("Pair this extension with your Groupflow account first.");
  const response = await fetch(new URL(`/api/extension/media/${id}`, `${saved.apiUrl.replace(/\/$/, "")}/`), { headers: { authorization: `Bearer ${saved.deviceToken}` } });
  if (!response.ok) throw new Error("Unable to load this campaign image.");
  const bytes = new Uint8Array(await response.arrayBuffer());
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 32_768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32_768));
  return `data:${response.headers.get("content-type") ?? "application/octet-stream"};base64,${btoa(binary)}`;
}

const publishing = new Set<string>();

function sameGroup(actual: string | undefined, expected: string): boolean {
  try {
    const current = new URL(actual ?? ""); const target = new URL(expected);
    const currentGroup = /^\/groups\/([^/]+)/.exec(current.pathname)?.[1];
    const targetGroup = /^\/groups\/([^/]+)/.exec(target.pathname)?.[1];
    return current.protocol === "https:" && ["facebook.com", "www.facebook.com", "m.facebook.com"].includes(current.hostname) && Boolean(targetGroup) && currentGroup === targetGroup;
  } catch { return false; }
}

chrome.runtime.onMessage.addListener((message: { type: string; apiUrl?: string; code?: string; mediaId?: string; jobId?: string; mediaConfirmed?: boolean; campaignId?: string }, _sender, sendResponse) => {
  void (async () => {
    try {
      if (message.type === "AUTO_CAMPAIGNS") { sendResponse({ ok: true, ...(await api("/api/extension/campaigns") as object) }); return; }
      if (message.type === "AUTO_START") { await startAutomatic(message.campaignId); sendResponse({ ok: true }); return; }
      if (message.type === "AUTO_STOP") { await stopAutomatic(); sendResponse({ ok: true }); return; }
      const activeRun = (await chrome.storage.local.get("automatic")).automatic as AutomaticRun | undefined;
      if (activeRun?.enabled && ["NEXT", "PAIR", "DISCONNECT", "POSTED", "SKIP", "FAILED", "PREPARE", "PUBLISH"].includes(message.type)) throw new Error("Stop automatic posting before using manual controls.");
      if (publishing.size && ["NEXT", "PAIR", "DISCONNECT", "POSTED", "SKIP", "FAILED", "PREPARE"].includes(message.type)) throw new Error("Publishing is in progress. Wait before changing the current job.");
      if (message.type === "PAIR") {
        if (!message.apiUrl || !message.code) throw new Error("Enter the application URL and pairing code.");
        const baseUrl = new URL(message.apiUrl);
        if (baseUrl.protocol !== "https:" && baseUrl.hostname !== "localhost") throw new Error("Use an HTTPS application URL.");
        const response = await fetch(new URL("/api/extension/pair", baseUrl), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: message.code, name: "Chrome Extension" }) });
        const result = await response.json() as { data: { deviceToken: string } | null; error: { message: string } | null };
        if (!response.ok || !result.data) throw new Error(result.error?.message ?? "Pairing failed.");
        await chrome.storage.local.set({ apiUrl: baseUrl.origin, deviceToken: result.data.deviceToken });
        sendResponse({ ok: true });
        return;
      }
      if (message.type === "DISCONNECT") {
        await chrome.storage.local.remove(["deviceToken", "job"]);
        sendResponse({ ok: true });
        return;
      }
      if (message.type === "NEXT") {
        if ((await settings()).job?.publishAttempted) throw new Error("A publish attempt was already sent. Check Facebook before confirming the result.");
        const result = await api<{ job: Job | null }>("/api/extension/jobs/next");
        if (!result.job) { await chrome.storage.local.remove("job"); sendResponse({ ok: true, job: null }); return; }
        await chrome.storage.local.set({ job: result.job });
        await chrome.tabs.create({ url: result.job.group.url, active: true });
        sendResponse({ ok: true, job: result.job });
        return;
      }
      if (message.type === "POSTED" || message.type === "SKIP" || message.type === "FAILED") {
        const saved = await settings();
        const job = saved.job;
        if (!job) throw new Error("There is no active job.");
        const path = `/api/extension/jobs/${job.id}/${message.type === "POSTED" ? "posted" : message.type === "SKIP" ? "skip" : "failed"}`;
        await api(path, message.type === "FAILED" ? { claimToken: job.claimToken, errorMessage: "The user could not continue this group workflow." } : { claimToken: job.claimToken });
        await chrome.storage.local.remove("job");
        sendResponse({ ok: true });
        return;
      }
      if (message.type === "PREPARE" || message.type === "PUBLISH") {
        const saved = await settings();
        if (!saved.job) throw new Error("There is no active job.");
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id || !sameGroup(tab.url, saved.job.group.url)) throw new Error("Open the exact Facebook Group for this job before continuing.");
        const job = saved.job;
        if (message.type === "PREPARE") {
          const result = await chrome.tabs.sendMessage(tab.id, { type: "PREPARE_CAPTION", jobId: job.id, expectedGroupUrl: job.group.url, caption: job.content.caption, linkUrl: job.content.linkUrl });
          if (!result?.ok) throw new Error(result?.message ?? "Composer not found. Copy the caption and paste it into Facebook yourself.");
          sendResponse({ ok: true });
        } else {
          if (message.jobId !== job.id) throw new Error("The selected job changed. Review the current job before publishing.");
          if (job.publishAttempted || publishing.has(job.id)) throw new Error("A publish attempt was already sent. Check Facebook before confirming the result.");
          if (job.content.media.length && !message.mediaConfirmed) throw new Error("Attach this job's images in Facebook and check Images attached before publishing.");
          publishing.add(job.id);
          try {
            await api(`/api/extension/jobs/${job.id}/submission`, { claimToken: job.claimToken, action: "begin" });
            // Persist before the Facebook action, including uncertain connection outcomes.
            await chrome.storage.local.set({ job: { ...job, publishAttempted: true } });
            const result = await chrome.tabs.sendMessage(tab.id, { type: "PUBLISH_POST", jobId: job.id, expectedGroupUrl: job.group.url, caption: job.content.caption, linkUrl: job.content.linkUrl });
            if (result?.clicked === false) {
              await api(`/api/extension/jobs/${job.id}/submission`, { claimToken: job.claimToken, action: "release" });
              await chrome.storage.local.set({ job });
            }
            if (!result?.ok) throw new Error(result?.message ?? "The Facebook action could not be completed. Check Facebook before trying again.");
            sendResponse({ ok: true, message: result.message });
          } finally { publishing.delete(job.id); }
        }
        return;
      }
      if (message.type === "MEDIA" && message.mediaId) {
        sendResponse({ ok: true, dataUrl: await mediaData(message.mediaId) });
      }
    } catch (cause) {
      sendResponse({ ok: false, error: cause instanceof Error ? cause.message : "Extension request failed." });
    }
  })();
  return true;
});



type AutomaticRun = { runId: string; campaignId: string; enabled: boolean; attempts: number; tabId?: number; status: string; error?: string; phase: "WAITING" | "OPENING" | "PREPARING" | "SUBMITTING" | "PAUSED"; groupName?: string };
const automaticAlarm = "groupflow-automatic";
let automaticBusy = false;

async function automaticState(): Promise<AutomaticRun | undefined> { return (await chrome.storage.local.get("automatic")).automatic as AutomaticRun | undefined; }
async function active(run: AutomaticRun) {
  const state = await automaticState();
  if (!state?.enabled || state.runId !== run.runId) throw new Error("Automatic posting was stopped.");
  return state;
}
async function announceAutomatic(state: AutomaticRun) {
  if (!state.tabId) return;
  await chrome.tabs.sendMessage(state.tabId, {
    type: "AUTO_PROGRESS", phase: state.phase, status: state.status,
    error: state.error, enabled: state.enabled
  }).catch(() => undefined);
}
async function updateAutomatic(run: AutomaticRun, values: Partial<AutomaticRun>) {
  const state = await active(run);
  const next = { ...state, ...values };
  await chrome.storage.local.set({ automatic: next });
  Object.assign(run, next);
  await announceAutomatic(next);
}
async function stopAutomatic(error = "") {
  const state = await automaticState();
  if (!state) return;
  await chrome.storage.local.set({ automatic: { ...state, enabled: false, phase: "PAUSED", status: "Automatic posting stopped.", error } });
  await chrome.alarms.clear(automaticAlarm);
  await announceAutomatic({ ...state, enabled: false, phase: "PAUSED", error });
  const job = (await settings()).job;
  if (state.tabId && job) await chrome.tabs.sendMessage(state.tabId, { type: "CANCEL_JOB", jobId: job.id }).catch(() => undefined);
}
async function startAutomatic(campaignId?: string) {
  if (!campaignId) throw new Error("Choose a campaign with at most three groups.");
  if (!chrome.alarms) throw new Error("The Facebook adapter is unavailable. Reload the extension and Facebook tab.");
  if (automaticBusy || publishing.size) throw new Error("Wait for the previous Facebook action to finish.");
  const saved = await settings();
  if (saved.job?.publishAttempted) throw new Error("A publish attempt was already sent. Check Facebook before confirming the result.");
  if (saved.job && saved.job.campaignId !== campaignId) throw new Error("Resolve the current job before starting another campaign.");
  await api("/api/extension/campaigns", { campaignId });
  const previous = await automaticState();
  const run: AutomaticRun = { runId: crypto.randomUUID(), campaignId, enabled: true, attempts: 0, tabId: previous?.tabId, phase: "WAITING", status: "Automatic posting started." };
  await chrome.storage.local.set({ automatic: run });
  await chrome.alarms.create(automaticAlarm, { periodInMinutes: 1 });
  void runAutomatic();
}
async function loadedTab(tabId: number, run: AutomaticRun): Promise<chrome.tabs.Tab> {
  for (let step = 0; step < 80; step++) {
    await active(run);
    const tab = await chrome.tabs.get(tabId);
    if (tab.status === "complete") return tab;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("The Facebook Group did not finish loading.");
}
async function runAutomatic() {
  if (automaticBusy) return;
  automaticBusy = true;
  const initial = await automaticState().catch(() => undefined);
  if (!initial?.enabled) { automaticBusy = false; return; }
  const run = { ...initial };
  try {
    const saved = await settings();
    if (run.phase === "SUBMITTING" || saved.job?.publishAttempted) throw new Error("The previous submission needs review before automatic posting can continue.");
    if (run.attempts >= 3) { await stopAutomatic(); return; }
    const reply = saved.job ? { job: saved.job } : await api<{ job: Job | null; campaignStatus?: string; remaining?: number }>(`/api/extension/jobs/next?campaignId=${encodeURIComponent(run.campaignId)}`);
    if (!reply.job) {
      if (reply.campaignStatus === "COMPLETED") { await stopAutomatic(); const state = await automaticState(); await chrome.storage.local.set({ automatic: { ...state, status: "Automatic posting completed." } }); return; }
      if (reply.campaignStatus !== "RUNNING" || !reply.remaining) throw new Error("The campaign needs review or has no pending groups.");
      await updateAutomatic(run, { phase: "WAITING", status: "Waiting for the next scheduled group." }); return;
    }
    const job = reply.job;
    if (job.campaignId !== run.campaignId) throw new Error("The selected job changed. Review the current job before publishing.");
    await chrome.storage.local.set({ job });
    await updateAutomatic(run, { phase: "OPENING", groupName: job.group.name, status: "Opening the next group." });
    let tab: chrome.tabs.Tab | undefined;
    if (run.tabId) {
      tab = await chrome.tabs.update(run.tabId, { url: job.group.url, active: true }).catch(() => chrome.tabs.create({ url: job.group.url, active: true }));
    } else tab = await chrome.tabs.create({ url: job.group.url, active: true });
    if (!tab?.id) throw new Error("The Facebook Group could not be opened.");
    await updateAutomatic(run, { tabId: tab.id });
    const ready = await loadedTab(tab.id, run);
    if (!sameGroup(ready.url, job.group.url)) throw new Error("Sign in or complete verification directly on Facebook, then resume.");
    // Page completion does not guarantee Manifest V3 content-script readiness.
    // Ask the adapter directly before attempting a compose action.
    let responsive = false;
    for (let attempt = 0; attempt < 10; attempt++) {
      await active(run);
      try {
        const pong = await chrome.tabs.sendMessage(tab.id, { type: "PING" });
        if (pong?.ok) { responsive = true; break; }
      } catch { /* Content script may still be initializing. */ }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    if (!responsive) throw new Error("The Facebook adapter is unavailable. Reload the extension and Facebook tab.");
    await updateAutomatic(run, { phase: "PREPARING", status: "Uploading images and preparing the post." });
    const attachments: { id: string; filename: string; mimeType: string; dataUrl: string }[] = [];
    for (const file of job.content.media) {
      await active(run);
      attachments.push({ ...file, dataUrl: await mediaData(file.id) });
      if (attachments.reduce((sum, item) => sum + item.dataUrl.length, 0) > 24_000_000) throw new Error("This post has too many images for automatic upload. Use smaller images.");
    }
    let prepared: { ok?: boolean; message?: string } | undefined;
    for (let retry = 0; retry < 3; retry++) {
      await active(run);
      try { prepared = await chrome.tabs.sendMessage(tab.id, { type: "PREPARE_CAPTION", jobId: job.id, expectedGroupUrl: job.group.url, caption: job.content.caption, linkUrl: job.content.linkUrl, attachments }); break; }
      catch { if (retry === 2) throw new Error("The Facebook adapter is unavailable. Reload the extension and Facebook tab."); await new Promise((resolve) => setTimeout(resolve, 500)); }
    }
    if (!prepared?.ok) throw new Error(prepared?.message ?? "Images could not be attached or did not finish uploading. Automatic posting was paused.");
    await active(run);
    await api(`/api/extension/jobs/${job.id}/submission`, { claimToken: job.claimToken, action: "begin", automatic: true });
    await chrome.storage.local.set({ job: { ...job, publishAttempted: true } });
    await updateAutomatic(run, { phase: "SUBMITTING", attempts: run.attempts + 1, status: "Publishing to Facebook." });
    const result = await chrome.tabs.sendMessage(tab.id, { type: "PUBLISH_POST", jobId: job.id, expectedGroupUrl: job.group.url, caption: job.content.caption, linkUrl: job.content.linkUrl, trackOutcome: true });
    if (result?.clicked === false) {
      await api(`/api/extension/jobs/${job.id}/submission`, { claimToken: job.claimToken, action: "release" });
      await chrome.storage.local.set({ job });
    }
    if (!result?.ok || result.outcome !== "published") throw new Error(result?.message ?? (result?.outcome === "approval" ? "Facebook is waiting for group approval. Review the submission." : "Facebook submission could not be verified. Review the group before continuing."));
    await api(`/api/extension/jobs/${job.id}/posted`, { claimToken: job.claimToken, notes: "Automatic run: Facebook showed a new publication confirmation." });
    await chrome.storage.local.remove("job");
    const state = await automaticState();
    if (state?.enabled && state.runId === run.runId) {
      await updateAutomatic(run, { phase: "WAITING", status: "Post verified. Waiting for the next scheduled group." });
      if (run.attempts >= 3) { await stopAutomatic(); await chrome.storage.local.set({ automatic: { ...await automaticState(), status: "Automatic posting completed." } }); }
    }
  } catch (cause) {
    const state = await automaticState();
    if (state?.runId === run.runId) await stopAutomatic(cause instanceof Error ? cause.message : "Automatic posting was paused.");
  } finally { automaticBusy = false; }
}

chrome.alarms?.onAlarm.addListener((alarm) => { if (alarm.name === automaticAlarm) void runAutomatic(); });
chrome.runtime.onStartup?.addListener(() => { void runAutomatic(); });


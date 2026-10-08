type Job = { id: string; claimToken: string; publishAttempted?: boolean; userClicked?: boolean; autoContinueAt?: number; campaignId?: string; campaign: string; group: { id: string; name: string; url: string }; content: { name: string; caption: string; linkUrl: string | null; media: { id: string; mimeType: string; filename: string }[] } };

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

const uploadReserving = new Set<string>();
const publishing = new Set<string>();

function sameGroup(actual: string | undefined, expected: string): boolean {
  try {
    const current = new URL(actual ?? ""); const target = new URL(expected);
    const currentGroup = /^\/groups\/([^/]+)/.exec(current.pathname)?.[1];
    const targetGroup = /^\/groups\/([^/]+)/.exec(target.pathname)?.[1];
    return target.protocol === "https:" && ["facebook.com", "www.facebook.com", "m.facebook.com"].includes(target.hostname) && current.protocol === "https:" && ["facebook.com", "www.facebook.com", "m.facebook.com"].includes(current.hostname) && Boolean(targetGroup) && currentGroup === targetGroup;
  } catch { return false; }
}

chrome.runtime.onMessage.addListener((message: { type: string; enabled?: boolean; apiUrl?: string; code?: string; mediaId?: string; jobId?: string; mediaConfirmed?: boolean; campaignId?: string; stage?: string; outcome?: "published" | "approval" | "unknown" }, sender, sendResponse) => {
  void (async () => {
    try {
      if (message.type === "PREPARATION_POST_CLICKED") {
        const job = (await settings()).job;
        const run = await automaticState();
        if (!job || job.id !== message.jobId || !sender.tab?.id || !sameGroup(sender.url, job.group.url) ||
            (run?.enabled && run.tabId !== sender.tab.id)) throw new Error("This preparation session is no longer active.");
        // The human click already happened. Preserve it before any network call.
        await chrome.storage.local.set({ job: { ...job, publishAttempted: true } });
        await api("/api/extension/jobs/" + job.id + "/submission", { claimToken: job.claimToken, action: "begin", automatic: Boolean(run?.enabled) });
        sendResponse({ ok: true }); return;
      }
      if (message.type === "UPLOAD_BEGIN") {
        if (!message.jobId || uploadReserving.has(message.jobId)) throw new Error("An upload reservation is already in progress.");
        uploadReserving.add(message.jobId);
        try {
          const job = (await settings()).job;
          const run = await automaticState();
          if (!job || job.id !== message.jobId || sender.tab?.id !== run?.tabId || !run?.enabled || run.phase !== "PREPARING" || !sameGroup(sender.url, job.group.url)) throw new Error("Upload reservation is unavailable. Review the existing composer.");
          const reservations = (await chrome.storage.local.get("uploadReservations")).uploadReservations as Record<string, boolean> | undefined;
          if (reservations?.[job.id]) throw new Error("Images may already be attached. Review the existing composer; do not upload again.");
          await chrome.storage.local.set({ uploadReservations: { ...reservations, [job.id]: true } });
          sendResponse({ ok: true }); return;
        } finally { uploadReserving.delete(message.jobId); }
      }
      if (message.type === "AUTO_SET_PUBLISH") {
        const run = await automaticState();
        if ((sender.tab && !sender.url?.startsWith("chrome-extension://")) || typeof message.enabled !== "boolean") throw new Error("Change the posting mode in the extension popup.");
        if (run?.enabled || (await settings()).job?.publishAttempted) throw new Error("Stop monitoring and resolve the current post before changing the posting mode.");
        await chrome.storage.local.set({ autoClickPost: message.enabled });
        sendResponse({ ok: true }); return;
      }
      if (message.type === "AUTO_CAMPAIGNS") { sendResponse({ ok: true, ...(await api("/api/extension/campaigns") as object) }); return; }
      if (message.type === "AUTO_STAGE") {
        const run = await automaticState();
        const job = (await settings()).job;
        const statusByStage: Record<string, string> = {
          OPEN_COMPOSER: "Opening the Facebook post composer.",
          FILL_CAPTION: "Filling in the caption.",
          ATTACH_IMAGES: "Attaching images to the post.",
          WAIT_AUTO_POST: "Waiting 5 seconds before automatically clicking Post.",
          VERIFY_UPLOAD: "Waiting for images to finish uploading.",
          PREPARED: "Caption and images are ready to publish."
        };
        const status = statusByStage[message.stage ?? ""];
        if (run?.enabled && run.phase === "PREPARING" && job?.id === message.jobId && status) {
          await updateAutomatic(run, { status });
        }
        sendResponse({ ok: true });
        return;
      }
      if (message.type === "AUTO_START") { await startAutomatic(message.campaignId); sendResponse({ ok: true }); return; }
      if (message.type === "AUTO_STOP") { await stopAutomatic(); sendResponse({ ok: true }); return; }
      if (message.type === "AUTO_CANCEL_CAMPAIGN") { await cancelCampaign(); sendResponse({ ok: true }); return; }
      if (message.type === "AUTO_RESET_FAILED") { sendResponse({ ok: true, ...(await resetFailed() as object) }); return; }
      if (message.type === "AUTO_CONFIRM_POST") { await confirmPostManually(); sendResponse({ ok: true }); return; }
      if (message.type === "USER_POST_CLICKED") { await userClickedPost(message.jobId, sender.tab?.id); sendResponse({ ok: true }); return; }
      if (message.type === "USER_POST_RESULT") { await userPostResult(message.jobId, message.outcome, sender.tab?.id); sendResponse({ ok: true }); return; }
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
          if (job.publishAttempted) throw new Error("Review the previous Facebook post before continuing.");
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



type AutomaticRun = {
  runId: string; campaignId: string; enabled: boolean; attempts: number; autoClickPost?: boolean;
  tabId?: number; groupName?: string; jobId?: string; status: string; error?: string; errorCode?: string;
  phase: "WAITING" | "OPENING" | "PREPARING" | "AWAITING_USER" | "VERIFYING" | "PAUSED";
};
const watchedJobs = new Set<string>();
const automaticAlarm = "groupflow-automatic";
let automaticBusy = false;

async function automaticState(): Promise<AutomaticRun | undefined> {
  return (await chrome.storage.local.get("automatic")).automatic as AutomaticRun | undefined;
}
async function active(run: AutomaticRun): Promise<AutomaticRun> {
  const state = await automaticState();
  if (!state?.enabled || state.runId !== run.runId) throw new Error("Automatic posting was stopped.");
  return state;
}
async function announceAutomatic(state: AutomaticRun) {
  if (!state.tabId) return;
  await chrome.tabs.sendMessage(state.tabId, {
    type: "AUTO_PROGRESS", phase: state.phase, status: state.status, autoClickPost: state.autoClickPost,
    error: state.error, enabled: state.enabled,
  }).catch(() => undefined);
}
async function updateAutomatic(run: AutomaticRun, values: Partial<AutomaticRun>) {
  const current = await active(run);
  const next = { ...current, ...values };
  await chrome.storage.local.set({ automatic: next });
  Object.assign(run, next);
  await announceAutomatic(next);
}
async function stopAutomatic(error = "", errorCode = "") {
  const state = await automaticState();
  if (!state) return;
  const next: AutomaticRun = {
    ...state, enabled: false, phase: "PAUSED",
    status: error ? "Automatic posting paused for review." : "Automatic posting stopped.", error, errorCode,
  };
  await chrome.storage.local.set({ automatic: next });
  await chrome.alarms.clear(automaticAlarm);
  await announceAutomatic(next);
  const job = (await settings()).job;
  if (job) watchedJobs.delete(job.id);
  if (state.tabId && job) {
    await chrome.tabs.sendMessage(state.tabId, { type: "CANCEL_JOB", jobId: job.id }).catch(() => undefined);
  }
}
async function cancelCampaign() {
  const run = await automaticState();
  if (!run?.campaignId) throw new Error("No campaign selected.");
  // Stop tracking first to prevent concurrent callbacks starting the next group.
  await stopAutomatic();
  await api("/api/extension/campaigns/cancel", { campaignId: run.campaignId });
  const job = (await settings()).job;
  if (job && job.campaignId === run.campaignId && !job.publishAttempted) {
    // The post was never submitted by the assisted workflow. Release the
    // abandoned claim so it won't block a different campaign later.
    try {
      await api("/api/extension/jobs/" + job.id + "/skip", {
        claimToken: job.claimToken, notes: "Campaign cancelled before Facebook submission.",
      });
      await chrome.storage.local.remove("job");
    } catch { /* Leave the claim untouched if the server cannot confirm the skip. */ }
  }
  await chrome.storage.local.set({ automatic: { ...(await automaticState()), status: "Campaign cancelled.", error: "" } });
}
async function resetFailed() {
  const run = await automaticState();
  if (!run?.campaignId) throw new Error("No campaign selected.");
  const result = await api<{ reset: number }>("/api/extension/campaigns/reset", { campaignId: run.campaignId });
  if (result.reset) {
    await chrome.storage.local.set({ automatic: {
      ...(await automaticState()), enabled: false, phase: "PAUSED",
      status: "Failed groups reset. Start the campaign to continue.", error: "",
    } });
  }
  return result;
}

const confirmingPosts = new Set<string>();
async function recordCompletedPost(run: AutomaticRun, job: Job, note: string, confirmationSource: "ui_confirmed" | "user_confirmed" | "automatic_unverified" = "user_confirmed") {
  if (confirmingPosts.has(job.id)) return;
  confirmingPosts.add(job.id);
  try {
    await api("/api/extension/jobs/" + job.id + "/posted", { claimToken: job.claimToken, notes: note, confirmationSource });
    await chrome.storage.local.remove("job");
    watchedJobs.delete(job.id);
    if (run.tabId) {
      await chrome.tabs.sendMessage(run.tabId, { type: "CANCEL_JOB", jobId: job.id }).catch(() => undefined);
    }
    // Do not reopen a new group if this run was stopped or cancelled while the
    // server call was in flight.
    const current = await automaticState();
    if (!current?.enabled || current.runId !== run.runId) return;
    await updateAutomatic(run, { phase: "WAITING", status: confirmationSource === "automatic_unverified" ? "Post submitted without verification. Preparing the next scheduled group." : "Post verified. Preparing the next scheduled group.", error: "", groupName: undefined });
    void runAutomatic();
  } finally { confirmingPosts.delete(job.id); }
}
async function completeUncheckedPost(run: AutomaticRun, job: Job) {
  if (!job.userClicked || !job.autoContinueAt) throw new Error("The automatic Post click was not recorded. Review Facebook before continuing.");
  await updateAutomatic(run, { phase: "VERIFYING", status: "Post clicked. Waiting 5 seconds before the next group; publication is not checked." });
  while (Date.now() < job.autoContinueAt) {
    await active(run);
    await new Promise(resolve => setTimeout(resolve, Math.min(250, job.autoContinueAt! - Date.now())));
  }
  await active(run);
  const current = (await settings()).job;
  if (current?.id !== job.id || !current.userClicked) return;
  await recordCompletedPost(run, current, "Automatic submission (unverified). Post was clicked; Facebook publication was not checked.", "automatic_unverified");
}

async function confirmPostManually() {
  const run = await automaticState();
  const job = (await settings()).job;
  if (!run || !job || run.campaignId !== job.campaignId || !job.publishAttempted)
    throw new Error("There is no pending Facebook post to review.");
  if (automaticBusy && run.autoClickPost && run.phase === "VERIFYING") throw new Error("Wait for Facebook verification before confirming this post.");
  if (!["AWAITING_USER", "VERIFYING", "PAUSED"].includes(run.phase))
    throw new Error("Confirm the result on Facebook before continuing.");
  await recordCompletedPost(run, job, "User explicitly confirmed a Facebook publication in the extension.");
  // If the user previously stopped monitoring, the record stays complete but
  // another group will not be opened until they restart the run.
}
function matchingActivePost(jobId: string | undefined, tabId: number | undefined, run: AutomaticRun | undefined, job: Job | undefined) {
  return Boolean(run?.enabled && tabId && run.tabId === tabId && jobId && job?.id === jobId &&
    job.campaignId === run.campaignId && job.publishAttempted);
}
async function userClickedPost(jobId: string | undefined, tabId: number | undefined, clickSource: "user" | "automatic" = "user") {
  const [run, saved] = await Promise.all([automaticState(), settings()]);
  if (!run || !matchingActivePost(jobId, tabId, run, saved.job) || !(run.phase === "AWAITING_USER" || (run.autoClickPost && run.phase === "VERIFYING" && !saved.job?.userClicked)))
    throw new Error("This posting session is no longer active.");
  await chrome.storage.local.set({ job: { ...saved.job, userClicked: true, ...(clickSource === "automatic" ? { autoContinueAt: Date.now() + 5000 } : {}) } });
  await updateAutomatic(run, { phase: "VERIFYING", status: clickSource === "automatic" ? "Post clicked. Waiting 5 seconds before the next group; publication is not checked." : "You clicked Post. Waiting for Facebook confirmation." });
  try {
    await api(`/api/extension/jobs/${saved.job!.id}/submission`, { claimToken: saved.job!.claimToken, action: "clicked", clickSource });
  } catch (cause) {
    await stopAutomatic("The click could not be recorded. Check Facebook; do not submit again.");
    throw cause;
  }
}
async function userPostResult(jobId: string | undefined, result: string | undefined, tabId: number | undefined) {
  const [run, saved] = await Promise.all([automaticState(), settings()]);
  if (!run || !saved.job || !matchingActivePost(jobId, tabId, run, saved.job) || run.phase !== "VERIFYING")
    throw new Error("This posting session is no longer active.");
  if (result === "published") {
    try {
      await recordCompletedPost(run, saved.job, "Facebook displayed a publication confirmation after the user clicked Post.", "ui_confirmed");
    } catch (cause) {
      // Keep the reserved job for review and make recording failures visible.
      await stopAutomatic(cause instanceof Error ? cause.message : "Extension request failed.");
      throw cause;
    }
  } else {
    await stopAutomatic(result === "approval"
      ? "Facebook submitted the post for group approval. Check it before confirming publication."
      : "Facebook did not show a reliable success confirmation. Check the group before continuing.", result === "approval" ? "POST_PENDING_APPROVAL" : "POST_OUTCOME_UNKNOWN");
  }
}
async function startAutomatic(campaignId?: string) {
  if (!campaignId) throw new Error("Choose a campaign.");
  if (!chrome.alarms) throw new Error("The Facebook adapter is unavailable. Reload the extension and Facebook tab.");
  if (automaticBusy || publishing.size) throw new Error("Wait for the previous Facebook action to finish.");
  const saved = await settings();
  if (saved.job?.publishAttempted) throw new Error("Review the previous Facebook post before starting another group.");
  if (saved.job && saved.job.campaignId !== campaignId) throw new Error("Resolve the current job before starting another campaign.");
  await api("/api/extension/campaigns", { campaignId });
  const previous = await automaticState();
  const run: AutomaticRun = {
    runId: crypto.randomUUID(), campaignId, enabled: true, attempts: 0,
    autoClickPost: (await chrome.storage.local.get("autoClickPost")).autoClickPost === true,
    tabId: previous?.tabId, jobId: saved.job?.id === previous?.jobId ? previous?.jobId : undefined, phase: "WAITING", status: "Automatic preparation started.",
  };
  await chrome.storage.local.set({ automatic: run });
  await chrome.alarms.create(automaticAlarm, { periodInMinutes: 1 });
  void runAutomatic();
}
async function loadedTab(tabId: number, run: AutomaticRun, groupUrl: string): Promise<chrome.tabs.Tab> {
  let reachedGroup = false;
  for (let step = 0; step < 80; step++) {
    await active(run);
    const tab = await chrome.tabs.get(tabId);
    if (sameGroup(tab.url, groupUrl)) {
      reachedGroup = true;
      try {
        const pong = await chrome.tabs.sendMessage(tabId, { type: "PING" }) as {
          ok?: boolean; url?: string; readyState?: string;
        };
        // Facebook may keep loading resources after its composer is usable.
        // Check the document itself so a stale script from the previous group
        // cannot make a newly navigating tab appear ready.
        if (pong?.ok && sameGroup(pong.url, groupUrl) &&
            ["interactive", "complete"].includes(pong.readyState ?? "")) return tab;
      } catch { /* The new document may not have installed its adapter yet. */ }
    } else if (tab.status === "complete") {
      throw new Error("Sign in or complete verification directly on Facebook, then resume.");
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(reachedGroup
    ? "The Facebook adapter is unavailable. Reload the extension and Facebook tab."
    : "The Facebook Group did not finish loading.");
}
async function runAutomatic() {
  if (automaticBusy) return;
  automaticBusy = true;
  const initial = await automaticState().catch(() => undefined);
  if (!initial?.enabled) { automaticBusy = false; return; }
  const run = { ...initial };
  try {
    // Never start another group while the user is reviewing or Facebook's
    // outcome is uncertain (also holds after a service-worker restart).
    if (run.autoClickPost && run.phase === "VERIFYING") {
      const job = (await settings()).job;
      if (job && job.id === run.jobId && job.userClicked && job.autoContinueAt) {
        await completeUncheckedPost(run, job); return;
      }
    }
    if (["AWAITING_USER", "VERIFYING"].includes(run.phase)) {
      if (run.jobId && run.tabId && watchedJobs.has(run.jobId)) {
        const job = (await settings()).job;
        const pong = await chrome.tabs.sendMessage(run.tabId, { type: "PING" }).catch(() => undefined) as { watchingJobId?: string; url?: string } | undefined;
        if (job && pong?.watchingJobId === job.id && sameGroup(pong.url, job.group.url)) return;
      }
      await stopAutomatic("Monitoring was interrupted. Check Facebook before confirming or continuing; do not submit again.");
      return;
    }
    const saved = await settings();
    if (saved.job?.publishAttempted) throw new Error("Review the previous Facebook post before continuing.");
    const reply = saved.job ? { job: saved.job } : await api<{ job: Job | null; campaignStatus?: string; remaining?: number }>(
      "/api/extension/jobs/next?campaignId=" + encodeURIComponent(run.campaignId));
    if (!reply.job) {
      if (reply.campaignStatus === "COMPLETED") {
        await stopAutomatic();
        await chrome.storage.local.set({ automatic: {
          ...(await automaticState()), status: "Automatic posting completed.", error: "",
        } });
        return;
      }
      if (reply.campaignStatus !== "RUNNING") throw new Error("The campaign has stopped or was cancelled.");
      if (!reply.remaining) throw new Error("No pending groups. Reset failed groups, or review unresolved posts.");
      await updateAutomatic(run, { phase: "WAITING", status: "Waiting for the next scheduled group." });
      return;
    }
    const job = reply.job;
    if (job.campaignId !== run.campaignId) throw new Error("The selected job changed. Review the current job.");
    await chrome.storage.local.set({ job });
    await updateAutomatic(run, { phase: "OPENING", groupName: job.group.name, status: "Opening the next group." });
    let tab: chrome.tabs.Tab | undefined;
    if (run.tabId) {
      const existing = await chrome.tabs.get(run.tabId).catch(() => undefined);
      tab = existing && run.jobId === job.id && sameGroup(existing.url, job.group.url)
        ? await chrome.tabs.update(run.tabId, { active: true })
        : await chrome.tabs.update(run.tabId, { url: job.group.url, active: true })
            .catch(() => chrome.tabs.create({ url: job.group.url, active: true }));
    } else tab = await chrome.tabs.create({ url: job.group.url, active: true });
    if (!tab?.id) throw new Error("The Facebook Group could not be opened.");
    await updateAutomatic(run, { tabId: tab.id, jobId: job.id });
    const ready = await loadedTab(tab.id, run, job.group.url);
    if (!sameGroup(ready.url, job.group.url))
      throw new Error("Sign in or complete verification directly on Facebook, then resume.");
    const unlocked = await chrome.tabs.sendMessage(tab.id, { type: "RESET_SAFE_JOB", jobId: job.id }) as { ok?: boolean };
    if (!unlocked?.ok) throw new Error("This Facebook post may have already been submitted. Review it before retrying.");
    await updateAutomatic(run, { phase: "PREPARING", status: "Opening Facebook's composer." });
    const attachments: { id: string; filename: string; mimeType: string; dataUrl: string }[] = [];
    for (const file of job.content.media) {
      await active(run);
      attachments.push({ ...file, dataUrl: await mediaData(file.id) });
      if (attachments.reduce((sum, item) => sum + item.dataUrl.length, 0) > 24_000_000)
        throw new Error("This post has too many images for automatic upload. Use smaller images.");
    }
    const prepared = await chrome.tabs.sendMessage(tab.id, {
      type: "PREPARE_CAPTION", jobId: job.id, expectedGroupUrl: job.group.url,
      caption: job.content.caption, linkUrl: job.content.linkUrl, attachments, allowUnverifiedImages: !run.autoClickPost, skipContentVerification: run.autoClickPost === true,
    }) as { ok?: boolean; message?: string; reason?: string; warning?: string; clicked?: boolean; diagnostics?: Record<string, unknown> };
    if (prepared?.diagnostics) await chrome.storage.local.set({ uploadDiagnostics: prepared.diagnostics });
    if (!prepared?.ok && prepared?.clicked) {
      // A user click during preparation must remain reserved for manual review.
      await chrome.storage.local.set({ job: { ...job, publishAttempted: true } });
      await api("/api/extension/jobs/" + job.id + "/submission", { claimToken: job.claimToken, action: "begin", automatic: true });
    }
    if (!prepared?.ok) throw Object.assign(new Error(prepared?.message ?? "The Facebook post could not be prepared."), { code: prepared?.reason ?? "PREPARE_FAILED" });
    await active(run);
    // Reserve before installing the watcher. Reservation is not click evidence.
    await api("/api/extension/jobs/" + job.id + "/submission", {
      claimToken: job.claimToken, action: "begin", automatic: true,
    });
    await chrome.storage.local.set({ job: { ...job, publishAttempted: true } });
    await updateAutomatic(run, {
      phase: "AWAITING_USER", attempts: run.attempts + 1,
      status: prepared.warning ?? "Ready. Review the caption and images, then click Post on Facebook.",
    });
    if (!run.autoClickPost) {
    const armed = await chrome.tabs.sendMessage(tab.id, {
      type: "ARM_USER_POST", jobId: job.id, expectedGroupUrl: job.group.url, allowUnverifiedImages: !run.autoClickPost,
    }) as { ok?: boolean; message?: string };
    if (!armed?.ok) throw new Error(armed?.message ?? "Cannot monitor the Facebook Post button. Review the post manually.");
    watchedJobs.add(job.id);
    }
    if (run.autoClickPost) {
      await active(run);
      await updateAutomatic(run, { phase: "VERIFYING", status: "Automatically clicking Post. Publication will not be checked." });
      const result = await chrome.tabs.sendMessage(tab.id, {
        type: "PUBLISH_POST", jobId: job.id, expectedGroupUrl: job.group.url,
        caption: job.content.caption, linkUrl: job.content.linkUrl,
        attachments, trackOutcome: false, skipContentVerification: true,
      }) as { ok?: boolean; clicked?: boolean; outcome?: string; reason?: string; message?: string };
      await active(run);
      const latestJob = (await settings()).job;
      if (latestJob?.id !== job.id) return;
      if (result?.reason === "ALREADY_SUBMITTED" && latestJob?.userClicked) return;
      if (result?.clicked === false && !latestJob?.userClicked) {
        await api(`/api/extension/jobs/${job.id}/submission`, { claimToken: job.claimToken, action: "release" });
        await chrome.storage.local.set({ job });
      }
      if (!result?.ok || !result.clicked) throw Object.assign(new Error(result?.message ?? "The Facebook action could not be verified. Check Facebook before continuing."), { code: result?.reason ?? "POST_OUTCOME_UNKNOWN" });
      if (!latestJob?.userClicked) await userClickedPost(job.id, tab.id, "automatic");
      const submitted = (await settings()).job;
      if (submitted?.id === job.id) await completeUncheckedPost(run, submitted);
    }
  } catch (cause) {
    const state = await automaticState();
    if (state?.runId === run.runId && state.enabled) {
      const job = (await settings()).job;
      // Keep a dispatched upload and its claim available for manual recovery.
      // Fail only preparations that never reserved an image dispatch.
      const reservations = (await chrome.storage.local.get("uploadReservations")).uploadReservations as Record<string, boolean> | undefined;
      if (job && job.campaignId === run.campaignId && !job.publishAttempted && !reservations?.[job.id]) {
        try {
          await api("/api/extension/jobs/" + job.id + "/failed", {
            claimToken: job.claimToken, errorCode: (cause as { code?: string })?.code ?? "PREPARE_FAILED",
            errorMessage: cause instanceof Error ? cause.message : "Facebook post preparation failed.",
          });
          await chrome.storage.local.remove("job");
        } catch { /* Keep the claim for manual review if recording failed. */ }
      }
      await stopAutomatic(cause instanceof Error ? cause.message : "Automatic posting was paused.", (cause as { code?: string })?.code ?? (job?.publishAttempted ? "POST_OUTCOME_UNKNOWN" : "PREPARE_FAILED"));
    }
  } finally {
    automaticBusy = false;
    const next = await automaticState();
    if (next?.enabled && next.runId === run.runId && next.phase === "WAITING" && ["Post verified. Preparing the next scheduled group.", "Post submitted without verification. Preparing the next scheduled group."].includes(next.status)) void runAutomatic();
  }
}
chrome.alarms?.onAlarm.addListener((alarm) => {
  if (alarm.name === automaticAlarm) void runAutomatic();
});
chrome.runtime.onStartup?.addListener(() => { void runAutomatic(); });

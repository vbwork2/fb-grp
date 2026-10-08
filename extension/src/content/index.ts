export {};

type ComposerMessage = { type?: string; jobId?: string; expectedGroupUrl?: string; caption?: string; linkUrl?: string; attachments?: { id: string; filename: string; mimeType: string; dataUrl: string }[]; trackOutcome?: boolean; phase?: string; status?: string; error?: string; enabled?: boolean };
type AdapterResult = { ok: boolean; clicked?: boolean; reason?: string; message?: string; outcome?: "published" | "approval" | "unknown" };
const attemptedJobs = new Set<string>();
const cancelledJobs = new Set<string>();
const uploadedFiles = new Map<string, Set<string>>();
const uploadResults = new Map<string, Promise<boolean>>();
let preparedJob: { id: string; editor: HTMLElement } | undefined;

function visible(element: HTMLElement): boolean {
  return Boolean(element.getClientRects().length) && getComputedStyle(element).visibility !== "hidden" && !element.closest("[aria-hidden='true']");
}

function groupPath(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !["facebook.com", "www.facebook.com", "m.facebook.com"].includes(url.hostname)) return;
    return /^\/groups\/([^/]+)/.exec(url.pathname)?.[1];
  } catch { return; }
}

const EDITOR_SELECTOR = "div[contenteditable='true'][role='textbox'], div[contenteditable='true'][data-lexical-editor='true'], textarea[name='xhpc_message']";
const COMPOSER_TIMEOUT_MS = 10_000;

function editorCandidates(root: ParentNode = document): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(EDITOR_SELECTOR)].filter(visible);
}

// Facebook can have unrelated comment editors on the group page. Never fill one
// of those: the compose editor must be inside a visible dialog or form.
function openComposerEditor(): HTMLElement | undefined {
  const dialogs = [...document.querySelectorAll<HTMLElement>("[role='dialog']")].filter(visible);
  const dialogEditors = dialogs.flatMap((dialog) => editorCandidates(dialog));
  if (dialogEditors.length === 1) return dialogEditors[0];
  if (dialogEditors.length > 1) return;
  const formEditors = editorCandidates().filter((editor) => Boolean(editor.closest("form")));
  return formEditors.length === 1 ? formEditors[0] : undefined;
}

function composeTriggers(): HTMLElement[] {
  // Exact English labels are not sufficient: Facebook localizes and personalizes
  // them (for example "Bạn viết gì đi, ...?" or "What's on your mind, ...?").
  const caption = /^(?:write something|what['’]?s on your mind|create (?:a )?post|start (?:a )?discussion|viết gì|viết bài|bạn viết gì|bạn đang nghĩ gì|tạo bài viết|bắt đầu thảo luận|chia sẻ điều gì)(?:$|[\s.,!?…])/i;
  return [...document.querySelectorAll<HTMLElement>("button, [role='button']")].filter((element) => {
    if (!visible(element)) return false;
    const label = (element.getAttribute("aria-label") || element.innerText || "").replace(/\s+/g, " ").trim();
    return caption.test(label);
  });
}

async function composer(): Promise<HTMLElement | undefined> {
  const existing = openComposerEditor();
  if (existing) return existing;
  const triggers = composeTriggers();
  // Never guess which trigger to click if the page is ambiguous.
  if (triggers.length !== 1) return;
  triggers[0].click();
  // Polling a small set of dialogs avoids a full-page MutationObserver reacting
  // to Facebook's frequent feed updates and potentially stalling the tab.
  return waitFor(openComposerEditor, COMPOSER_TIMEOUT_MS);
}

function fill(editor: HTMLElement, message: ComposerMessage) {
  const text = [message.caption ?? "", message.linkUrl ?? ""].filter(Boolean).join("\n\n");
  editor.focus();
  if (editor instanceof HTMLTextAreaElement) {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(editor, text);
    editor.dispatchEvent(new Event("input", { bubbles: true }));
  } else {
    const selection = window.getSelection();
    selection?.selectAllChildren(editor);
    if (!document.execCommand("insertText", false, text)) {
      editor.textContent = text;
      editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
    }
  }
  if (message.jobId) preparedJob = { id: message.jobId, editor };
}

async function waitFor<T>(read: () => T | undefined, milliseconds: number): Promise<T | undefined> {
  return new Promise((resolve) => {
    const poll = window.setInterval(check, 200);
    const timeout = window.setTimeout(() => finish(undefined), milliseconds);
    function finish(value: T | undefined) { clearInterval(poll); clearTimeout(timeout); resolve(value); }
    function check() { const value = read(); if (value !== undefined) finish(value); }
    check();
  });
}

function cancelled(message: ComposerMessage) { return Boolean(message.jobId && cancelledJobs.has(message.jobId)); }

async function attachImages(scope: Element, message: ComposerMessage): Promise<boolean> {
  if (!message.attachments?.length || !message.jobId) return true;
  const previous = uploadResults.get(message.jobId);
  if (previous) return previous;
  const result = uploadImages(scope, message);
  uploadResults.set(message.jobId, result);
  return result;
}

async function uploadImages(scope: Element, message: ComposerMessage): Promise<boolean> {
  if (!message.attachments?.length || !message.jobId) return true;
  const attached = uploadedFiles.get(message.jobId) ?? new Set<string>();
  const pending = message.attachments.filter((file) => !attached.has(file.id));
  if (!pending.length) return true;
  const inputs = () => [...scope.querySelectorAll<HTMLInputElement>("input[type='file']")].filter((input) => /image|\.jpg|\.png|\.webp/i.test(input.accept));
  if (!inputs().length) {
    const triggers = [...scope.querySelectorAll<HTMLElement>("button,[role='button']")].filter((element) => visible(element) && /^(photo\/video|photos\/videos|ảnh\/video)$/i.test((element.getAttribute("aria-label") ?? element.innerText).trim()));
    if (triggers.length !== 1) return false;
    triggers[0].click();
  }
  const input = await waitFor(() => { const found = inputs(); return found.length === 1 ? found[0] : undefined; }, 4000);
  if (!input || (!input.multiple && pending.length > 1) || cancelled(message)) return false;
  const transfer = new DataTransfer();
  for (const file of pending) {
    const match = /^data:(image\/(?:png|jpeg|webp));base64,(.+)$/.exec(file.dataUrl);
    if (!match || match[1] !== file.mimeType) return false;
    const bytes = Uint8Array.from(atob(match[2]), (letter) => letter.charCodeAt(0));
    transfer.items.add(new File([bytes], file.filename, { type: file.mimeType }));
  }
  const previousImages = new Map([...scope.querySelectorAll<HTMLImageElement>("img")].map((image) => [image, image.src]));
  input.files = transfer.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
  for (const file of pending) attached.add(file.id);
  uploadedFiles.set(message.jobId, attached);
  return Boolean(await waitFor(() => {
    if (cancelled(message)) return false;
    const previews = [...scope.querySelectorAll<HTMLImageElement>("img")].filter((image) => visible(image) && previousImages.get(image) !== image.src);
    const post = [...scope.querySelectorAll<HTMLElement>("button,[role='button']")].find((element) => /^(post|publish|đăng|đăng bài)$/i.test((element.getAttribute("aria-label") ?? element.innerText).trim()));
    return previews.length >= attached.size && post && !post.matches(":disabled,[aria-disabled='true']") && !scope.querySelector("[role='progressbar'],[aria-busy='true']") ? true : undefined;
  }, 30_000));
}

function notices(): string[] { return [...document.querySelectorAll<HTMLElement>("[role='status'],[role='alert'],[aria-live='polite']")].filter(visible).map((element) => element.innerText.trim()); }

async function outcome(previous: Set<string>, message: ComposerMessage): Promise<"published" | "approval" | "unknown"> {
  return await waitFor(() => {
    if (cancelled(message)) return "unknown" as const;
    for (const notice of notices().filter((text) => !previous.has(text))) {
      if (/submitted for approval|pending admin approval|chờ (quản trị viên )?(phê duyệt|duyệt)/i.test(notice)) return "approval" as const;
      if (/your post (has been |was )?(published|posted)|post published|bài viết (của bạn )?(đã )?(được đăng|đã đăng)|đã đăng bài/i.test(notice)) return "published" as const;
    }
    return undefined;
  }, 30_000) ?? "unknown";
}

async function handle(message: ComposerMessage): Promise<AdapterResult> {
  if (/\/(login|checkpoint|recover|identify)(\/|$)/i.test(location.pathname) || document.querySelector("input[name='pass']")) {
    return { ok: false, clicked: false, reason: "VERIFICATION_REQUIRED", message: "Facebook requires user verification. Please complete it directly on Facebook and retry." };
  }
  if (message.expectedGroupUrl && (!groupPath(message.expectedGroupUrl) || groupPath(location.href) !== groupPath(message.expectedGroupUrl))) {
    return { ok: false, clicked: false, reason: "WRONG_GROUP", message: "Open the exact Facebook Group for this job before continuing." };
  }
  if (cancelled(message)) return { ok: false, clicked: false, message: "Automatic posting was stopped." };
  const publish = message.type === "PUBLISH_POST";
  if (publish && (!message.jobId || !message.expectedGroupUrl)) return { ok: false, clicked: false, reason: "INVALID_JOB" };
  if (publish && attemptedJobs.has(message.jobId!)) return { ok: false, clicked: true, reason: "ALREADY_SUBMITTED", message: "A publish attempt was already sent. Check Facebook before confirming the result." };
  const editor = await composer();
  if (!editor) return { ok: false, clicked: false, reason: "COMPOSER_NOT_FOUND", message: "Open the Facebook post composer, then retry. Copy and paste remains available." };
  const scope = editor.closest("[role='dialog'], form");
  if (publish && !scope) return { ok: false, clicked: false, reason: "POST_BUTTON_NOT_FOUND", message: "Open the Facebook post dialog before publishing." };
  if (!publish || preparedJob?.id !== message.jobId || preparedJob?.editor !== editor) fill(editor, message);
  if (message.attachments?.length && (!scope || !(await attachImages(scope, message)))) return { ok: false, clicked: false, message: "Images could not be attached or did not finish uploading. Automatic posting was paused." };
  if (!publish) return { ok: true, clicked: false };
  const text = editor instanceof HTMLTextAreaElement ? editor.value : editor.textContent;
  if (!text?.trim()) return { ok: false, clicked: false, reason: "EMPTY_CAPTION", message: "The Facebook caption is empty. Prepare the caption before publishing." };
  const buttons = [...scope!.querySelectorAll<HTMLElement>("button, [role='button']")].filter((element) => visible(element) && /^(post|publish|đăng|đăng bài)$/i.test((element.getAttribute("aria-label") ?? element.innerText).trim()));
  if (buttons.length !== 1) return { ok: false, clicked: false, reason: "POST_BUTTON_NOT_FOUND", message: "The Facebook Post button could not be identified. Publish directly on Facebook." };
  const button = buttons[0];
  if (button.matches(":disabled, [aria-disabled='true']")) return { ok: false, clicked: false, reason: "POST_BUTTON_DISABLED", message: "Facebook has not enabled the Post button. Finish editing or uploading images first." };
  // Record the attempt before clicking so a repeated request cannot publish twice.
  if (attemptedJobs.has(message.jobId!)) return { ok: false, clicked: true, reason: "ALREADY_SUBMITTED", message: "A publish attempt was already sent. Check Facebook before confirming the result." };
  if (cancelled(message)) return { ok: false, clicked: false, message: "Automatic posting was stopped." };
  const previousNotices = new Set(notices());
  attemptedJobs.add(message.jobId!);
  button.click();
  if (message.trackOutcome) return { ok: true, clicked: true, outcome: await outcome(previousNotices, message) };
  return { ok: true, clicked: true, message: "Publish was sent to Facebook. Check the result, then confirm it in history." };
}

// A small, read-only on-page indicator survives the popup closing when Chrome
// switches to the Facebook tab. Never label it as a Facebook notification.
const PROGRESS_ID = "groupflow-progress-indicator";
function renderProgress(message: ComposerMessage): void {
  document.getElementById(PROGRESS_ID)?.remove();
  if (!message.enabled && !message.error) return;
  if (!document.body) return;
  const panel = document.createElement("div");
  panel.id = PROGRESS_ID;
  panel.style.cssText = "position:fixed;bottom:18px;left:18px;z-index:2147483640;max-width:310px;background:#fff;color:#17372e;padding:12px 14px;border-radius:12px;box-shadow:0 5px 28px #0003;border-left:4px solid #176c50;font:13px/1.5 system-ui,sans-serif;pointer-events:none";
  if (message.error) panel.style.borderLeftColor = "#ba5130";
  const title = document.createElement("div");
  title.style.cssText = "font-weight:800;margin-bottom:4px";
  const names: Record<string, string> = {
    OPENING: "Đang mở nhóm Facebook",
    PREPARING: "Đang tìm ô viết bài và điền nội dung",
    SUBMITTING: "Đang đăng và xác nhận kết quả",
    WAITING: "Đang chờ lịch đăng tiếp theo",
    PAUSED: "Đã tạm dừng — cần kiểm tra"
  };
  title.textContent = "Groupflow · " + (names[message.phase ?? ""] ?? "Đăng bài tự động");
  const info = document.createElement("div");
  info.style.cssText = "font-size:12px;color:#52675c;overflow-wrap:anywhere";
  info.textContent = message.error
    ? "Không thể tiếp tục. Mở tiện ích Groupflow để xem lỗi và xử lý. Không tự đăng lại bài chưa rõ kết quả."
    : (message.phase === "PREPARING" ? "Nếu không thấy ô soạn bài, hãy mở tiện ích để xem hướng dẫn." : "Mở tiện ích Groupflow để theo dõi chi tiết.");
  panel.append(title, info);
  document.body.append(panel);
}

chrome.runtime.onMessage.addListener((message: ComposerMessage, _sender, sendResponse) => {
  if (message.type === "PING") { sendResponse({ ok: true }); return; }
  if (message.type === "AUTO_PROGRESS") { renderProgress(message); sendResponse({ ok: true }); return; }
  if (message.type === "CANCEL_JOB" && message.jobId) { cancelledJobs.add(message.jobId); sendResponse({ ok: true }); return; }
  if (message.type !== "PREPARE_CAPTION" && message.type !== "PUBLISH_POST") return;
  void handle(message).then(sendResponse).catch(() => sendResponse({ ok: false, clicked: message.jobId ? attemptedJobs.has(message.jobId) : false, message: "The Facebook action could not be completed. Check Facebook before trying again." }));
  return true;
});





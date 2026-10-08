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

const EDITOR_SELECTOR = "div[contenteditable='true'][role='textbox'], div[contenteditable='true'][data-lexical-editor='true'], textarea[name='xhpc_message'], [role='dialog'] [contenteditable='true'][aria-label]";
const COMPOSER_TIMEOUT_MS = 10_000;

function editorCandidates(root: ParentNode = document): HTMLElement[] {
  const candidates = [...root.querySelectorAll<HTMLElement>(EDITOR_SELECTOR)].filter(visible);
  return candidates.filter((editor) => !candidates.some((other) => other !== editor && other.contains(editor)));
}

// Only fill the post composer: never mistake the comment field in the feed
// for the main post. The actual Facebook post form is a visible dialog.
function openComposerEditor(): HTMLElement | undefined {
  const dialogs = [...document.querySelectorAll<HTMLElement>("[role='dialog']")].filter(visible);
  const candidates = dialogs.flatMap((dialog) => editorCandidates(dialog));
  if (candidates.length === 1) return candidates[0];
  // Group comment fields may also live inside forms. Do not ever treat
  // a non-dialog form as the Facebook post composer.
  return undefined;
}

const INLINE_COMPOSER_TEXT = /^(?:bạn viết gì đi|viết gì đó|write something|what['’]s on your mind|bạn đang nghĩ gì)(?:$|[\s.,!?…])/i;
const CREATE_POST_TEXT = /^(?:tạo bài viết|viết bài|create (?:a )?post|start (?:a )?discussion|bắt đầu thảo luận|chia sẻ điều gì)(?:$|[\s.,!?…])/i;

function labelOf(element: HTMLElement): string {
  return (element.getAttribute("aria-label") || element.innerText || element.textContent || "").replace(/\s+/g, " ").trim();
}

// Screenshot-based behavior: the center "Bạn viết gì đi..." trigger wins
// over the right-side "Tạo bài viết" action. More than one equally good
// match is an error, not permission to guess and click an unrelated control.
function composeTriggers(): { primary: HTMLElement[]; fallback: HTMLElement[] } {
  const primary = new Set<HTMLElement>();
  const fallback = new Set<HTMLElement>();
  const controls = [...document.querySelectorAll<HTMLElement>("button, [role='button']")];
  for (const element of controls) {
    if (!visible(element) || element.closest("[role='dialog']")) continue;
    const label = labelOf(element);
    if (INLINE_COMPOSER_TEXT.test(label)) primary.add(element);
    else if (CREATE_POST_TEXT.test(label)) fallback.add(element);
  }
  // Some Facebook variants expose the text on a child span while the
  // click handler is attached to a non-semantic div. The span receives
  // the click and bubbles it to that div, but only for a unique label.
  if (!primary.size) {
    const leaves = [...document.querySelectorAll<HTMLElement>("span, p")].filter((element) =>
      visible(element) && element.children.length === 0 && !element.closest("[role='dialog']")
      && INLINE_COMPOSER_TEXT.test(labelOf(element))
    );
    for (const leaf of leaves) {
      const clickable = leaf.closest<HTMLElement>("button, [role='button'], [tabindex='0']");
      primary.add(clickable && visible(clickable) ? clickable : leaf);
    }
  }
  return { primary: [...primary], fallback: [...fallback] };
}

async function composer(message: ComposerMessage): Promise<HTMLElement | undefined> {
  const existing = openComposerEditor();
  if (existing) return existing;
  // Facebook may insert the Group feed controls after navigation completes.
  // Preserve the latest main-branch delayed-render/cancellation safeguards.
  const entry = await waitFor(() => {
    const editor = openComposerEditor();
    if (editor) return { editor };
    const triggers = composeTriggers();
    return triggers.primary.length || triggers.fallback.length ? { triggers } : undefined;
  }, COMPOSER_TIMEOUT_MS);
  if (!entry) return undefined;
  if ("editor" in entry) return entry.editor;
  const chosen = entry.triggers.primary.length ? entry.triggers.primary : entry.triggers.fallback;
  if (chosen.length !== 1 || cancelled(message)) return undefined;
  chosen[0].click();
  return waitFor(openComposerEditor, COMPOSER_TIMEOUT_MS);
}

// Facebook uses a rich-text/contenteditable composer (often Lexical).
// Inserting a full string with "\n" can put raw newlines in a text node,
// which Facebook displays as one continuous paragraph. Insert explicit
// line breaks so they survive as visible lines in the composer.
function captionText(message: ComposerMessage): string {
  return [message.caption ?? "", message.linkUrl ?? ""]
    .filter(Boolean).join("\n\n").replace(/\r\n?/g, "\n").replace(/[\u2028\u2029]/g, "\n");
}

function compareCaption(value: string): string {
  return value.replace(/\r\n?/g, "\n")
    .replace(/[\u200b\ufeff]/gi, "").replace(/\u00a0/g, " ")
    .split("\n").map((line) => line.trimEnd()).join("\n")
    .replace(/\n+$/, "");
}

function editorText(editor: HTMLElement): string {
  if (editor instanceof HTMLTextAreaElement) return editor.value;
  // Lexical usually renders one <p> for each line. innerText can add a
  // second newline between <p> blocks; join those blocks ourselves.
  const children = [...editor.children];
  if (children.length && children.every((child) => /^(P|DIV)$/i.test(child.tagName))) {
    return children.map((child) => (child as HTMLElement).innerText.replace(/\n+$/, "")).join("\n");
  }
  return editor.innerText;
}

function captionMatches(editor: HTMLElement, text: string): boolean {
  return compareCaption(editorText(editor)) === compareCaption(text);
}

async function fill(editor: HTMLElement, message: ComposerMessage): Promise<boolean> {
  const text = captionText(message);
  editor.focus();
  if (editor instanceof HTMLTextAreaElement) {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(editor, text);
    editor.dispatchEvent(new Event("input", { bubbles: true }));
  } else {
    const selection = window.getSelection();
    if (!selection) return false;
    selection.selectAllChildren(editor);
    const lines = text.split("\n");
    // Unlike one insertText containing literal \n, insertLineBreak inserts
    // actual <br> nodes / Lexical line breaks (like Shift+Enter).
    for (let i = 0; i < lines.length; i++) {
      if (cancelled(message)) return false;
      if (i > 0 && !document.execCommand("insertLineBreak", false) && !document.execCommand("insertParagraph", false)) return false;
      if (lines[i] && !document.execCommand("insertText", false, lines[i])) return false;
    }
  }
  // Give controlled React/Lexical editors a moment to reconcile DOM changes.
  await new Promise((resolve) => window.setTimeout(resolve, 120));
  const valid = captionMatches(editor, text);
  if (valid && message.jobId) preparedJob = { id: message.jobId, editor };
  return valid;
}

function lostCaptionLineBreaks(editor: HTMLElement, message: ComposerMessage): boolean {
  const intended = compareCaption(captionText(message));
  const rendered = compareCaption(editorText(editor));
  return intended.includes("\n")
    && intended.replace(/\n/g, "") === rendered.replace(/\n/g, "")
    && intended !== rendered;
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
function reportStage(message: ComposerMessage, stage: string): void {
  if (message.type !== "PREPARE_CAPTION" || !message.jobId) return;
  // Reporting is best-effort and must never prevent caption/image preparation.
  try {
    void chrome.runtime.sendMessage?.({ type: "AUTO_STAGE", jobId: message.jobId, stage })?.catch(() => undefined);
  } catch { /* The background worker might have restarted. */ }
}

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
  const inputs = (root: ParentNode) => [...root.querySelectorAll<HTMLInputElement>("input[type='file']")]
    .filter((input) => /image|\.jpg|\.jpeg|\.png|\.webp/i.test(input.accept));
  let openedPhoto = false;
  if (!inputs(scope).length) {
    const triggers = [...scope.querySelectorAll<HTMLElement>("button,[role='button']")].filter((element) =>
      visible(element) && /^(photo\/video|photos\/videos|ảnh\/video|ảnh và video|photo\/videos)$/i.test(labelOf(element))
    );
    if (triggers.length !== 1) return false;
    triggers[0].click();
    openedPhoto = true;
  }
  const input = await waitFor(() => {
    const scoped = inputs(scope);
    if (scoped.length === 1) return scoped[0];
    if (scoped.length > 1 || !openedPhoto) return undefined;
    // Some Facebook layouts insert the picker input in a portal outside
    // the dialog. Only use it if opening Photo/video revealed one unique
    // image picker on the entire page.
    const global = inputs(document);
    return global.length === 1 ? global[0] : undefined;
  }, 6000);
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
  reportStage(message, "VERIFY_UPLOAD");
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
  reportStage(message, "OPEN_COMPOSER");
  const editor = await composer(message);
  if (!editor) return { ok: false, clicked: false, reason: "COMPOSER_NOT_FOUND", message: "Open the Facebook post composer, then retry. Copy and paste remains available." };
  if (cancelled(message)) return { ok: false, clicked: false, message: "Automatic posting was stopped." };
  const scope = editor.closest("[role='dialog'], form");
  if (publish && !scope) return { ok: false, clicked: false, reason: "POST_BUTTON_NOT_FOUND", message: "Open the Facebook post dialog before publishing." };
  if (!publish || preparedJob?.id !== message.jobId || preparedJob?.editor !== editor) {
    reportStage(message, "FILL_CAPTION");
    if (!(await fill(editor, message))) {
      return { ok: false, clicked: false, reason: "CAPTION_FORMAT_INVALID", message: "Facebook could not preserve the caption formatting. Review the text and line breaks before publishing." };
    }
  }
  if (message.attachments?.length) {
    reportStage(message, "ATTACH_IMAGES");
    if (!scope || !(await attachImages(scope, message))) return { ok: false, clicked: false, message: "Images could not be attached or did not finish uploading. Automatic posting was paused." };
  }
  if (!publish) {
    reportStage(message, "PREPARED");
    return { ok: true, clicked: false };
  }
  const text = editorText(editor);
  if (!text?.trim()) return { ok: false, clicked: false, reason: "EMPTY_CAPTION", message: "The Facebook caption is empty. Prepare the caption before publishing." };
  if (lostCaptionLineBreaks(editor, message)) return { ok: false, clicked: false, reason: "CAPTION_FORMAT_INVALID", message: "Facebook could not preserve the caption formatting. Review the text and line breaks before publishing." };
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
    AWAITING_USER: "Bài đã sẵn sàng — hãy bấm Đăng trên Facebook",
    VERIFYING: "Đang kiểm tra kết quả bài bạn vừa đăng",
    WAITING: "Đang chờ lịch đăng tiếp theo",
    PAUSED: "Đã tạm dừng — cần kiểm tra"
  };
  title.textContent = "Groupflow · " + (names[message.phase ?? ""] ?? "Đăng bài tự động");
  const info = document.createElement("div");
  info.style.cssText = "font-size:12px;color:#52675c;overflow-wrap:anywhere";
  info.textContent = message.error
    ? "Mở Groupflow để xem lỗi. Nếu đã bấm Đăng, hãy kiểm tra bài trước khi tiếp tục."
    : message.phase === "AWAITING_USER"
      ? "Kiểm tra nội dung và ảnh, sau đó tự bấm Đăng trong cửa sổ Facebook. Groupflow sẽ kiểm tra kết quả."
      : message.phase === "VERIFYING"
        ? "Đừng bấm Đăng lần nữa. Đang đợi Facebook xác nhận kết quả."
        : "Mở tiện ích Groupflow để theo dõi tiến trình.";
  panel.append(title, info);
  document.body.append(panel);
}

type UserPostWatcher = { jobId: string; detach: () => void };
let postWatcher: UserPostWatcher | undefined;

function armUserPost(message: ComposerMessage): AdapterResult {
  if (!message.jobId || !message.expectedGroupUrl || groupPath(location.href) !== groupPath(message.expectedGroupUrl))
    return { ok: false, clicked: false, message: "The Facebook group changed. Open the correct group." };
  if (cancelled(message)) return { ok: false, clicked: false, message: "Automatic posting was stopped." };
  const editor = openComposerEditor();
  const dialog = editor?.closest<HTMLElement>("[role='dialog']");
  if (!dialog) return { ok: false, clicked: false, message: "Facebook's post composer is not open." };
  const matchingButtons = () => [...dialog.querySelectorAll<HTMLElement>("button, [role='button']")].filter(
    (element) => visible(element) && /^(post|publish|đăng|đăng bài)$/i.test(labelOf(element))
  );
  if (matchingButtons().length !== 1)
    return { ok: false, clicked: false, message: "The Facebook Post button could not be identified. Review manually." };
  postWatcher?.detach();
  let submitted = false;
  const onClick = (event: MouseEvent) => {
    if (submitted || !event.isTrusted || cancelled(message)) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    const button = target.closest<HTMLElement>("button, [role='button']");
    if (!button || !dialog.contains(button) || !matchingButtons().includes(button) ||
        button.matches(":disabled, [aria-disabled='true']")) return;
    submitted = true;
    // The user (not Groupflow) clicked Facebook's Post button. Record this
    // immediately, then inspect only fresh Facebook confirmation notices.
    const previousNotices = new Set(notices());
    document.removeEventListener("click", onClick, true);
    void (async () => {
      try {
        const accepted = await chrome.runtime.sendMessage({
          type: "USER_POST_CLICKED", jobId: message.jobId,
        }) as { ok?: boolean };
        if (!accepted?.ok) return;
        const result = await outcome(previousNotices, message);
        await chrome.runtime.sendMessage({
          type: "USER_POST_RESULT", jobId: message.jobId, outcome: result,
        });
      } catch {
        // On a service-worker restart the durable job stays awaiting review.
        // We never assume a click means Facebook published the post.
      } finally { if (postWatcher?.jobId === message.jobId) postWatcher = undefined; }
    })();
  };
  document.addEventListener("click", onClick, true);
  postWatcher = { jobId: message.jobId, detach: () => document.removeEventListener("click", onClick, true) };
  return { ok: true, clicked: false, message: "Prepared. Click Post yourself, then Groupflow will check Facebook's result." };
}

chrome.runtime.onMessage.addListener((message: ComposerMessage, _sender, sendResponse) => {
  if (message.type === "PING") { sendResponse({ ok: true }); return; }
  if (message.type === "AUTO_PROGRESS") { renderProgress(message); sendResponse({ ok: true }); return; }
  if (message.type === "ARM_USER_POST") { sendResponse(armUserPost(message)); return; }
  if (message.type === "CANCEL_JOB" && message.jobId) {
    cancelledJobs.add(message.jobId);
    if (postWatcher?.jobId === message.jobId) { postWatcher.detach(); postWatcher = undefined; }
    sendResponse({ ok: true }); return;
  }
  if (message.type !== "PREPARE_CAPTION" && message.type !== "PUBLISH_POST") return;
  void handle(message).then(sendResponse).catch(() => sendResponse({ ok: false, clicked: message.jobId ? attemptedJobs.has(message.jobId) : false, message: "The Facebook action could not be completed. Check Facebook before trying again." }));
  return true;
});





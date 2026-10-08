import { classifyPostSignals } from "./post-outcome";

type ComposerMessage = { type?: string; jobId?: string; expectedGroupUrl?: string; caption?: string; linkUrl?: string; attachments?: { id: string; filename: string; mimeType: string; dataUrl: string }[]; trackOutcome?: boolean; phase?: string; status?: string; error?: string; enabled?: boolean; generation?: number; uploadError?: string; allowUnverifiedImages?: boolean; strictCaption?: boolean; skipContentVerification?: boolean; autoClickPost?: boolean };
type AdapterResult = { ok: boolean; clicked?: boolean; reason?: string; message?: string; outcome?: "published" | "approval" | "unknown"; warning?: string };
const attemptedJobs = new Set<string>();
const cancelledJobs = new Set<string>();
const jobGenerations = new Map<string, number>();
const uploadedFiles = new Map<string, Set<string>>();
const uploadManifests = new Map<string, string>();
const uploadErrors = new Map<string, string>();
const automaticReadyAt = new Map<string, number>();
const requestLocks = new Set<string>();
const uploadResults = new Map<string, Promise<boolean>>();
const uploadScopes = new Map<string, Element>();
const uploadAttempts = new Map<string, Map<HTMLImageElement, string>>();
const uploadEvidence = new Map<string, { observed: number; verified: number; localToCdn: boolean; methods: Set<string> }>();
const previewObservers = new Map<string, { observer: MutationObserver; detach: () => void }>();
const verifiedPreviews = new Map<string, Map<HTMLImageElement, string>>();
function clearUploadState(jobId: string): void {
  uploadResults.delete(jobId); uploadedFiles.delete(jobId); uploadScopes.delete(jobId);
  uploadAttempts.delete(jobId); verifiedPreviews.delete(jobId);
  previewObservers.get(jobId)?.observer.disconnect(); previewObservers.get(jobId)?.detach(); previewObservers.delete(jobId); uploadErrors.delete(jobId); uploadManifests.delete(jobId); uploadEvidence.delete(jobId);
}
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

// Read logical DOM breaks instead of browser-specific innerText paragraph spacing.
function normalizeCaption(value: string): string {
  return value.normalize("NFC").replace(/\r\n?/g, "\n").replace(/[\u2028\u2029]/g, "\n").replace(/\u00a0/g, " ");
}
function editorText(editor: HTMLElement): string {
  if (editor instanceof HTMLTextAreaElement) return normalizeCaption(editor.value);
  const read = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
    if (!(node instanceof Element)) return "";
    if (node.tagName === "BR") return "\n";
    const children = [...node.childNodes];
    if (children.length === 1 && children[0] instanceof Element && children[0].tagName === "BR") return "";
    let result = "";
    children.forEach((child, index) => {
      const block = child instanceof Element && /^(P|DIV)$/.test(child.tagName);
      const previous = children[index - 1];
      const previousBlock = previous instanceof Element && /^(P|DIV)$/.test(previous.tagName);
      if (index && (block || previousBlock)) result += "\n";
      result += read(child);
    });
    // Chromium adds one trailing filler BR to keep the caret on an empty line.
    if (children.length > 1 && children.at(-1) instanceof Element &&
        (children.at(-1) as Element).tagName === "BR" &&
        children.at(-2) instanceof Element && (children.at(-2) as Element).tagName === "BR") result = result.slice(0, -1);
    return result;
  };
  return normalizeCaption(read(editor));
}
function captionMatches(editor: HTMLElement, text: string): boolean {
  return Boolean(text) && editorText(editor) === normalizeCaption(text);
}

async function fill(editor: HTMLElement, message: ComposerMessage): Promise<boolean> {
  const text = captionText(message);
  // A repeated prepare must preserve a draft the user has reviewed or edited.
  if (preparedJob && preparedJob.id === message.jobId && preparedJob.editor === editor) return true;
  editor.focus();
  if (editor instanceof HTMLTextAreaElement) {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(editor, text);
    editor.dispatchEvent(new Event("input", { bubbles: true }));
  } else {
    const selection = window.getSelection();
    if (!selection) return false;
    selection.selectAllChildren(editor);
    // Let rich editors import plain text through their own paste handler.
    // Lexical converts newlines into editor state instead of raw DOM text.
    const clipboard = new DataTransfer();
    clipboard.setData("text/plain", text);
    const paste = new ClipboardEvent("paste", { clipboardData: clipboard, bubbles: true, cancelable: true });
    editor.dispatchEvent(paste);
    if (paste.defaultPrevented) {
      const valid = message.skipContentVerification ? !cancelled(message) && editor.isConnected : await waitFor(() => captionMatches(editor, text) ? true : undefined, 1800);
      if (valid && message.jobId) preparedJob = { id: message.jobId, editor };
      return Boolean(valid);
    }
    const lines = text.split("\n");
    // Clear the selection even when the first line is empty.
    if (!document.execCommand("delete", false)) return false;
    // Unlike one insertText containing literal \n, insertLineBreak inserts
    // actual <br> nodes / Lexical line breaks (like Shift+Enter).
    for (let i = 0; i < lines.length; i++) {
      if (cancelled(message)) return false;
      if (i > 0 && !document.execCommand("insertLineBreak", false) && !document.execCommand("insertParagraph", false)) return false;
      if (lines[i] && !document.execCommand("insertText", false, lines[i])) return false;
      // Allow the editor to reconcile before the next editing command.
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    }
  }
  // Facebook can reconcile its Lexical state asynchronously. Wait for a
  // stable-looking result instead of declaring failure after a fixed 120 ms.
  const valid = message.skipContentVerification ? !cancelled(message) && editor.isConnected : await waitFor(() => captionMatches(editor, text) ? true : undefined, 1800);
  if (valid && message.jobId) preparedJob = { id: message.jobId, editor };
  return Boolean(valid);
}

function lostCaptionLineBreaks(editor: HTMLElement, message: ComposerMessage): boolean {
  const expected = normalizeCaption(captionText(message));
  const actual = editorText(editor);
  // Detect flattening without treating a deliberate human rewrite as an overwrite request.
  return expected.includes("\n") && !actual.includes("\n") &&
    actual.replace(/\n/g, "") === expected.replace(/\n/g, "");
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

async function waitForAutomaticPost(scope: Element, message: ComposerMessage): Promise<boolean> {
  if (!message.jobId) return false;
  const readyAt = automaticReadyAt.get(message.jobId) ?? Date.now() + 5000;
  automaticReadyAt.set(message.jobId, readyAt);
  const ready = await waitFor(() => {
    if (cancelled(message)) return false;
    if (!scope.isConnected || openComposerEditor()?.closest("[role='dialog'], form") !== scope) {
      message.uploadError = "COMPOSER_CHANGED"; return false;
    }
    const buttons = [...scope.querySelectorAll<HTMLElement>("button,[role='button']")].filter(button => visible(button) && /^(post|publish|đăng|đăng bài)$/i.test(labelOf(button)));
    const enabled = buttons.length === 1 && !buttons[0].matches(":disabled,[aria-disabled='true']");
    return Date.now() >= readyAt && enabled && !scope.querySelector("[role='progressbar'],[aria-busy='true']") ? true : undefined;
  }, 30_000);
  if (!ready) message.uploadError ??= scope.querySelector("[role='progressbar'],[aria-busy='true']") ? "UPLOAD_STILL_PROCESSING" : "POST_BUTTON_DISABLED";
  return Boolean(ready);
}

function cancelled(message: ComposerMessage) { return Boolean(message.jobId && (cancelledJobs.has(message.jobId) || (message.expectedGroupUrl && groupPath(location.href) !== groupPath(message.expectedGroupUrl)) || message.generation !== (jobGenerations.get(message.jobId) ?? 0))); }
function reportStage(message: ComposerMessage, stage: string): void {
  if (message.type !== "PREPARE_CAPTION" || !message.jobId) return;
  // Reporting is best-effort and must never prevent caption/image preparation.
  try {
    void chrome.runtime.sendMessage?.({ type: "AUTO_STAGE", jobId: message.jobId, stage })?.catch(() => undefined);
  } catch { /* The background worker might have restarted. */ }
}

async function pixelDigest(blob: Blob, width?: number, height?: number): Promise<string | undefined> {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  try {
    const targetWidth = width ?? bitmap.width;
    const targetHeight = height ?? bitmap.height;
    if (targetWidth * targetHeight > 32_000_000 || Math.abs(bitmap.width / bitmap.height - targetWidth / targetHeight) / (bitmap.width / bitmap.height) > 0.01) return;
    canvas.width = targetWidth; canvas.height = targetHeight;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return;
    context.drawImage(bitmap, 0, 0, targetWidth, targetHeight);
    const pixels = context.getImageData(0, 0, targetWidth, targetHeight).data;
    return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", pixels)), (byte) => byte.toString(16).padStart(2, "0")).join("");
  } finally {
    bitmap.close(); canvas.width = 0; canvas.height = 0;
  }
}

async function attachImages(scope: Element, message: ComposerMessage): Promise<boolean> {
  if (!message.attachments?.length || !message.jobId) return true;
  const manifest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(message.attachments)))), byte => byte.toString(16).padStart(2, "0")).join("");
  if (uploadAttempts.has(message.jobId) && uploadManifests.get(message.jobId) !== manifest) { message.uploadError = "UPLOAD_PREVIEW_MISMATCH"; return false; }
  uploadManifests.set(message.jobId, manifest);
  if (uploadAttempts.has(message.jobId) && uploadScopes.get(message.jobId) !== scope) {
    message.uploadError = "COMPOSER_CHANGED";
    return false;
  }
  uploadScopes.set(message.jobId, scope);
  const previews = verifiedPreviews.get(message.jobId);
  const baseline = uploadAttempts.get(message.jobId);
  const unexpectedPreview = previews && [...scope.querySelectorAll<HTMLImageElement>("img")].some(image => !previews.has(image) && baseline?.get(image) !== image.src && /^(blob:|data:image\/)/.test(image.src));
  if (!message.skipContentVerification && previews && (uploadErrors.has(message.jobId) || unexpectedPreview || [...previews].some(([image, source]) => !scope.contains(image) || image.src !== source || !image.complete || !image.naturalWidth))) {
    message.uploadError = "UPLOAD_PREVIEW_UNVERIFIED";
    return false;
  }
  const previous = uploadResults.get(message.jobId);
  if (previous) {
    const success = await previous;
    if (!success && message.skipContentVerification && uploadAttempts.has(message.jobId)) {
      // The user selected unchecked AUTO recovery. Reuse the existing upload;
      // never inject the files again after a failed preview verification.
      const ready = await waitForAutomaticPost(scope, message);
      if (ready) { uploadResults.set(message.jobId, Promise.resolve(true)); uploadErrors.delete(message.jobId); }
      return ready;
    }
    message.uploadError = uploadErrors.get(message.jobId);
    return success;
  }
  // Keep the result after dispatch, including timeout and cancellation.
  const result = uploadImages(scope, message);
  uploadResults.set(message.jobId, result);
  const success = await result;
  if (!uploadAttempts.has(message.jobId)) uploadResults.delete(message.jobId);
  if (success) uploadErrors.delete(message.jobId);
  if (!success) uploadErrors.set(message.jobId, message.uploadError ?? "UPLOAD_PREVIEW_UNVERIFIED");
  return success;
}

async function uploadImages(scope: Element, message: ComposerMessage): Promise<boolean> {
  if (!message.attachments?.length || !message.jobId) return true;
  const attached = uploadedFiles.get(message.jobId) ?? new Set<string>();
  const pending = message.attachments.filter((file) => !attached.has(file.id));
  if (!pending.length) return true;
  const inputs = (root: ParentNode) => [...root.querySelectorAll<HTMLInputElement>("input[type='file']")]
    .filter((input) => !input.disabled && /image|\.jpg|\.jpeg|\.png|\.webp/i.test(input.accept));
  const previousInputs = new Set(inputs(document));
  const currentScope = () => openComposerEditor()?.closest("[role='dialog'], form") ?? scope;
  let openedPhoto = false;
  if (!inputs(scope).length) {
    const triggers = [...scope.querySelectorAll<HTMLElement>("button,[role='button']")].filter((element) =>
      visible(element) && /^(photo\s*\/\s*videos?|photos\s*\/\s*videos|ảnh\s*\/\s*video|ảnh và video)(?:$|[\s.,…])/i.test(labelOf(element))
    );
    if (triggers.length !== 1) { message.uploadError = "UPLOAD_INPUT_NOT_FOUND"; return false; }
    triggers[0].click();
    openedPhoto = true;
  }
  const input = await waitFor(() => {
    const scoped = inputs(currentScope());
    const compatible = scoped.filter((input) => pending.length === 1 || input.multiple);
    if (compatible.length === 1) return compatible[0];
    if (scoped.length > 1 || !openedPhoto) return undefined;
    // Some Facebook layouts insert the picker input in a portal outside
    // the dialog. Only use it if opening Photo/video revealed one unique
    // image picker on the entire page.
    const global = inputs(document).filter((input) => !previousInputs.has(input));
    return global.length === 1 ? global[0] : undefined;
  }, 6000);
  if (!input || (!input.multiple && pending.length > 1) || cancelled(message)) { message.uploadError = "UPLOAD_INPUT_NOT_FOUND"; return false; }
  const failedBaseline = uploadAttempts.get(message.jobId);
  if (failedBaseline && ([...currentScope().querySelectorAll<HTMLImageElement>("img")].some((image) => failedBaseline.get(image) !== image.src) || currentScope().querySelector("[role='progressbar'],[aria-busy='true']"))) return false;
  const transfer = new DataTransfer();
  for (const file of pending) {
    const match = /^data:(image\/(?:png|jpeg|webp));base64,(.+)$/.exec(file.dataUrl);
    if (!match || match[1] !== file.mimeType || !(file.mimeType === "image/png" ? /\.png$/i : file.mimeType === "image/jpeg" ? /\.jpe?g$/i : /\.webp$/i).test(file.filename)) return false;
    const bytes = Uint8Array.from(atob(match[2]), (letter) => letter.charCodeAt(0));
    const candidate = new File([bytes], file.filename, { type: file.mimeType });
    try { const bitmap = await createImageBitmap(candidate); bitmap.close(); } catch { return false; }
    transfer.items.add(candidate);
  }
  if (cancelled(message)) return false;
  if (!input.isConnected || currentScope() !== scope || !scope.isConnected) { message.uploadError = "COMPOSER_CHANGED"; return false; }
  const previousImages = new Map([...currentScope().querySelectorAll<HTMLImageElement>("img")].map((image) => [image, image.src]));
  const localSources = new Map<HTMLImageElement, string>();
  const localBlobs = new Map<string, Promise<Blob | undefined>>();
  const lineage = new Map<string, string>();
  const evidence = { observed: 0, verified: 0, localToCdn: false, methods: new Set<string>() };
  uploadEvidence.set(message.jobId, evidence);
  let userChangedImages = false;
  const capture = (image: HTMLImageElement, source = image.src) => {
    if (previousImages.get(image) === source) return;
    if (!/^(blob:|data:image\/)/.test(source)) {
      const original = lineage.get(source);
      if (original) localSources.set(image, original);
      return;
    }
    lineage.set(source, source);
    localSources.set(image, source);
    if (!localBlobs.has(source)) localBlobs.set(source, fetch(source).then((response) => response.blob()).catch(() => undefined));
  };
  const observer = new MutationObserver((changes) => {
    for (const change of changes) {
      if (change.type === "attributes" && change.target instanceof HTMLImageElement) {
        if (change.oldValue) capture(change.target, change.oldValue);
        capture(change.target);
        const original = localSources.get(change.target);
        if (original && /^https:/.test(change.target.src) && /^(blob:|data:image\/)/.test(change.oldValue ?? "")) { lineage.set(change.target.src, original); evidence.localToCdn = true; }
      }
      for (const node of change.addedNodes) {
        if (!(node instanceof Element)) continue;
        if (node instanceof HTMLImageElement) capture(node);
        for (const image of node.querySelectorAll<HTMLImageElement>("img")) capture(image);
      }
    }
  });
  const onUserChange = (event: Event) => {
    if (!event.isTrusted) return;
    if (event.type === "change" && event.target instanceof HTMLInputElement && event.target.type === "file") userChangedImages = true;
    if (event.type === "click" && event.target instanceof Element) {
      const button = event.target.closest<HTMLElement>("button,[role='button']");
      if (button) userChangedImages = true;
      // Preserve submission evidence if the user posts before preparation finishes.
      if (button && /^(post|publish|đăng|đăng bài)$/i.test(labelOf(button)) && !button.matches(":disabled,[aria-disabled='true']")) attemptedJobs.add(message.jobId!);
    }
  };
  const uploadScope = currentScope();
  observer.observe(uploadScope, { childList: true, subtree: true, attributes: true, attributeFilter: ["src"], attributeOldValue: true });
  uploadScope.addEventListener("change", onUserChange, true);
  uploadScope.addEventListener("click", onUserChange, true);
  try {
  // Persist the upload reservation before dispatch. A new document must not
  // assume the old composer is empty after a worker or tab restart.
  const reservation = await chrome.runtime.sendMessage({ type: "UPLOAD_BEGIN", jobId: message.jobId }) as { ok?: boolean };
  if (!reservation?.ok || cancelled(message)) { message.uploadError = "UPLOAD_PREVIEW_UNVERIFIED"; return false; }
  uploadAttempts.set(message.jobId, previousImages);
  input.files = transfer.files;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
  reportStage(message, message.skipContentVerification ? "WAIT_AUTO_POST" : "VERIFY_UPLOAD");
  if (message.skipContentVerification) {
    automaticReadyAt.set(message.jobId, Date.now() + 5000);
    const ready = await waitForAutomaticPost(uploadScope, message);
    if (ready) {
      for (const file of pending) attached.add(file.id);
      uploadedFiles.set(message.jobId, attached);
    }
    return ready;
  }
  const success = Boolean(await waitFor(() => {
    if (cancelled(message) || userChangedImages) return false;
    if (currentScope() !== uploadScope || !uploadScope.isConnected) { message.uploadError = "COMPOSER_CHANGED"; return false; }
    scope = uploadScope;
    for (const [image, original] of localSources) {
      if (scope.contains(image)) continue;
      const replacements = [...scope.querySelectorAll<HTMLImageElement>("img")].filter(candidate => lineage.get(candidate.src) === original && !localSources.has(candidate));
      if (replacements.length === 1) { localSources.delete(image); localSources.set(replacements[0], original); }
    }
    for (const image of scope.querySelectorAll<HTMLImageElement>("img")) {
      capture(image);
      if (previousImages.get(image) !== image.src && !image.naturalWidth) { image.loading = "eager"; image.scrollIntoView({ block: "nearest" }); }
    }
    const previews = [...scope.querySelectorAll<HTMLImageElement>("img")].filter((image) => visible(image) && image.complete && image.naturalWidth > 0 && (/^(blob:|data:image\/)/.test(image.src) || localSources.has(image)) && previousImages.get(image) !== image.src);
    evidence.observed = previews.length;
    return previews.length >= pending.length ? true : undefined;
  }, 30_000));
  if (success) {
    // A CDN replacement is accepted only on the same image element whose local
    // upload source was captured and matched. Never fetch remote Facebook media.
    // Match each preview to one distinct requested file before marking IDs.
    const previews = [...scope.querySelectorAll<HTMLImageElement>("img")].filter((image) => previousImages.get(image) !== image.src && (/^(blob:|data:image\/)/.test(image.src) || localSources.has(image)));
    const digest = async (data: ArrayBuffer) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", data)), (byte) => byte.toString(16).padStart(2, "0")).join("");
    const remaining = await Promise.all([...transfer.files].map(async (file) => ({ file, hash: await digest(await file.arrayBuffer()) })));
    const matchedSources = new Map<HTMLImageElement, string>();
    for (const preview of previews) {
      try {
        const localSource = localSources.get(preview) ?? preview.src;
        const blob = await localBlobs.get(localSource);
        if (!blob || userChangedImages) { message.uploadError = "UPLOAD_PREVIEW_UNVERIFIED"; return false; }
        const bytes = await blob.arrayBuffer();
        const hash = await digest(bytes);
        let match = remaining.findIndex((candidate) => candidate.hash === hash);
        let method = "bytes";
        if (match === -1) {
          // Facebook can re-encode local previews. Require identical decoded pixels,
          // including a resize to the preview dimensions, rather than identical file bytes.
          const bitmap = await createImageBitmap(new Blob([bytes]));
          const width = bitmap.width, height = bitmap.height; bitmap.close();
          const previewPixels = await pixelDigest(new Blob([bytes]), width, height);
          if (previewPixels) {
            for (let index = 0; index < remaining.length; index++) {
              if (await pixelDigest(remaining[index].file, width, height) === previewPixels) { match = index; method = "decoded-pixels"; break; }
            }
          }
        }
        if (match === -1) { message.uploadError = "UPLOAD_PREVIEW_MISMATCH"; return false; }
        evidence.verified++; evidence.methods.add(method);
        matchedSources.set(preview, localSource);
        remaining.splice(match, 1);
      } catch { message.uploadError = "UPLOAD_PREVIEW_UNVERIFIED"; return false; }
    }
    if (remaining.length || cancelled(message) || userChangedImages) return false;
    const ready = await waitFor(() => {
      if (cancelled(message) || userChangedImages) return false;
      if (currentScope() !== uploadScope || !uploadScope.isConnected) { message.uploadError = "COMPOSER_CHANGED"; return false; }
      if (previews.some(image => localSources.get(image) !== matchedSources.get(image) || (!/^(blob:|data:image\/)/.test(image.src) && lineage.get(image.src) !== matchedSources.get(image)))) {
        message.uploadError = "UPLOAD_PREVIEW_UNVERIFIED"; return false;
      }
      if (previews.some(image => !scope.contains(image) || !image.complete || !image.naturalWidth)) return undefined;
      const buttons = [...scope.querySelectorAll<HTMLElement>("button,[role='button']")].filter(element => visible(element) && /^(post|publish|đăng|đăng bài)$/i.test(labelOf(element)));
      return buttons.length === 1 && !buttons[0].matches(":disabled,[aria-disabled='true']") && !scope.querySelector("[role='progressbar'],[aria-busy='true']") ? true : undefined;
    }, 30_000);
    if (!ready) {
      message.uploadError ??= scope.querySelector("[role='progressbar'],[aria-busy='true']") ? "UPLOAD_STILL_PROCESSING" : "POST_BUTTON_DISABLED";
      return false;
    }
    for (const file of pending) attached.add(file.id);
    uploadedFiles.set(message.jobId, attached);
    const verified = new Map(previews.map((image) => [image, image.src]));
    verifiedPreviews.set(message.jobId, verified);
    // Carry proof only through a recorded local-to-remote transition or an
    // unambiguous replacement retaining exactly the verified source.
    const tracker = new MutationObserver(changes => {
      for (const change of changes) {
        if (change.target instanceof HTMLImageElement && verified.has(change.target) && change.type === "attributes") {
          const source = verified.get(change.target)!;
          if (change.oldValue === source && /^(blob:|data:image\/)/.test(source) && /^https:/.test(change.target.src)) verified.set(change.target, change.target.src);
        }
      }
      for (const [image, source] of verified) {
        if (scope.contains(image)) continue;
        const replacements = [...scope.querySelectorAll<HTMLImageElement>("img")].filter(candidate => candidate.src === source && !verified.has(candidate));
        if (replacements.length === 1) { verified.delete(image); verified.set(replacements[0], source); }
      }
    });
    tracker.observe(scope, { subtree: true, childList: true, attributes: true, attributeFilter: ["src"], attributeOldValue: true });
    const onReviewedImageChange = (event: Event) => {
      if (!event.isTrusted) return;
      const target = event.target;
      const button = target instanceof Element ? target.closest<HTMLElement>("button,[role='button']") : undefined;
      if ((event.type === "change" && target instanceof HTMLInputElement && target.type === "file") ||
          (button && !/^(post|publish|đăng|đăng bài)$/i.test(labelOf(button)))) uploadErrors.set(message.jobId!, "UPLOAD_PREVIEW_UNVERIFIED");
    };
    scope.addEventListener("change", onReviewedImageChange, true);
    scope.addEventListener("click", onReviewedImageChange, true);
    previewObservers.set(message.jobId, { observer: tracker, detach: () => {
      scope.removeEventListener("change", onReviewedImageChange, true);
      scope.removeEventListener("click", onReviewedImageChange, true);
    } });
    // Retain dispatch evidence for diagnostics and safe retries.
  }
  if (!success && !cancelled(message)) {
    const shown = [...currentScope().querySelectorAll<HTMLImageElement>("img")].filter((image) => visible(image) && image.complete && image.naturalWidth > 0 && previousImages.get(image) !== image.src);
    message.uploadError ??= shown.length ? "UPLOAD_PREVIEW_UNVERIFIED" : "UPLOAD_PREVIEW_TIMEOUT";
  }
  return success;
  } finally {
    observer.disconnect();
    uploadScope.removeEventListener("change", onUserChange, true);
    uploadScope.removeEventListener("click", onUserChange, true);
  }
}

function notices(): string[] { return [...document.querySelectorAll<HTMLElement>("[role='status'],[role='alert'],[aria-live='polite']")].filter((element) => visible(element) && !element.closest("[role='feed'],[role='article'],article")).map((element) => element.innerText.trim()); }

async function outcome(previous: Set<string>, message: ComposerMessage): Promise<"published" | "approval" | "unknown"> {
  const collected = new Set<string>();
  const collect = () => { for (const text of notices()) if (!previous.has(text)) collected.add(text); };
  const observer = new MutationObserver(collect);
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  let candidate: "published" | "approval" | "unknown" | undefined;
  let since = 0;
  try { return await waitFor(() => {
    if (cancelled(message) || (message.expectedGroupUrl && groupPath(location.href) !== groupPath(message.expectedGroupUrl))) return "unknown" as const;
    if (/\/(login|checkpoint)(\/|$)/i.test(location.pathname) || document.querySelector("input[name='pass']")) return "unknown" as const;
    collect();
    const classification = classifyPostSignals([...collected]);
    const result = classification === "PUBLISHED_CONFIRMED" ? "published" : classification === "PENDING_APPROVAL" ? "approval" : classification === "UNKNOWN" ? undefined : "unknown";
    // Wait briefly for contradictory notices and asynchronous Facebook reconciliation.
    if (result !== candidate) { candidate = result; since = Date.now(); }
    if (candidate && Date.now() - since >= 600) return candidate;
    return undefined;
  }, 30_000) ?? "unknown";
  } finally { observer.disconnect(); }
}

async function handle(message: ComposerMessage): Promise<AdapterResult> {
  if (message.jobId) message.generation = jobGenerations.get(message.jobId) ?? 0;
  if (message.type === "PREPARE_CAPTION" && message.jobId && attemptedJobs.has(message.jobId)) return { ok: false, clicked: true, reason: "ALREADY_SUBMITTED", message: "Review the previous Facebook post before continuing." };
  if (/\/(login|checkpoint|recover|identify)(\/|$)/i.test(location.pathname) || document.querySelector("input[name='pass']")) {
    return { ok: false, clicked: false, reason: "VERIFICATION_REQUIRED", message: "Facebook requires user verification. Please complete it directly on Facebook and retry." };
  }
  if (message.expectedGroupUrl && (!groupPath(message.expectedGroupUrl) || groupPath(location.href) !== groupPath(message.expectedGroupUrl))) {
    return { ok: false, clicked: false, reason: "WRONG_GROUP", message: "Open the exact Facebook Group for this job before continuing." };
  }
  if (cancelled(message)) return { ok: false, clicked: false, message: "Automatic posting was stopped." };
  if (message.jobId) {
    for (const oldId of uploadScopes.keys()) if (oldId !== message.jobId) clearUploadState(oldId);
  }
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
  if (message.skipContentVerification && !message.attachments?.length) {
    reportStage(message, "WAIT_AUTO_POST");
    if (message.type === "PREPARE_CAPTION" && message.jobId) automaticReadyAt.set(message.jobId, Date.now() + 5000);
    if (!scope || !(await waitForAutomaticPost(scope, message))) return { ok: false, clicked: false, reason: message.uploadError ?? "POST_BUTTON_DISABLED", message: "Facebook has not enabled the Post button. Finish editing or uploading images first." };
  }
  if (message.attachments?.length) {
    reportStage(message, "ATTACH_IMAGES");
    if (!scope || !(await attachImages(scope, message))) {
      if (message.jobId && attemptedJobs.has(message.jobId)) return { ok: false, clicked: true, reason: "ALREADY_SUBMITTED", message: "Review the previous Facebook post before continuing." };
      if (!publish && message.allowUnverifiedImages && !cancelled(message) && scope?.isConnected && openComposerEditor() === editor && !scope.querySelector("[role='progressbar'],[aria-busy='true']") && [...scope.querySelectorAll<HTMLElement>("button,[role='button']")].filter(button => visible(button) && /^(post|publish|đăng|đăng bài)$/i.test(labelOf(button)) && !button.matches(":disabled,[aria-disabled='true']")).length === 1) return { ok: true, clicked: false, warning: "Review the caption and attached images on Facebook, then click Post yourself. Image preview verification is unavailable." };
      const descriptions: Record<string, string> = {
        UPLOAD_INPUT_NOT_FOUND: "The Facebook image picker could not be identified. Open Photo/video and review the composer.",
        UPLOAD_PREVIEW_TIMEOUT: "No verifiable preview appeared before the timeout. Images may already be uploading; do not upload them again.",
        UPLOAD_PREVIEW_MISMATCH: "The preview bytes and decoded pixels do not match the requested images. Review the attachments manually.",
        UPLOAD_PREVIEW_UNVERIFIED: "Facebook shows images, but their previews could not be verified. Do not upload them again; review the post manually.",
        UPLOAD_STILL_PROCESSING: "Facebook is still processing the images. Wait and review the composer; do not upload again.",
        POST_BUTTON_DISABLED: "Facebook has not enabled the Post button. Finish editing or uploading images first.",
        COMPOSER_CHANGED: "The Facebook composer changed during preparation. Review the draft; images will not be uploaded again.",
      };
      return { ok: false, clicked: false, reason: message.uploadError ?? "UPLOAD_FAILED", message: descriptions[message.uploadError ?? ""] ?? "Images could not be attached or did not finish uploading. Automatic posting was paused." };
    }
  }
  if (publish && message.skipContentVerification && (!scope || !(await waitForAutomaticPost(scope, message)))) return { ok: false, clicked: false, reason: message.uploadError ?? "POST_BUTTON_DISABLED" };
  if (message.jobId && attemptedJobs.has(message.jobId)) return { ok: false, clicked: true, reason: "ALREADY_SUBMITTED" };
  if (!editor.isConnected || openComposerEditor() !== editor) return { ok: false, clicked: false, reason: "COMPOSER_CHANGED" };
  if (!publish) {
    reportStage(message, "PREPARED");
    return { ok: true, clicked: false };
  }
  const text = editorText(editor);
  if (!text?.trim()) return { ok: false, clicked: false, reason: "EMPTY_CAPTION", message: "The Facebook caption is empty. Prepare the caption before publishing." };
  if (!message.skipContentVerification && message.strictCaption && !captionMatches(editor, captionText(message))) return { ok: false, clicked: false, reason: "CAPTION_FORMAT_INVALID", message: "The caption changed during preparation. Review it before publishing." };
  if (!message.skipContentVerification && lostCaptionLineBreaks(editor, message)) return { ok: false, clicked: false, reason: "CAPTION_FORMAT_INVALID", message: "Facebook could not preserve the caption formatting. Review the text and line breaks before publishing." };
  const buttons = [...scope!.querySelectorAll<HTMLElement>("button, [role='button']")].filter((element) => visible(element) && /^(post|publish|đăng|đăng bài)$/i.test((element.getAttribute("aria-label") ?? element.innerText).trim()));
  if (buttons.length !== 1) return { ok: false, clicked: false, reason: "POST_BUTTON_NOT_FOUND", message: "The Facebook Post button could not be identified. Publish directly on Facebook." };
  const button = buttons[0];
  if (button.matches(":disabled, [aria-disabled='true']")) return { ok: false, clicked: false, reason: "POST_BUTTON_DISABLED", message: "Facebook has not enabled the Post button. Finish editing or uploading images first." };
  // Record the attempt before clicking so a repeated request cannot publish twice.
  if (attemptedJobs.has(message.jobId!)) return { ok: false, clicked: true, reason: "ALREADY_SUBMITTED", message: "A publish attempt was already sent. Check Facebook before confirming the result." };
  if (cancelled(message)) return { ok: false, clicked: false, message: "Automatic posting was stopped." };
  const previousNotices = new Set(notices());
  attemptedJobs.add(message.jobId!);
  const pendingOutcome = message.trackOutcome ? outcome(previousNotices, message) : undefined;
  button.click();
  if (pendingOutcome) return { ok: true, clicked: true, outcome: await pendingOutcome };
  return { ok: true, clicked: true, message: "Publish was sent to Facebook. Check the result, then confirm it in history." };
}

// A small, read-only on-page indicator survives the popup closing when Chrome
// switches to the Facebook tab. Never label it as a Facebook notification.
const PROGRESS_ID = "groupflow-progress-indicator";
let latestProgress: ComposerMessage | undefined;
function renderProgress(message: ComposerMessage): void {
  latestProgress = message;
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
    VERIFYING: message.autoClickPost ? "Đang đăng bài — chờ chuyển nhóm" : "Đang kiểm tra kết quả bài bạn vừa đăng",
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
        ? message.autoClickPost ? "Đang tự đăng và chờ 5 giây để chuyển nhóm. Không kiểm tra xác nhận Facebook." : "Đừng bấm Đăng lần nữa. Đang đợi Facebook xác nhận kết quả."
        : "Mở tiện ích Groupflow để theo dõi tiến trình.";
  panel.append(title, info);
  document.body.append(panel);
}

// Facebook can replace page containers after submitting a post. Restore the
// indicator when that removes it, while retaining the latest worker state.
new MutationObserver(() => {
  if (latestProgress && (latestProgress.enabled || latestProgress.error) &&
      document.body && !document.getElementById(PROGRESS_ID)) renderProgress(latestProgress);
}).observe(document.documentElement, { childList: true, subtree: true });

type UserPostWatcher = { jobId: string; detach: () => void };
let postWatcher: UserPostWatcher | undefined;

function armUserPost(message: ComposerMessage): AdapterResult {
  if (message.jobId) message.generation = jobGenerations.get(message.jobId) ?? 0;
  if (message.jobId && attemptedJobs.has(message.jobId)) return { ok: false, clicked: true, reason: "ALREADY_SUBMITTED" };
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
  const readyButton = matchingButtons()[0];
  if (readyButton.matches(":disabled, [aria-disabled='true']") || dialog.querySelector("[role='progressbar'],[aria-busy='true']")) return { ok: false, clicked: false, reason: "POST_BUTTON_DISABLED", message: "Finish uploading images before reviewing the post." };
  postWatcher?.detach();
  let submitted = false;
  const onClick = (event: MouseEvent) => {
    if (submitted || !event.isTrusted || cancelled(message)) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    const button = target.closest<HTMLElement>("button, [role='button']");
    if (!button || !dialog.contains(button) || !matchingButtons().includes(button) ||
        button.matches(":disabled, [aria-disabled='true']")) return;
    if (groupPath(location.href) !== groupPath(message.expectedGroupUrl!) || matchingButtons().length !== 1 || dialog.querySelector("[role='progressbar'],[aria-busy='true']")) return;
    submitted = true;
    attemptedJobs.add(message.jobId!);
    // The user (not Groupflow) clicked Facebook's Post button. Record this
    // immediately, then inspect only fresh Facebook confirmation notices.
    const previousNotices = new Set(notices());
    document.removeEventListener("click", onClick, true);
    void (async () => {
      try {
        const pendingOutcome = outcome(previousNotices, message);
        const accepted = await chrome.runtime.sendMessage({
          type: "USER_POST_CLICKED", jobId: message.jobId,
        }) as { ok?: boolean; error?: string };
        if (!accepted?.ok) throw new Error(accepted?.error ?? "The Facebook action could not be completed. Check Facebook before trying again.");
        const result = await pendingOutcome;
        const recorded = await chrome.runtime.sendMessage({
          type: "USER_POST_RESULT", jobId: message.jobId, outcome: result,
        }) as { ok?: boolean; error?: string };
        if (!recorded?.ok) throw new Error(recorded?.error ?? "The Facebook action could not be completed. Check Facebook before trying again.");
      } catch (cause) {
        renderProgress({ phase: "PAUSED", enabled: false,
          error: cause instanceof Error ? cause.message : "Extension request failed." });
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
  if (message.type === "PING") {
    sendResponse({ ok: true, url: location.href, readyState: document.readyState, watchingJobId: postWatcher?.jobId });
    return;
  }
  if (message.type === "RESET_SAFE_JOB") {
    if (!message.jobId || attemptedJobs.has(message.jobId)) {
      sendResponse({ ok: false }); return;
    }
    cancelledJobs.delete(message.jobId);
    sendResponse({ ok: true }); return;
  }
  if (message.type === "AUTO_PROGRESS") { renderProgress(message); sendResponse({ ok: true }); return; }
  if (message.type === "ARM_USER_POST") { sendResponse(armUserPost(message)); return; }
  if (message.type === "CANCEL_JOB" && message.jobId) {
    cancelledJobs.add(message.jobId);
    jobGenerations.set(message.jobId, (jobGenerations.get(message.jobId) ?? 0) + 1);
    // Cancellation preserves the upload tombstone to prevent reattachment.
    if (preparedJob?.id === message.jobId) preparedJob = undefined;
    if (postWatcher?.jobId === message.jobId) { postWatcher.detach(); postWatcher = undefined; }
    sendResponse({ ok: true }); return;
  }
  if (message.type !== "PREPARE_CAPTION" && message.type !== "PUBLISH_POST") return;
  const key = message.jobId ?? "invalid-job";
  if (requestLocks.has(key)) { const clicked = attemptedJobs.has(key); sendResponse({ ok: false, clicked, reason: clicked ? "ALREADY_SUBMITTED" : "PREPARATION_IN_PROGRESS" }); return; }
  requestLocks.add(key);
  const observeEarlyPost = (event: MouseEvent) => {
    if (message.type !== "PREPARE_CAPTION" || !message.jobId || !event.isTrusted || cancelledJobs.has(key)) return;
    if (!message.expectedGroupUrl || groupPath(location.href) !== groupPath(message.expectedGroupUrl)) return;
    const target = event.target;
    const button = target instanceof Element ? target.closest<HTMLElement>("button,[role='button']") : undefined;
    const scope = openComposerEditor()?.closest("[role='dialog']");
    if (!button || !scope?.contains(button) || !/^(post|publish|đăng|đăng bài)$/i.test(labelOf(button)) || button.matches(":disabled,[aria-disabled='true']") || scope.querySelector("[role='progressbar'],[aria-busy='true']")) return;
    if (attemptedJobs.has(key)) return;
    attemptedJobs.add(key);
    try { void chrome.runtime.sendMessage({ type: "PREPARATION_POST_CLICKED", jobId: key })?.catch(() => undefined); } catch { /* Preserve local click evidence if the worker is unavailable. */ }
  };
  document.addEventListener("click", observeEarlyPost, true);
  void handle(message).then(result => {
    const scope = message.jobId ? uploadScopes.get(message.jobId) : undefined;
    const evidence = uploadEvidence.get(key);
    const button = scope ? [...scope.querySelectorAll<HTMLElement>("button,[role='button']")].find(element => visible(element) && /^(post|publish|đăng|đăng bài)$/i.test(labelOf(element))) : undefined;
    sendResponse({ ...result, diagnostics: {
      jobId: message.jobId, phase: message.type, expectedAttachmentCount: message.attachments?.length ?? 0,
      observedPreviewCount: evidence?.observed ?? 0, verifiedAttachmentCount: evidence?.verified ?? 0, uploadDispatched: uploadAttempts.has(key),
      verificationMethod: message.skipContentVerification ? "not-checked-user-requested" : evidence?.methods.size ? [...evidence.methods].join(",") : "unverified",
      localToCdn: Boolean(evidence?.localToCdn || [...(verifiedPreviews.get(key)?.values() ?? [])].some(source => /^https:/.test(source))),
      processing: Boolean(scope?.querySelector("[role='progressbar'],[aria-busy='true']")),
      postButtonReady: Boolean(button && !button.matches(":disabled,[aria-disabled='true']")), reason: result.reason,
    } });
  }).catch(() => sendResponse({ ok: false, clicked: message.jobId ? attemptedJobs.has(message.jobId) : false, message: "The Facebook action could not be completed. Check Facebook before trying again." })).finally(() => { document.removeEventListener("click", observeEarlyPost, true); requestLocks.delete(key); });
  return true;
});





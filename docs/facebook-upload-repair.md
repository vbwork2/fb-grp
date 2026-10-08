# Facebook upload and publication repair

## Current AUTO policy: version 0.1.3

At the user's explicit request, AUTO now skips caption equality and image-preview identity verification. After filling text and dispatching image files once, it waits at least five seconds before finding and clicking Post. Text-only posts also wait five seconds. If the Post button is still disabled or Facebook reports upload processing, it waits within a bounded 30-second readiness window, then pauses.

This delay is not proof that the intended text or images are correct. AUTO may publish missing, transformed or incorrect content. The popup explicitly describes the skipped checks. Manual mode retains the existing verification path and inspection warnings.

Correct group/composer checks, cancellation, durable upload reservations and one-click publication protection remain active. AUTO no longer waits for a Facebook publication notice. Once the adapter explicitly reports that Post was clicked, the worker persists the click and a continuation deadline, waits five seconds, then completes the queue attempt and selects the next scheduled eligible group. No click reply or a lost response still pauses rather than assuming a click occurred.

Unchecked completion uses confirmationSource=automatic_unverified. The backend requires recorded automatic-click audit evidence, tags the terminal queue item POST_OUTCOME_UNVERIFIED, writes canonical unverified history notes, leaves the confirmed publication timestamp empty and records QUEUE_ITEM_SUBMITTED_UNVERIFIED. The existing POSTED database status is used for terminal queue accounting, not as proof of publication; queue/history/dashboard rows display Submitted (unverified). The group pacing timestamp records the attempt. No schema migration is required. Confirmed/manual behavior remains unchanged.

The app/backend must also run this updated source before loading extension 0.1.3: older servers reject the new confirmation source, which safely pauses after the click. Updating only the extension is insufficient. No deployment was performed as part of this change. Previously dispatched uploads can be reused in unchecked AUTO recovery without dispatching files again, provided the original composer remains active. A replacement composer/document stays blocked against duplicate upload.

## Confirmed defects in the previous implementation

- Changing composer identity cleared upload evidence. A new dialog could cause the same job to inject its files again.
- A failed preparation removed the cached upload promise. With no visible preview, a retry could dispatch another upload after the first operation timed out.
- Cancellation discarded dispatch evidence, allowing a reset to repeat an upload that might still be processing.
- Verification required an enabled Post button before checking image identity. A readiness timeout was therefore reported as an image verification failure.
- Decoded-pixel comparison used the current image element dimensions, even when that element had changed from a local source to a differently sized remote preview.
- Verification was tied to the original image node/source snapshot and did not retain observed source lineage across later transitions or identical-source node replacements.
- Preparation and publication messages could overlap, and publication observation started after the automatic click.

These are findings from source inspection and controlled regressions. They do not establish the precise behavior of a particular live Facebook account.

## Verification and upload idempotency

The adapter fingerprints the requested attachment IDs, filenames, MIME types and data URLs in memory. A changed manifest after dispatch is blocked. The fingerprint and media sources are never logged.

Before file dispatch, it records composer identity and baseline image nodes/sources, installs mutation and trusted-user-action observation, and asks the worker to persist an UPLOAD_BEGIN reservation. The worker validates the active job, tab, group and preparation phase. Reservations survive worker/document restarts and failed-group resets. A repeated reservation is refused, including concurrent requests. Invalid files or a missing picker can be retried before any dispatch.

The adapter captures only local blob/data media for byte comparison. It first requires a one-to-one match to each requested file by SHA-256 bytes. If encodings differ, it compares SHA-256 of decoded canvas pixels at the captured local preview dimensions, including a supported aspect-preserving resize of the original. This is exact comparison, not a perceptual similarity threshold.

A recorded local-to-HTTPS source transition retains the original local evidence. An unambiguous node replacement with the same observed source retains that lineage. A replacement composer, unrelated source, missing attachment, extra local attachment, or trusted attachment edit invalidates preparation. A brand-new remote image without captured local lineage is insufficient evidence. No private Facebook CDN URL is fetched by verification.

In the verified/manual path, identity verification and Facebook readiness have separate bounded waits of up to 30 seconds each. All requested images must match, previews must load, upload progress must finish, and one scoped Post button must be enabled. File dispatch occurs once. Timeout and cancellation retain the dispatch/result tombstone; a subsequent prepare does not reattach files.

In the verified path, lossy recompression that changes decoded pixels remains uncertain. Unchecked AUTO does not use this result to block publication. A local-to-CDN transition verifies the captured local upload and DOM lineage; it does not independently verify the remote CDN bytes.

## Automatic and manual publication

AUTO uses the five-second unchecked-content policy described above. It still requires the correct group, active composer, nonempty caption and enabled Post button. Preparation/publication requests are mutually exclusive per job. The adapter records its attempt and installs outcome observation before clicking once. The existing backend submission reservation remains durable before the automatic action. AUTO sends trackOutcome=false, records the real click, waits five seconds and advances without inspecting notices. An early human Post click is recorded locally before contacting the backend so a failed request cannot erase submission evidence.

In manual mode, only a fresh, reliable Facebook publication confirmation records a confirmed POSTED result. Manual approval/unknown outcomes retain the reserved job and pause without retrying. AUTO instead records unchecked completion after its five-second post-click delay. The existing confirmation flow clears the completed job and selects the next eligible scheduled group, with no group-count limit. The integration fixture processes four groups sequentially in both posting modes. Scheduling continues to use the server queue and existing alarms.

Dispatched but uncertain image preparation keeps its claim and local job for manual recovery. Preparations without an upload reservation can still be recorded as failed and reset. Switching to manual mode does not bypass readiness: the composer must be present, not processing, with an enabled Post button before installing the trusted-click watcher. Unverified identity is presented as a warning for human inspection.

For manual recovery, stop monitoring, keep the existing Facebook tab open, inspect the caption and every requested attachment, turn off Automatically click Post, and restart the same campaign. The extension preserves the same job/tab rather than navigating away from that draft. If the original document/composer is gone, it refuses automatic reupload; inspect Facebook and resolve the existing job using manual controls. Never reset extension storage to force another upload or Post attempt. Confirm a publication manually only after finding the actual published post, not a pending-approval item.

## Diagnostics and popup

Distinct codes include UPLOAD_INPUT_NOT_FOUND, UPLOAD_PREVIEW_TIMEOUT, UPLOAD_PREVIEW_MISMATCH, UPLOAD_PREVIEW_UNVERIFIED, UPLOAD_STILL_PROCESSING, POST_BUTTON_DISABLED, COMPOSER_CHANGED and POST_OUTCOME_UNKNOWN. English and Vietnamese descriptions explain the cause and safe action.

The adapter returns job ID, phase, expected/observed/verified attachment counts, dispatch state, bytes/pixels verification methods, local-to-CDN observation, processing state, Post readiness and pause reason. The worker stores the latest preparation diagnostics as uploadDiagnostics in chrome.storage.local. No caption, image bytes/data URLs, cookies or credentials are included. Prepared jobs counts completed preparations, not uploaded images.

## Regression coverage

Controlled fixtures cover normal upload/automatic publication; local-to-CDN transitions before and after preparation; lossy recompression blocking; alternative encodings; resizing; delayed previews; composer replacement; multiple images; partial previews; unrelated baseline images; repeated preparation; timeout without redispatch; AUTO and manual warnings; sequential campaigns; unknown outcomes; restart reservation refusal; cancellation; caption line breaks/Unicode; concurrent publication; exact caption checks in the verified path; and extra attachments after verification.

Additional browser regressions cover the minimum five-second delay, bypassing a flattened caption and mismatched preview, cancellation during the delay, a disabled button and reusing an uncertain upload without a second dispatch.

Unit tests cover durable worker reservation validation, duplicate reservations, retained uncertain upload claims, publication reservations, restart uncertainty, cancellation/reset and continuation. Browser tests use intercepted Facebook-like pages and a local HTTP backend fixture. They never post to a real account. Passing fixtures do not establish compatibility with live Facebook DOM, upload processing, or account-specific layouts.

## Validation

Actual validation on 2026-10-08:

| Command | Result |
| --- | --- |
| npm run typecheck | Passed |
| npm run lint | Passed |
| npm run test | 119 tests passed across 7 files |
| npm run extension:build | TypeScript and Vite build passed |
| npm run build | Next.js production build passed |
| npx playwright test e2e/facebook-adapter.spec.ts e2e/automatic-extension.spec.ts --workers=1 | 71 tests passed |
| git diff --check | Passed |

Modified files: extension/src/content/index.ts, extension/src/background/index.ts, extension/src/popup/main.ts, extension/manifest.json, src/lib/i18n/messages.ts, e2e/facebook-adapter.spec.ts, e2e/automatic-extension.spec.ts, tests/extension-background.test.ts, tests/extension-api.test.ts, src/app/api/extension/jobs/[id]/posted/route.ts, the queue/history/dashboard pages and this document. Test-generated screenshots were restored to their original repository versions.

Run from D:\code\fb-group:

```powershell
npm run typecheck
npm run lint
npm run test
npm run extension:build
npm run build
npx playwright test e2e/facebook-adapter.spec.ts e2e/automatic-extension.spec.ts --workers=1
```

Production build validation overrides DATABASE_URL and NETLIFY_DB_URL with a non-production localhost endpoint. No production migration, commit, push, deployment or real Facebook publication is part of this repair.

## Build and reload on Windows

1. Resolve any existing uncertain Facebook publication before reloading; inspect the actual group first.
2. Open PowerShell in D:\code\fb-group and run npm run extension:build.
3. Open chrome://extensions and enable Developer mode.
4. Click Reload on Groupflow Posting Assistant. For a first installation choose Load unpacked and select D:\code\fb-group\extension\dist.
5. Reload the Facebook Group tab so it receives the new content adapter. Confirm the popup footer says v0.1.3. Reloading during an unresolved upload intentionally loses DOM proof and leaves the durable upload reservation blocked.
6. Open the extension popup, select the campaign and choose Automatically click Post. Check the first draft and diagnostics on a controlled, authorized Facebook test group before relying on live automation.

Never retry an already recorded Post click. AUTO advances without proof of publication, so review Facebook separately when needed. Manual mode retains explicit publication confirmation after inspection.

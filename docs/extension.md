# Groupflow Chrome Extension — assisted Facebook Group campaigns

## Setup

1. Build from this branch with `npm run extension:build` and load `extension/dist` at `chrome://extensions` (Developer mode).
2. Pair the extension with Groupflow using a one-time device code from web Settings.
3. Sign in to Facebook **directly in Chrome**. Groupflow never needs your Facebook password, cookies or 2FA codes.
4. Select a campaign from the extension and press **Start preparing posts**. There is no fixed three-group cap; posting intervals still apply.

## How a campaign proceeds

1. Extension opens each scheduled Facebook Group and the **Bạn viết gì đi / Write something** composer.
2. Extension inserts caption with preserved line breaks, attaches configured images, waits for previews and confirms the editor looks ready.
3. **You review the post and click Đăng / Post inside Facebook yourself.** Groupflow does **not** click this button in assisted mode.
4. Only after an actual user click, the extension waits for a fresh, recognizable Facebook publication confirmation. On confirmed success, it records history and opens the next group once due.
5. A notice that the post is awaiting administrator approval, or an ambiguous/missing publication notice, pauses automation. Check Facebook first. If you can clearly verify that the post has actually been published, click **I verified this post is published** in the extension to record it and continue. Otherwise keep it pending for review.

## Controls and recovery

- **Stop monitoring:** stops the local run; does not cancel the campaign on the server. It cannot undo a Facebook submission.
- **Cancel campaign:** cancels the campaign on the server and locally. Only submissions that are certain not to have been sent are released; uncertain submissions stay protected from duplicates.
- **Reset failed groups:** sets only `FAILED` queue entries back to `READY`, without touching successful or unconfirmed submissions. Start again to process those groups.
- **Advanced: manual posting and recovery:** provides caption copying and explicit outcome controls. Only use **I posted it** or **I verified this post is published** after reviewing the Facebook result.

The web app can also cancel a campaign. Neither cancel nor reset can retract posts Facebook has already received. Queued groups are processed sequentially, not simultaneously, and must reach their scheduled time. Respect each group's rules and avoid unwanted posts.

## Safety and troubleshooting

- The extension does not bypass login, checkpoint or group-approval restrictions.
- Claims are reserved before a user can click Post, and unknown results remain in `AWAITING_CONFIRMATION` rather than being automatically retried.
- If a group fails before any possible submission, the job is marked `FAILED`, so it can be reset safely.
- The Facebook editor and its notices can change. If publication confirmation is missing, use manual review instead of assuming success.
- After updating the code, run `npm run extension:build`, reload the extension, and refresh Facebook tabs. A server redeploy alone will **not** update an unpacked Chrome Extension.
- You can run checks locally with `npm run typecheck`, `npm run test`, `npm run extension:build` and `npx playwright test e2e/facebook-adapter.spec.ts`.

API traffic goes through the extension service worker. Facebook authentication stays in the user's own Chrome session.

## Repair and verification details

The old automatic Post switch is removed. A stored autoPublish preference is ignored by assisted campaigns. Actual trusted clicks have a separate audit event; a reservation alone is not a click. After a worker restart or lost watcher, the extension pauses for review rather than submitting again. Failed/skip operations cannot unlock an uncertain submission. Image decoding and loaded local previews are required; CDN-only or ambiguous previews need manual review.

Run `npx playwright test e2e/facebook-adapter.spec.ts e2e/automatic-extension.spec.ts` to verify controlled DOM plus the actual unpacked popup/worker. See [repair report](repair-report.md) for this run and limitations.

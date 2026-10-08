# Chrome Extension

Build with `npm run extension:build`. The unpacked extension is in `extension/dist`.

1. Open `chrome://extensions`, enable Developer mode, and load `extension/dist`.
2. Generate a pairing code in the web app's Settings. Enter the app URL and code in the extension.
3. Request the next group. Open its Facebook post composer if it is not detected automatically.
4. Click Prepare caption to review and edit the text, or click Publish to Facebook to fill and submit it in one action.
5. For jobs with images, attach them in Facebook yourself, wait for uploads, then check Images attached in Facebook.
6. Click Publish to Facebook. The extension validates the live job, checks the exact group, and clicks one enabled Post/Đăng button inside its composer.
7. Inspect Facebook's result, including group approval requirements. Only then click I posted it to save history. A click alone is not recorded as a successful post.

## Assisted campaigns — no three-group limit

1. Create a campaign with the groups you selected. Schedule intervals still apply.
2. Keep Chrome open, sign in to Facebook directly, and pair the extension with Groupflow.
3. Select a campaign and press **Start preparing posts**.
4. The extension opens each Facebook Group, opens **Write something / Bạn viết gì đi**, inserts the caption with its line breaks, and attaches images. It waits for upload previews before marking the post ready.
5. **You must review and click Post / Đăng on Facebook yourself.** The extension does not click this button in the assisted workflow.
6. The extension observes your Post click and checks for a new, recognizable Facebook publication confirmation. On success it saves history and proceeds to the next due group. If it cannot confirm success or sees a group-approval notice, it stops and asks you to review the result; it must not automatically repost.
7. When Facebook offers no reliable confirmation, use **I verified this post is published** only after checking the group. The next group will be opened if monitoring is still enabled.
8. Use **Cancel campaign** to cancel the campaign on the server and stop local monitoring; it cannot retract posts submitted on Facebook.
9. Use **Reset failed groups** after a preparation error. This resets only queue jobs with status `FAILED` and never resets `POSTED` or `AWAITING_CONFIRMATION` jobs. Restart the campaign to retry them.

The previous three-group automatic limit and the fixed campaign-selection cap were removed. Available groups are still bounded in practice by infrastructure capacity, Facebook's rules, and the need for a human click on each post. Each group's configured scheduled time must be reached before it can be prepared.

Manual controls remain in Advanced. Authentication checks and server-side job reservations prevent unchecked repeats. Do not mark posts as published until verified on Facebook.


Reload the extension in `chrome://extensions` and reload already-open Facebook Group tabs after installing a new build. The Language selector offers English and Tiếng Việt.

All API requests go through the service worker. Tokens are stored locally and hashes on the server. The manifest supports Netlify app domains and localhost; add an exact custom app hostname before building when needed.

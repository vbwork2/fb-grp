# Chrome Extension

Build with `npm run extension:build`. The unpacked extension is in `extension/dist`.

1. Open `chrome://extensions`, enable Developer mode, and load `extension/dist`.
2. Generate a pairing code in the web app's Settings. Enter the app URL and code in the extension.
3. Request the next group. Open its Facebook post composer if it is not detected automatically.
4. Click Prepare caption to review and edit the text, or click Publish to Facebook to fill and submit it in one action.
5. For jobs with images, attach them in Facebook yourself, wait for uploads, then check Images attached in Facebook.
6. Click Publish to Facebook. The extension validates the live job, checks the exact group, and clicks one enabled Post/Đăng button inside its composer.
7. Inspect Facebook's result, including group approval requirements. Only then click I posted it to save history. A click alone is not recorded as a successful post.

## Automatic posting, up to three groups

1. Create content with PNG, JPEG or WebP images in the web app.
2. Create a campaign containing one to three groups you select and configure its posting intervals.
3. Keep Chrome open and sign in to Facebook directly. Pair the extension with the web app.
4. Click Refresh campaigns, select the campaign, then click Start automatic posting.
5. The extension opens each due group, fills the caption, attaches images, waits for previews and an enabled Post button, and submits once. Chrome alarms check for the next due group every minute.
6. Click Stop automatic posting to stop further submissions. Verification, missing controls, upload failures, group approval and uncertain results stop the run for review.

The server rejects campaigns containing more than three selected groups. Each run also stops after three submission attempts. Before submission the server reserves the job as AWAITING_CONFIRMATION; uncertain submissions cannot be reclaimed by another device. Only a new recognizable Facebook publication confirmation allows automatic history recording. Approval requests remain unconfirmed until reviewed.

A sent or uncertain attempt is locked to avoid duplicates; inspect Facebook and use the manual outcome controls. Stopping cannot retract a submission already sent to Facebook. If no click occurred because the composer/button was missing or disabled, fix the page and retry.

Copy and manual Facebook publishing remain available when the DOM adapter cannot identify the composer or Post button. Real Facebook behavior needs manual verification; automated tests use controlled pages.

Reload the extension in `chrome://extensions` and reload already-open Facebook Group tabs after installing a new build. The Language selector offers English and Tiếng Việt.

All API requests go through the service worker. Tokens are stored locally and hashes on the server. The manifest supports Netlify app domains and localhost; add an exact custom app hostname before building when needed.

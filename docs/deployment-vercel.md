# Vercel deployment

## Project and architecture

Import vbwork2/fb-grp into ONE Vercel project. Framework preset: Next.js; Root Directory: .; Node.js: 24.x; install: npm install; build: npm run build. Keep the default Next.js output setting. No vercel.json, extra service, static export, container or always-on worker is required.

Vercel runs the dashboard, authentication, campaigns and all App Router APIs. Existing Neon PostgreSQL stores relational data through Drizzle. A PRIVATE Vercel Blob store stores images. The Manifest V3 Chrome Extension stays installed locally and calls the same app APIs from its service worker; do not add it as a Vercel Service.

Security headers are defined in next.config.ts. Production adds CSP and HSTS; development retains headers that do not interfere with hot reload. Rate limits remain atomic database records shared across Function instances, rather than process memory. IP-based keys use validated x-vercel-forwarded-for only when VERCEL=1; outside Vercel they use unknown instead of trusting spoofable headers.

## Environment variables

Configure each Vercel environment explicitly. Do not upload .env.local, commit secrets, replace existing production secrets, or set NODE_ENV=development on Vercel. Use separate preview Neon and Blob stores for controlled tests.

| Variable | Purpose |
| --- | --- |
| AUTH_SECRET | Existing secret, at least 32 random characters; retain it during cutover to avoid unnecessary session invalidation |
| APP_URL | Exact production HTTPS origin; use the exact preview origin in Preview and redeploy after configuring it |
| DATABASE_PROVIDER | neon |
| DATABASE_URL | Existing Neon pooled PostgreSQL URL, including sslmode=require |
| BLOB_READ_WRITE_TOKEN | Server-only read/write credential for a PRIVATE store; @vercel/blob 2.8.1 supports it |
| RESEND_API_KEY | Production password reset email credential |
| RESEND_FROM_EMAIL | Verified sender |
| PAIRING_CODE_TTL_SECONDS | 300 |
| DEVICE_TOKEN_TTL_DAYS | 90 |
| QUEUE_CLAIM_TTL_MINUTES | 30 |
| MAX_UPLOAD_SIZE_MB | 4; production caps files at 4 MiB |

The current Blob SDK also supports automatic OIDC credentials with BLOB_STORE_ID and Vercel-managed VERCEL_OIDC_TOKEN. Connect a private store to the appropriate project environments to use OIDC; otherwise supply BLOB_READ_WRITE_TOKEN. Never make either credential public or prefix it with NEXT_PUBLIC_. Keep tokens in Vercel environment settings or a secure local migration environment.

Use the unchanged schema and migration history described in [database setup](database.md). This hosting migration requires no new database migration. If there are genuinely pending migrations, review a backup and the intended target first, then run npm run db:migrate. Never reset or overwrite the database.

## Private Blob setup and upload limits

Create a Blob store with PRIVATE access and connect it to the single app project. The adapter writes opaque keys without a random suffix or overwrites, so media.storage_key remains unchanged. putMedia/getMedia/deleteMedia interfaces are retained. MIME types come from validated JPG, PNG and WebP uploads.

Web reads require the session and workspace; extension reads require a valid, unexpired, unrevoked device token and workspace. All reads pass through the authenticated media APIs with private, no-store responses. No storage URL redirect or public image URL is returned. SDK failures produce sanitized API errors and failed deletion retains metadata for retry.

Vercel Functions allow at most 4.5 MB request and response payloads. Upload one file per multipart request, at most 4 MiB, leaving room for the normal contentId/form envelope. A very large multipart envelope may still be rejected by the platform with 413 before the handler runs. Do not batch several files into one request. Legacy images over the response limit must be resized into reviewed copies or moved to an authenticated streaming delivery design before cutover; the current buffered retrieval path is intended for <=4 MiB images. Never silently destroy original files.

## Safe Netlify image migration

Do not delete the old store or alter production metadata. Pause uploads and media edits during the final copy/cutover window. Back up Neon metadata and export the existing groupflow-media Netlify store through an authenticated export process. Keep export credentials and image bytes outside Git.

1. Inventory each Neon media row by storage_key, mime_type and size_bytes. Check for missing objects, unusual keys and files over 4 MiB. Existing app keys are UUIDs; this adapter permits opaque alphanumeric, underscore and hyphen keys only.
2. Using a separate secured migration environment with the old Netlify SDK and credentials, read each source object. Verify bytes and MIME signature against metadata; record SHA-256 and byte length in a private migration manifest.
3. Upload those exact bytes under the SAME storage_key using @vercel/blob put with access: private, addRandomSuffix: false, allowOverwrite: false and contentType: mime_type. Do not recreate database rows or point keys to URLs. If a destination key exists, compare hashes before accepting it; never blindly overwrite.
4. Read the destination back using authenticated get, compare SHA-256/length, and record success for each row. Reconcile all rows. Preserve source objects and manifest. Missing objects and oversized images need explicit resolution before cutover.
5. Test workspace isolation and extension retrieval on the preview, then perform the final delta copy while edits remain paused. Resume edits only after production checks.

This document describes the migration; no production data copy, deletion or database change was performed by this code migration.

## Build and preview

Run these commands from the repository root:

~~~powershell
npm install
npm --prefix extension install
npm run typecheck
npm run lint
npm run test
npm run build
npm run extension:build
npx playwright test --workers=1
~~~

For a new machine, install Chromium with npx playwright install chromium. Browser live-data tests are opt-in. Enable LIVE_API_TESTS=1 or npm run test:acceptance only after confirming a disposable test database: those tests create and clean up data. Do not run them against production.

With official CLI account access:

~~~powershell
npx vercel login
npx vercel link
npx vercel env ls
npx vercel deploy
~~~

Select the correct account and the existing intended project when linking; confirm Root Directory is . in the dashboard. Configure Preview secrets privately before deployment. Preview is the CLI default. Set APP_URL to its verified HTTPS origin, redeploy, and use an accessible stable preview alias when pairing the extension. If Deployment Protection blocks the extension, use an isolated preview with approved access; never weaken production protection just to test.

## Browser and extension verification

- Check login/register/forgot-password pages, console and network errors, desktop/mobile navigation and response security headers.
- Using isolated test accounts, register, login/logout, verify Secure/HttpOnly/SameSite cookies and password-reset delivery, one-time use and session invalidation.
- Create controlled groups, captions, images and campaigns; check queue scheduling and history. Verify another workspace cannot read, change or delete private media.
- Reject oversized or spoofed image uploads. Upload/retrieve/delete each allowed format; check storage outage behavior and ensure direct unauthenticated Blob URLs do not return bytes.
- Build and reload extension/dist at chrome://extensions. Enter the exact HTTPS app origin, approve its optional host permission, obtain a new pairing code in Settings and pair. Do not grant blanket HTTPS access. Confirm API communication, image previews, expiration and immediate device revocation.
- Keep Automatically click Post off for the default human-reviewed workflow. Test group opening and preparation with controlled fixtures; only a reliable publication notice or explicit user verification advances the queue. Optional automatic mode now checks preparation and outcome too. Uncertain or approval outcomes pause; never resubmit automatically.
- Stop, Cancel Campaign and Reset Failed Groups must retain uncertain submissions and history. Worker restart must pause pending verification. Do not submit real Facebook posts without explicit authorization.

The exact-origin host grant is requested by the popup during the Pair button gesture. Chrome service-worker fetches use that permission and bearer authentication; web session routes continue to reject cross-origin mutations. No wildcard Access-Control-Allow-Origin or exposure of device tokens to Facebook is needed.

## Production and rollback

After preview verification and explicit production deployment authorization:

~~~powershell
npx vercel deploy --prod
~~~

Confirm the production APP_URL and every secret without printing values, complete the final image copy, and run the verification checklist before moving traffic. Production deployment was not automatically authorized by the migration request.

Keep the prior deployment, Netlify storage and database backup available. Roll back the Vercel deployment or DNS to the known-good version if verification fails. Do not roll back the schema or delete new data. Netlify will not see images created only in Vercel Blob after cutover: pause writes and reconcile those objects safely before reverting traffic to Netlify. Re-pair the local extension if the app origin changes. Rollback across storage providers needs a deliberate data reconciliation window.

## Common errors

| Symptom | Check |
| --- | --- |
| Build failure | Node 24, lockfile installation and Root Directory .; do not deploy extension as a service |
| Missing database configuration | DATABASE_PROVIDER=neon and DATABASE_URL in the selected environment |
| Database connection exhausted | Use Neon's pooled URL; the application limits each instance to three connections |
| Private image 503 | Correct private store and environment credentials; redeploy after changes |
| Image 404 | Metadata ownership and copied storage key; do not make the store public |
| FUNCTION_PAYLOAD_TOO_LARGE | File <=4 MiB, one multipart file per request, small envelope; review legacy oversized files |
| Pairing network error | Exact origin host grant, app URL, preview protection, token/code validity |
| Reset email absent | Verified Resend sender, key and APP_URL for that deployment |

## Official references

- [Vercel Next.js](https://vercel.com/docs/frameworks/full-stack/nextjs)
- [Blob SDK and private reads](https://vercel.com/docs/vercel-blob/using-blob-sdk)
- [Vercel Function limits](https://vercel.com/docs/functions/limitations)
- [Vercel request headers](https://vercel.com/docs/headers/request-headers)
- [Neon connection pooling](https://neon.com/docs/connect/connection-pooling)
- [Chrome optional host permissions](https://developer.chrome.com/docs/extensions/reference/api/permissions)

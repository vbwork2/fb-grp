# Vercel migration report

Date: 2026-10-08 (Asia/Bangkok). Branch: codex/vercel-migration.

## Implementation

- Replaced @netlify/blobs and @netlify/database dependencies with @vercel/blob 2.8.1. Production images use private writes and authenticated reads; local filesystem storage still works.
- Kept putMedia/getMedia/deleteMedia signatures and database storage keys. No public URLs or tokens are exposed. Media APIs retain workspace authorization, private/no-store responses and sanitized storage failures. Failed metadata insertion attempts cleanup of only its new object; failed deletion preserves metadata.
- Kept Neon, Drizzle, schema and migration history; small postgres-js pool with prepared statements disabled. Production requires DATABASE_URL and neon provider. No schema migration added.
- Removed netlify.toml and moved security headers to Next.js. Shared database rate limits use validated Vercel platform IPs, not Netlify headers or arbitrary forwarded headers.
- Extension pairing requests only the chosen HTTPS app origin through optional host permissions, supporting Vercel and custom domains. Facebook and localhost remain required permissions. Default human Post workflow, queue, history, image preparation, Stop/Cancel/Reset and device-token auth remain intact.
- Removed unverified automatic completion: old extensions receive 400 for automatic_unverified. Optional automatic Post now verifies caption/images and publication outcome. Missing/approval evidence or worker restart pauses the reserved job without retry or success recording.
- Added deployment, safe image copy, credentials, preview, production authorization, verification and rollback documentation. Historical Netlify reports are marked as earlier revisions. Added a production build to GitHub CI with dummy credentials.

## Architecture

One Vercel project rooted at . runs Next.js pages and all APIs, connected to existing Neon PostgreSQL and a PRIVATE Vercel Blob store. Chrome Extension remains installed locally and calls this project's APIs from its service worker. No Vercel extension service, microservice or new database is introduced.

## Verification

| Check | Result |
| --- | --- |
| npm install / extension install | Passed; dependency audit reported zero vulnerabilities |
| npm run typecheck | Passed |
| npm run lint | Passed |
| npm run test | 136 passed, 9 files, zero failures/skips |
| npm run build | Passed; existing pages and API routes preserved |
| npm run extension:build | Passed |
| Existing Neon SELECT 1 | Passed; read-only query, no data/schema changes |
| Production local smoke | Passed; security headers/CSP/HSTS, anonymous media 401, dashboard redirect, auth pages at 1440/390 widths and no console/page errors |
| Final Playwright suite | 95 passed, 4 live-data tests skipped, zero failures (99 total) |
| Corrected extension browser scenarios | 4 passed: default manual mode, ignored legacy preference, verified automatic continuation and pause without evidence |
| Live Vercel/Blob/email/Facebook | Not executed; external account/storage credentials and controlled live test data required |

The first browser run had 93 passes, one failure and four live-data skips. The failing legacy assertion expected completion without a publication notice. It was replaced with verified success and no-evidence pause coverage, preserving and strengthening the scenario. A new local storage assertion initially compared Buffer and Uint8Array prototypes; it now compares bytes, and all 136 unit/API tests pass.

Auth/API coverage uses disposable in-memory PostgreSQL, the unchanged schema/migrations, actual signed-session/password code and mocked email/storage boundaries. It covers registration, login/logout, production cookie flags, rate limiting, one-use reset and session invalidation, one-use pairing, hashed tokens, expiry/revocation, upload/retrieval, workspace isolation, queue transitions and Stop/Cancel/Reset. Blob SDK calls are mocked for contract tests; this does not certify a live store.

## Remaining setup and limitations

Vercel CLI 63.1.0 reports Logged out. No project link or Blob credentials were available, so no preview/production URL is claimed. Sign in with npx vercel login; link the intended single project rooted at .; privately configure Preview secrets and a private store, then deploy and verify Preview. Production deployment requires explicit approval after preview verification.

Do not merge until required checks and deployment configuration are reviewed. No production database reset, migration, seed, image copy/deletion, real Facebook post or production deployment was performed. No local secret file was changed or committed.

Rebuild using npm run extension:build, reload extension/dist in Chrome and refresh Facebook tabs. Pair with the new exact HTTPS origin and a new Settings code; approve only that domain. Existing sessions may require sign-in again when the domain changes. Old extension unverified submissions are rejected and remain pending for review.

Read [deployment-vercel.md](deployment-vercel.md) before cutover. Preserve old Netlify objects; copy and verify each source/destination by SHA-256 under its existing storage_key. Legacy images larger than the buffered Function response limit need reviewed handling before migration. Password-reset delivery, actual private Blob access, permission prompts, live preview protection and Facebook's current DOM require controlled manual verification. The four live-data Playwright cases stay opt-in because the existing database was not established as disposable.

## Modified files

- .env.example
- .github/workflows/validate-extension.yml
- IMPLEMENTATION_REPORT.md
- README.md
- docs/README.md
- docs/architecture.md
- docs/chrome-web-store.md
- docs/database.md
- docs/deployment-vercel.md
- docs/deployment.md
- docs/extension.md
- docs/facebook-upload-repair.md
- docs/repair-report.md
- docs/vercel-migration-report.md
- docs/verification.md
- docs/workflow.md
- e2e/automatic-extension.spec.ts
- extension/manifest.json
- extension/src/background/index.ts
- extension/src/popup/index.html
- extension/src/popup/main.ts
- netlify.toml
- next.config.ts
- package-lock.json
- package.json
- scripts/run-acceptance.ts
- src/app/api/auth/forgot-password/route.ts
- src/app/api/auth/login/route.ts
- src/app/api/auth/register/route.ts
- src/app/api/extension/jobs/[id]/posted/route.ts
- src/app/api/extension/media/[id]/route.ts
- src/app/api/extension/pair/route.ts
- src/app/api/media/[id]/route.ts
- src/app/api/media/route.ts
- src/lib/config.ts
- src/lib/db/connection.ts
- src/lib/db/index.ts
- src/lib/i18n/messages.ts
- src/lib/security/client-ip.ts
- src/lib/storage/index.ts
- tests/extension-api.test.ts
- tests/extension-background.test.ts
- tests/vercel-auth-media.test.ts
- tests/vercel-storage.test.ts

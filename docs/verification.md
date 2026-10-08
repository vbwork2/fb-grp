> Historical report: hosting details and prior test results describe an earlier revision. Current deployment instructions are in docs/deployment-vercel.md.

# Verification report

Date: 2026-10-08. Runtime: Windows 11, Node.js 24, local Next.js server connected to Neon PostgreSQL.

## Historical verification

The tables below describe an earlier run, not the current repair. Current results and blockers are in [repair-report.md](repair-report.md).

## Commands

| Check | Result |
| --- | --- |
| `npm run typecheck` | Passed |
| `npm run lint` | Passed |
| `npm run test` | 48 passed |
| `npm run test:acceptance` | 23 passed; includes extension build |
| `npm run build` | Passed |
| `npm audit` | Previous report: 0 known vulnerabilities; not rerun in this repair pass |

## Coverage

| Area | Automated checks |
| --- | --- |
| Authentication | Registration, duplicate account, browser login after anonymous redirect and logout in both languages, bad password, password change, reset expiry and single use, disabled account, rate limits, Origin checks |
| Workspace access | Two real temporary accounts; foreign group/content/campaign/media/job IDs rejected |
| Groups | Create/edit/status, duplicates, URL validation, CSV import and deletion |
| Content/media | Create/edit/duplicate/delete, variants, unsafe link rejection, upload/readback, invalid MIME, campaign dependency conflict |
| Campaigns | Four-step browser wizard, start/pause/resume/cancel, schedule intervals, retry and completion |
| Queue | Concurrent device claims, future jobs, paused campaigns, stale claims, posted/skipped/failed outcomes, incomplete jobs prevent premature completion |
| History | Outcome records and CSV export |
| Devices | Pair expiry, single use, revocation, expiry, disabled account and workspace isolation |
| Extension | Background worker unit checks and real Chromium extension loading/pairing/job navigation/copy/preparation/media/reporting/revocation; default assisted preparation, opt-in automatic Post across controlled groups, persisted mode selection, and trusted user-click verification; Stop and uncertain outcome protection |
| Facebook adapter | Controlled composer, missing composer, verification screen, preparation never posts; explicit publish clicks once; wrong group, disabled and ambiguous buttons rejected; edited captions preserved; image previews, fresh publication notices, approval and cancellation |
| Durable submissions | Foreign campaign/submission rejection, reservation before click, repeated begin rejected, release after no click, expired AWAITING_CONFIRMATION jobs cannot be reclaimed |
| Database | PostgreSQL migrations in a disposable schema; seed runs twice with unchanged counts |
| Language | English/Vietnamese selection, persistence, translated auth errors, authenticated filters keep stable status values, extension localization preserves captions |
| App pages | Authenticated dashboard, groups, content, campaigns/detail, queue, history and settings render |

Live acceptance tests create temporary accounts and a disposable schema, then clean their data in `finally`. Only the generated schema is dropped. Set up `.env.local`, run `npm run dev` in one terminal, then `npm run test:acceptance` in another. Default `npm run test:e2e` skips live database checks unless explicitly enabled.

## Defects corrected during verification

- Nested database conflicts now produce proper conflict responses.
- PostgreSQL queue claims lock the queue table explicitly and claim pending/ready rows atomically.
- Campaign completion waits for all unfinished jobs and serializes completion checks.
- Device access checks active users and workspace membership.
- Content links and Facebook outcome links reject unsafe destinations.
- Content referenced by a campaign returns an understandable deletion conflict.
- Standalone seed loads environment configuration, supports the project's module format and sets transaction-local schema selection for pooled PostgreSQL connections.
- Runtime and migration configuration share database selection.
- Production uploads are capped at 4 MB; Blobs reads use strong consistency.
- Extension returns to pairing after its token is revoked.
- Extension build now emits one canonical manifest, including the alarms permission needed for automatic scheduling.
- Repeated image preparation shares the upload result instead of treating an unfinished upload as ready.
- Uncertain submissions remain reserved and block fetching another local job until reviewed.

## Posting repair verification

- Removed duplicate translation keys that caused TS1117 and blocked builds.
- Manual extension publishing now reserves AWAITING_CONFIRMATION on the server before clicking Facebook, matching the reservation flow. A no-click response releases the reservation; a failed release keeps the local attempt locked.
- The adapter waits for delayed composer rendering and checks cancellation before opening a newly rendered trigger or filling the editor.
- Typecheck, lint, 48 unit tests, production build, extension build and 23 live acceptance tests passed. The final adapter build also passed all 17 targeted browser tests.
- Chromium acceptance verified image attachment, publication confirmation, history and completion across two controlled Facebook Group pages. No post was sent to real Facebook.
- Reload the unpacked extension from extension/dist and reload Facebook tabs before using the repaired build.

## Remaining checks and scope

No Netlify site has been linked or deployed from this workspace. Production HTTPS cookies, Netlify Blobs and actual Resend delivery need a deployed smoke check. Facebook page tests use controlled DOM; real Facebook composer behavior still needs manual verification. Search/filter/pagination and every visual interaction do not have exhaustive browser coverage.

Optional OAuth, team invitations and avatars remain absent. Workspace default pacing is not implemented; individual queue-page actions are limited. Auth uses custom signed cookies instead of Auth.js, and the UI does not use shadcn/ui. These differences prevent claiming every original acceptance criterion is complete. The current tested MVP is suitable for a Netlify preview, followed by the deployment checklist.



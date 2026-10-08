> Historical report: hosting details and prior test results describe an earlier revision. Current deployment instructions are in docs/deployment-vercel.md.

# Implementation Report

## 1. System Architecture

Single Next.js App Router application for Netlify, with PostgreSQL for relational data, Netlify Blobs for production images, and a separate Manifest V3 Chrome Extension.

## 2. Tech Stack

Next.js 16, React 19, TypeScript, Tailwind CSS 4, Zod, Drizzle ORM 1.0 RC, PostgreSQL, Vitest, Playwright, Vite, and Chrome Extension Manifest V3.

## 3. Database Implementation

Drizzle schema and generated PostgreSQL migrations live under `src/lib/db` and `netlify/database/migrations`. Netlify Database is selected with `DATABASE_PROVIDER=netlify` and `NETLIFY_DB_URL`; Neon/local PostgreSQL uses `DATABASE_PROVIDER=neon` and `DATABASE_URL`. Migration SQL was executed in PGlite and live Neon PostgreSQL. Live migration/seed acceptance checks use a disposable schema and verify idempotent seed execution.

## 4. Authentication

Email/password registration and login, scrypt password hashes, signed HttpOnly sessions, password change, and single-use expiring password reset links are implemented. Development uses a console email provider; production reset email uses Resend. Auth.js was not adopted: sessions use a small custom HMAC-signed cookie implementation instead.

## 5. Multi-user and Workspace Security

Registration creates a personal workspace. Data access routes scope queries to the authenticated workspace. PGlite tests cover guessed cross-workspace IDs for groups, content, campaigns, queue, history, devices, and media, plus group mutation, device revocation, and pairing-code expiry/use.

## 6. Group Manager

Add, search, status/category filter, server-side pagination, edit, pause, bulk disable, delete, duplicate prevention, Facebook Group URL validation/canonicalization, and CSV import are implemented.

## 7. Content Manager

Reusable captions, optional links, create/edit/duplicate/delete actions, variants with create/edit/delete, and validated JPG/PNG/WebP uploads are implemented. Uploads are workspace-scoped and use random storage keys.

## 8. Campaign System

Campaign creation uses a four-step wizard for campaign/content, group selection with search/category/select-all, schedule and pacing, and review. Campaign detail supports start/pause/resume/cancel and explicit retry of failed items.

## 9. Queue Engine

Queue generation stores scheduled timestamps and runs without an always-on worker. The extension endpoint claims one eligible row in a database transaction, supports stale claims, and enforces centralized state transitions. Queue planning and transition tests pass. Simultaneous two-device claims pass against Neon; completion, future scheduling, stale claims and retry are covered.

## 10. History

Posted, skipped, and user-reported failed jobs create history rows. History display includes campaign/group/status/date filters, server-side pagination, and workspace-scoped CSV export.

## 11. Dashboard

Shows group, campaign, pending, posted-today, and failed counts, with recent activity and campaign status. Active campaign progress bars are calculated from queue totals.

## 12. Device Pairing

Pair codes are random, hashed, one use, and configurable by expiry. Device tokens are returned once and stored as hashes. Device revocation is checked on each extension request. Settings lists connected devices.

## 13. Chrome Extension

Manifest V3 extension pairs with the app, stores its device token in `chrome.storage.local`, requests jobs through the service worker, opens Facebook Groups, copies/prepares captions, previews attached media, and reports posted/skipped/failed outcomes. Users can explicitly start automatic posting for one to three selected groups; the extension attaches images, respects the schedule and clicks Post once. Both server and runner enforce the three-group bound. Submissions are reserved before clicking and only a new recognizable publication confirmation records automatic success. Unknown or approval outcomes pause for review. A single source manifest includes the alarms permission. The extension never exports cookies.

## 14. Facebook Adapter

Composer population is opt-in and best-effort. Login/checkpoint pages show the requested verification message when detected. Facebook DOM selectors may change; caption copy remains available.

## 15. Netlify Blobs

Production uploads use `@netlify/blobs`; local development falls back to workspace-local files. Relational records remain in PostgreSQL.

## 16. Netlify Deployment

`netlify.toml` uses Netlify's automatic current Next.js/OpenNext support, `.next` output, and security headers. No Netlify site was linked or deployed because the workspace has no Netlify credentials/site configuration.

## 17. Security Review

Automatic posting requires the user's explicit Start action and is bounded to three selected groups. No Facebook credential collection, session import, cookie access, CAPTCHA bypass or fingerprint evasion is present. Passwords use scrypt; device and reset tokens are hashed; browser mutations validate Origin; sensitive routes are rate-limited; media validates MIME signatures, extension, size and workspace ownership; and production dependency audit reports zero known vulnerabilities.

## 18. Tests

- `npm run typecheck` and `npm run lint` passed.
- `npm run test` passed: 47 tests across security, queue, database and extension behavior.
- `npm run test:acceptance` passed: 19 Playwright tests, including a live Neon workflow, real Chromium extension session, and isolated migration/seed checks.
- Application and extension production builds passed.
- `npm audit` reports zero known vulnerabilities.

See [verification report](docs/verification.md) for coverage and remaining deployed/manual checks. Real Facebook posting and production Resend delivery are not automated.
## 19. Commands and Environment Variables

The README documents development, build, lint, typecheck, test, migration, seed, and extension commands. `.env.example` lists database, session, app URL, pairing/device/claim TTL, upload, and Resend settings. Google/Facebook OAuth variables are omitted because OAuth providers are not implemented.

## 20. Known Limitations and Future Improvements

Optional Google/Facebook OAuth, team invitations, profile avatar upload and workspace pacing defaults remain absent. Individual queue-page actions are limited. The UI does not use shadcn/ui. Live Neon acceptance tests pass, but deployed Netlify storage, HTTPS sessions and actual reset email delivery require a configured site. Custom extension domains require adding the exact hostname to manifest host permissions before building; broad host access is intentionally not requested.





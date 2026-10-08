# Groupflow

Groupflow is a multi-user Facebook Group posting assistant. It organizes reusable captions, images and campaign queues, then uses a paired Chrome Extension to prepare one Facebook Group post at a time across campaigns without a fixed group-count cap.

The application never asks for Facebook credentials and never stores Facebook passwords, cookies, browser sessions, 2FA codes, or CAPTCHA answers. Campaigns fill due post captions and attach images. By default you click Post directly on Facebook; the explicit Automatically click Post switch enables automatic submission. Confirmed successes automatically advance the queue; approval-required or unknown results pause for review. See [extension setup](docs/extension.md).

## Architecture

- Next.js App Router, TypeScript, React, and Tailwind CSS
- One Vercel project rooted at `.` with Next.js pages and API routes
- Existing Neon PostgreSQL with Drizzle ORM and a small serverless connection pool
- Private Vercel Blob for production images and local-only file storage in development
- Manifest V3 Chrome Extension with all API calls in its service worker

See [architecture](docs/architecture.md), [security](docs/security.md), and [workflow](docs/workflow.md).

## Requirements

- Node.js 24 or later
- npm
- Neon PostgreSQL for app data
- Chrome for loading the unpacked extension

## Installation

```powershell
npm install
Copy-Item .env.example .env.local
```

Set `AUTH_SECRET` to a random value of at least 32 characters. Set `DATABASE_PROVIDER=neon` and `DATABASE_URL` to the existing Neon database (prefer its pooled connection URL). Production image storage requires a private Vercel Blob store and server-only credentials.

## Local development

```powershell
npm run db:migrate
npm run dev
```

Local development stores images in `.local-storage/media`. Database-specific steps are in [docs/database.md](docs/database.md).

## Application features

- Email/password registration and login, with an automatically created personal workspace
- Password reset email flow (development console or production Resend) and profile/password change
- Group creation, editing, search/filter, server-side pagination, pause, bulk disable, delete, and CSV import
- Reusable captions with edit/duplicate actions, optional links, variants, and image upload
- Four-step campaign creation, multi-group selection, and scheduled queue generation
- Dashboard, queue, history, and CSV history export
- One-time device pairing, device revocation, extension-driven queue claims, and image previews
- Workspace-scoped API queries and hashed extension tokens

## Interface language

Use the Language selector at the bottom right of any web page to choose English or Tiếng Việt. The selection persists in a cookie and applies to navigation, forms, status labels and feedback. User captions, group names and other saved content are preserved.

The Chrome Extension has its own language selector at the top of the popup. Its choice persists in `chrome.storage.local`. Reload the unpacked extension after rebuilding to use the new popup.

Campaign schedules determine when jobs become available. With Automatically click Post off, you review and click Post; with it on, the extension clicks only after preparation is verified. Only a reliable publication confirmation advances the queue. Advanced manual controls remain available for recovery.

## Authentication setup

Application passwords are hashed with Node.js scrypt. Session cookies are signed and are HttpOnly, SameSite=Lax, and Secure in production. Passwords must be at least 10 characters and include a number.

Facebook OAuth and Google OAuth are not included in this initial implementation. OAuth for the app would not grant permission to publish to Facebook Groups.

## Database setup

Keep the existing Neon database with `DATABASE_PROVIDER=neon` and `DATABASE_URL`. No new schema migration is required for this hosting migration. Only generate migrations after actual schema changes:

```powershell
npm run db:generate
npm run db:migrate
```

For development sample data, set a development-only `SEED_PASSWORD` (10+ characters) and run `npm run db:seed`. The seed uses `.example.test` accounts and fake Group URLs.

## Chrome Extension setup

```powershell
npm run extension:build
```

Then open `chrome://extensions`, enable Developer mode, choose Load unpacked, and select `extension/dist`. Pair from the web app's Settings page. Enter the exact application HTTPS URL when pairing and approve access to that domain. The popup requests only the selected origin. See [extension setup](docs/extension.md) and [Web Store readiness](docs/chrome-web-store.md).

## Running checks

```powershell
npm run typecheck
npm run lint
npm run test
npm run build
npm run test:acceptance
npm run extension:build
```

Vitest includes disposable in-memory PostgreSQL API regression tests. Playwright runs controlled Facebook DOM fixtures and the actual unpacked extension popup/service worker, including campaigns with more than three groups. Install Chromium with `npx playwright install chromium`. Live database acceptance is optional and requires a verified disposable test database; do not run it against production. See [verification report](docs/verification.md).

## Production deployment

Import this repository into one Vercel Next.js project with Root Directory `.` and Node.js 24. Configure `AUTH_SECRET`, `APP_URL`, `DATABASE_URL` and private Blob credentials. See [Vercel deployment](docs/deployment-vercel.md) for preview, production, migration and rollback steps. The Chrome Extension is installed locally; it is not a Vercel service.

## Known limitations

- This is an initial MVP implementation. It does not yet include optional OAuth, team invitations, profile avatars, or workspace default pacing.
- Auth.js was not adopted; the application uses a small signed-cookie credential session implementation.
- Pairing requires approving the selected application origin; re-pair after moving domains.
- Live Vercel private storage, actual reset email delivery and real Facebook composer behavior require deployed/manual verification. Browser coverage is broad but does not exhaust every filter, pagination and visual interaction.
- Composer selectors can change as Facebook changes its interface. Composer population is best-effort and manual caption copy remains available.






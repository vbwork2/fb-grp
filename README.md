# Groupflow

Groupflow is a multi-user Facebook Group posting assistant. It organizes reusable captions, images and campaign queues, then uses a paired Chrome Extension to open one Facebook Group at a time. Users can publish manually or explicitly start an automatic run for up to three selected groups.

The application never asks for Facebook credentials and never stores Facebook passwords, cookies, browser sessions, 2FA codes, or CAPTCHA answers. Automatic runs attach images and submit due posts after the user clicks Start automatic posting. Runs stop on errors or uncertain outcomes; only a recognizable publication confirmation records automatic success. See [extension setup](docs/extension.md).

## Architecture

- Next.js App Router, TypeScript, React, and Tailwind CSS
- Netlify hosting through its current OpenNext adapter
- PostgreSQL with Drizzle ORM; Netlify Database or Neon through one connection configuration
- Netlify Blobs for production images and local-only file storage in development
- Manifest V3 Chrome Extension with all API calls in its service worker

See [architecture](docs/architecture.md), [security](docs/security.md), and [workflow](docs/workflow.md).

## Requirements

- Node.js 24 or later
- npm
- PostgreSQL for app data (Netlify Database or Neon)
- Chrome for loading the unpacked extension

## Installation

```powershell
npm install
Copy-Item .env.example .env.local
```

Set `AUTH_SECRET` to a random value of at least 32 characters. Set `DATABASE_URL` for local PostgreSQL or `NETLIFY_DB_URL` when using Netlify Database. For local direct development, set `DATABASE_PROVIDER=neon` and `DATABASE_URL`.

## Local development

```powershell
npm run db:migrate
npm run dev
```

For a Netlify-like local runtime, link the site, initialize its database, then use `netlify dev`. Database-specific steps are in [docs/database.md](docs/database.md).

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

Campaign schedules determine when jobs become available. The extension opens groups and can prepare captions; the user reviews, clicks Publish to Facebook in the extension or publishes directly on Facebook, and then verifies the result before confirming history.

## Authentication setup

Application passwords are hashed with Node.js scrypt. Session cookies are signed and are HttpOnly, SameSite=Lax, and Secure in production. Passwords must be at least 10 characters and include a number.

Facebook OAuth and Google OAuth are not included in this initial implementation. OAuth for the app would not grant permission to publish to Facebook Groups.

## Database setup

Configure either Netlify Database or Neon with `DATABASE_PROVIDER` and the corresponding connection variable. Generate and apply schema migrations with:

```powershell
npm run db:generate
npm run db:migrate
```

For development sample data, set a development-only `SEED_PASSWORD` (10+ characters) and run `npm run db:seed`. The seed uses `.example.test` accounts and fake Group URLs.

## Chrome Extension setup

```powershell
npm run extension:build
```

Then open `chrome://extensions`, enable Developer mode, choose Load unpacked, and select `extension/dist`. Pair from the web app's Settings page. Custom app domains require their exact hostname to be added to `extension/manifest.json` before building. See [extension setup](docs/extension.md) and [Web Store readiness](docs/chrome-web-store.md).

## Running checks

```powershell
npm run typecheck
npm run lint
npm run test
npm run build
npm run test:acceptance
npm run extension:build
```

Vitest runs 47 security, queue, database and extension tests. With `.env.local` configured and `npm run dev` running in another terminal, `npm run test:acceptance` builds the extension and runs 19 Playwright checks, including real Neon API workflows, concurrent device claims, a Chromium extension session, and isolated migrations/seed. Tests create temporary data and clean it afterward. Install Chromium first with `npx playwright install chromium` if needed. Default `npm run test:e2e` runs public/adapter checks and skips live database checks. See [verification report](docs/verification.md).

## Production deployment

Connect the GitHub repository to Netlify. Netlify automatically provisions the supported Next.js runtime. Configure `AUTH_SECRET`, `APP_URL`, and either Netlify Database or Neon variables. See [deployment](docs/deployment.md) for the step-by-step setup.

## Known limitations

- This is an initial MVP implementation. It does not yet include optional OAuth, team invitations, profile avatars, or workspace default pacing.
- Auth.js was not adopted; the application uses a small signed-cookie credential session implementation.
- Custom-domain extension host permission must be explicitly added to the manifest before building.
- Netlify runtime storage, actual reset email delivery and real Facebook composer behavior require deployed/manual verification. Browser coverage is broad but does not exhaust every filter, pagination and visual interaction.
- Composer selectors can change as Facebook changes its interface. Composer population is best-effort and manual caption copy remains available.






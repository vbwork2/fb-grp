# Netlify deployment

## Current readiness

The application and extension can be deployed for a preview. Automated checks exercise Neon and local development; they do not certify a deployed Netlify runtime. Complete the deployed checks below before using real campaigns.

## Deploy with the existing Neon database

1. Push the project to a private GitHub repository. Keep `.env.local` and generated files out of Git.
2. In Netlify, add a project from that GitHub repository. Build command: `npm run build`. Publish directory: `.next`. Node.js: 24, configured in `.nvmrc` and `netlify.toml`. Netlify automatically provides the current Next.js/OpenNext adapter.
3. Add the variables below in Netlify's environment settings. Copy values from your local configuration privately; never commit or upload `.env.local`.
4. Set `APP_URL` to the actual HTTPS Netlify site URL. Keep the production environment; do not set `NODE_ENV=development`.
5. Apply `npm run db:migrate` against the selected database before serving traffic. The current local Neon database has already been migrated; repeat this for a new database. Runtime and migrations use the same connection selection.
6. Deploy. Netlify Blobs requires the Netlify runtime, so local uploads do not prove production image storage works.
7. Build with `npm run extension:build`, then load `extension/dist` in Chrome. The manifest supports `*.netlify.app`. Add an exact custom hostname to `extension/manifest.json` before building for a custom domain.

| Variable | Value / purpose |
| --- | --- |
| `AUTH_SECRET` | Random secret of at least 32 characters; use a separate production secret |
| `APP_URL` | Actual HTTPS site URL |
| `DATABASE_PROVIDER` | `neon` for the existing database |
| `DATABASE_URL` | Neon PostgreSQL connection string |
| `MAX_UPLOAD_SIZE_MB` | `4`; production enforces a maximum of 4 MB |
| `RESEND_API_KEY` | Required for production password reset email |
| `RESEND_FROM_EMAIL` | Verified Resend sender address |
| `PAIRING_CODE_TTL_SECONDS` | Optional; default 300 |
| `DEVICE_TOKEN_TTL_DAYS` | Optional; default 90 |

For Netlify Database instead, initialize it on the site, set `DATABASE_PROVIDER=netlify`, and use the injected `NETLIFY_DB_URL`. Do not mix database targets when applying migrations.

## Deployed checks

- Register and log in over HTTPS; log out and verify protected pages require login.
- Upload a JPG, PNG, or WebP smaller than 4 MB, reload it, and confirm another account cannot access it.
- Request a reset email, follow the delivered link, and verify it only works once.
- Pair the extension with the deployed site, create a small campaign, and request its first job.
- Verify the group opens, caption copy works, optional preparation works where supported, and posted/skipped/failed outcomes update the app.
- Revoke the device and verify it cannot fetch another job.

The user can publish manually or explicitly start automatic posting for at most three selected groups. Reload the extension after updating its alarms permission. Facebook's current composer, image upload and confirmation notices need a controlled manual check on the deployed app; actual email delivery also requires this check.

References: [Netlify Next.js support](https://docs.netlify.com/build/frameworks/framework-setup-guides/nextjs/overview/), [function payload limits](https://docs.netlify.com/build/functions/configuration/), [Netlify Blobs](https://docs.netlify.com/build/data-and-storage/netlify-blobs/).


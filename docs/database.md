# Neon database

Keep the existing Neon PostgreSQL database and all data. Set DATABASE_PROVIDER=neon and DATABASE_URL to its pooled PostgreSQL URL (hostname contains -pooler; retain sslmode=require). Production fails if DATABASE_URL is missing or another provider is configured.

Drizzle uses postgres-js with max=3, idle_timeout=20, connect_timeout=10 and prepare=false per Function instance. Transactions and row locks used by queue claims remain supported. Never put database credentials in client variables.

The schema remains in src/lib/db/schema.ts. Existing migrations remain under netlify/database/migrations/ to preserve their history; that path does not require a Netlify service. No schema change is needed for Vercel. Do not run reset, push or seed against production.

After actual schema edits, review npm run db:generate output. Apply npm run db:migrate only to the intended database after reviewing pending migrations and taking a backup. A previously migrated Neon database does not need reinitialization for a hosting move.

For isolated development data, use a separate database and a development-only SEED_PASSWORD with npm run db:seed. Preview environments should use a disposable Neon branch rather than production data.

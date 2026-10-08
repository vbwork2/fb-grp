# Database

Netlify Database is the preferred production target. The schema is defined in `src/lib/db/schema.ts`; Drizzle migrations are generated under `netlify/database/migrations/`. The app adapter reads `NETLIFY_DB_URL` in Netlify Database environments.

For Neon, set `DATABASE_PROVIDER=neon` and `DATABASE_URL` to a PostgreSQL connection string. Business queries use the same Drizzle schema and adapter module.

Use `npm run db:generate` after schema edits and `npm run db:migrate` for a configured PostgreSQL connection. Netlify's current database workflow also supports applying migrations during deploy; review the generated migration before deployment. For local Netlify Database, run `netlify dev` after linking the site and initializing its database.

Seed sample data with `SEED_PASSWORD` set to a development-only value, then run `npm run db:seed`. The seed uses only `.example.test` accounts and fake Facebook Group URLs.

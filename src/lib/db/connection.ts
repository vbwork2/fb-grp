export function databaseConnectionString(environment: Record<string, string | undefined> = process.env): string {
  const url = environment.DATABASE_PROVIDER === "netlify"
    ? environment.NETLIFY_DB_URL ?? environment.DATABASE_URL
    : environment.DATABASE_URL;
  return url ?? "postgres://postgres:postgres@localhost:5432/fb_group";
}

export function databaseConnectionString(environment: Record<string, string | undefined> = process.env): string {
  if (environment.DATABASE_PROVIDER && environment.DATABASE_PROVIDER !== "neon") {
    throw new Error("DATABASE_PROVIDER must be neon. Set DATABASE_URL to the existing Neon database.");
  }
  if (environment.DATABASE_URL) return environment.DATABASE_URL;
  if (environment.NODE_ENV === "production") throw new Error("DATABASE_URL is required in production.");
  return "postgres://postgres:postgres@localhost:5432/fb_group";
}

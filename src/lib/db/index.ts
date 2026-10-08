import "server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { databaseConnectionString } from "./connection";

// Reuse a small pool per Function instance. Neon pooled URLs handle concurrency.
const client = postgres(databaseConnectionString(), {
  max: 3, idle_timeout: 20, connect_timeout: 10, prepare: false,
});
export const db = drizzle({ client });
export type Database = typeof db;

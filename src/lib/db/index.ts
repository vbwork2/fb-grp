import "server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import { databaseConnectionString } from "./connection";

export const db = drizzle(databaseConnectionString());
export type Database = typeof db;

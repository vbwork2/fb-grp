import dotenv from "dotenv";
import { defineConfig } from "drizzle-kit";
import { databaseConnectionString } from "./src/lib/db/connection";

dotenv.config({ path: ".env.local" });
dotenv.config();

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/lib/db/schema.ts",
  out: "netlify/database/migrations",
  dbCredentials: { url: databaseConnectionString() },
});

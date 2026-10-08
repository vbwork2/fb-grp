import { randomUUID, randomBytes } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import dotenv from "dotenv";
import postgres from "postgres";
import { test, expect } from "@playwright/test";
import { databaseConnectionString } from "../src/lib/db/connection";

dotenv.config({ path: ".env.local", quiet: true });
test.skip(process.env.LIVE_API_TESTS !== "1", "Enable live acceptance tests explicitly.");

test("PostgreSQL migrations and seed run correctly in an isolated disposable schema", async () => {
  test.setTimeout(90_000);
  const schema = `acceptance_seed_${randomUUID().replaceAll("-", "")}`;
  const sql = postgres(databaseConnectionString(), { max: 1, onnotice: () => {} });
  try {
    await sql`create schema ${sql(schema)}`;
    await sql.begin(async (tx) => {
      await tx.unsafe(`set local search_path to "${schema}"`);
      const migrationRoot = resolve("netlify/database/migrations");
      const directories = (await readdir(migrationRoot, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
      for (const directory of directories) {
        const migration = await readFile(resolve(migrationRoot, directory, "migration.sql"), "utf8");
        for (const statement of migration.split("--> statement-breakpoint").filter((value) => value.trim())) await tx.unsafe(statement);
      }
    });
    const password = `Seed-${randomBytes(16).toString("hex")}9`;
    for (let run = 0; run < 2; run++) {
      const child = spawnSync(process.execPath, [resolve("node_modules/tsx/dist/cli.mjs"), "scripts/seed.ts"], { env: { ...process.env, SEED_SCHEMA: schema, SEED_PASSWORD: password, NODE_ENV: "development" }, encoding: "utf8", timeout: 30_000 });
      expect(child.error).toBeUndefined();
      expect(child.status, "The seed process must exit successfully").toBe(0);
      const [counts] = await sql.unsafe(`select (select count(*)::int from "${schema}".users) as users, (select count(*)::int from "${schema}".workspaces) as workspaces, (select count(*)::int from "${schema}".groups) as groups, (select count(*)::int from "${schema}".contents) as contents, (select count(*)::int from "${schema}".campaigns) as campaigns`);
      expect(counts).toEqual({ users: 2, workspaces: 2, groups: 20, contents: 5, campaigns: 3 });
    }
  } finally {
    await sql`drop schema if exists ${sql(schema)} cascade`;
    await sql.end();
  }
});


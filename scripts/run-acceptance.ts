import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local", quiet: true });
if (!process.env.DATABASE_URL && !process.env.NETLIFY_DB_URL) throw new Error("Configure .env.local before running live acceptance tests.");
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error("Run this script with npm run test:acceptance.");
const build = spawnSync(process.execPath, [npmCli, "run", "extension:build"], { stdio: "inherit" });
if (build.error) throw build.error;
if (build.status !== 0) process.exit(build.status ?? 1);
const tests = spawnSync(process.execPath, [resolve("node_modules/@playwright/test/cli.js"), "test", "--workers=1"], { stdio: "inherit", env: { ...process.env, LIVE_API_TESTS: "1" } });
if (tests.error) throw tests.error;
process.exit(tests.status ?? 1);

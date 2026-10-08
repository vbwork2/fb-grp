import { randomBytes, randomUUID } from "node:crypto";
import dotenv from "dotenv";
import postgres from "postgres";
import { test, expect, request as apiRequest } from "@playwright/test";
import { databaseConnectionString } from "../src/lib/db/connection";

dotenv.config({ path: ".env.local", quiet: true });
test.skip(process.env.LIVE_API_TESTS !== "1", "Enable live database tests explicitly.");

test("browser login works after an anonymous redirect and after logout in both languages", async ({ page }) => {
  test.setTimeout(90_000);
  const runId = randomUUID();
  const email = `acceptance-login-${runId}@example.test`;
  const password = `Login-${randomBytes(16).toString("hex")}9`;
  const baseURL = "http://127.0.0.1:3000";
  const actor = await apiRequest.newContext({ baseURL, extraHTTPHeaders: { origin: baseURL, "x-nf-client-connection-ip": `acceptance-login-${runId}` } });
  const sql = postgres(databaseConnectionString(), { max: 1 });
  try {
    expect((await actor.post("/api/auth/register", { data: { email, password, displayName: "Browser login test" } })).status()).toBe(201);
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login$/);
    for (const locale of ["vi", "en"]) {
      await page.locator("#app-language").selectOption(locale);
      await page.locator("#email").fill(email);
      await page.locator("#password").fill(password);
      const response = page.waitForResponse((item) => item.url().endsWith("/api/auth/login") && item.request().method() === "POST");
      await page.locator("form button[type=submit], form button.primary").click();
      expect((await response).status()).toBe(200);
      await expect(page).toHaveURL(/\/dashboard$/);
      await expect(page.locator("main h1")).toHaveText(locale === "vi" ? "Tổng quan" : "Dashboard");
      expect((await page.request.get("/api/auth/me")).status()).toBe(200);
      await page.getByRole("button", { name: locale === "vi" ? "Đăng xuất" : "Sign out", exact: true }).click();
      await expect(page).toHaveURL(/\/login$/);
      expect((await page.request.get("/api/auth/me")).status()).toBe(401);
    }
  } finally {
    await sql.begin(async (tx) => {
      const [user] = await tx`select id from users where email=${email}`;
      if (user) {
        await tx`delete from audit_logs where user_id=${user.id}`;
        await tx`delete from workspaces where owner_id=${user.id}`;
        await tx`delete from users where id=${user.id}`;
      }
      await tx`delete from rate_limits where key like ${`%${email}%`} or key like ${`%acceptance-login-${runId}%`}`;
    });
    await sql.end();
    await actor.dispose();
  }
});

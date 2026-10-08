import { randomBytes, randomUUID, createHash } from "node:crypto";
import { unlink } from "node:fs/promises";
import { resolve } from "node:path";
import dotenv from "dotenv";
import postgres from "postgres";
import { test, expect, chromium, request as apiRequest, type APIRequestContext, type APIResponse } from "@playwright/test";
import { databaseConnectionString } from "../src/lib/db/connection";

dotenv.config({ path: ".env.local", quiet: true });
declare const chrome: {
  storage: { local: { get: (key: string) => Promise<Record<string, unknown>>; set: (values: Record<string, unknown>) => Promise<void> } };
  alarms: { create: (name: string, options: { when: number }) => Promise<void> };
  tabs: { query: (query: { url: string }) => Promise<Array<{ id?: number }>>; update: (id: number, changes: { active: boolean }) => Promise<unknown> };
  runtime: { sendMessage: (message: { type: string }) => Promise<{ ok: boolean }> };
};
const enabled = process.env.LIVE_API_TESTS === "1";
test.skip(!enabled, "Set LIVE_API_TESTS=1 to test the configured database with temporary accounts.");

test("authenticated workflows, tenant isolation, device claims, and password reset", async ({ page }) => {
  test.setTimeout(300_000);
  const runId = randomUUID();
  const baseURL = "http://127.0.0.1:3000";
  const password = `Test-${randomBytes(12).toString("hex")}9`;
  const emailA = `acceptance-a-${runId}@example.test`;
  const emailB = `acceptance-b-${runId}@example.test`;
  const sql = postgres(databaseConnectionString(), { max: 2 });
  const actorA = await apiRequest.newContext({ baseURL, extraHTTPHeaders: { origin: baseURL, "x-nf-client-connection-ip": `acceptance-${runId}` } });
  const actorB = await apiRequest.newContext({ baseURL, extraHTTPHeaders: { origin: baseURL, "x-nf-client-connection-ip": `acceptance-b-${runId}` } });
  const guest = await apiRequest.newContext({ baseURL, extraHTTPHeaders: { origin: baseURL, "x-nf-client-connection-ip": `acceptance-${runId}` } });
  let userId = ""; let workspaceId = ""; let contentId = ""; let campaignId = ""; let mediaId = "";
  const groupIds: string[] = [];
  const devices: Array<{ deviceId: string; deviceToken: string }> = [];
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1sAAAAASUVORK5CYII=", "base64");

  async function data(response: APIResponse, status = 200) {
    const text = await response.text();
    expect(response.status(), `HTTP status for ${new URL(response.url()).pathname}`).toBe(status);
    expect(response.headers()["content-type"]).toContain("application/json");
    const result = JSON.parse(text);
    expect(result.error).toBeNull();
    return result.data;
  }
  async function pair(actor: APIRequestContext, name: string) {
    const code = await data(await actor.post("/api/devices/pairing-code", { data: {} }));
    const paired = await data(await guest.post("/api/extension/pair", { data: { code: code.code, name } }), 201);
    return { code: code.code, ...paired };
  }
  function bearer(token: string) { return { authorization: `Bearer ${token}` }; }
  async function next(token: string) { return (await data(await guest.get("/api/extension/jobs/next", { headers: bearer(token) }))).job; }

  try {
    await test.step("registration, personal workspace, duplicate email, login, and protected routes", async () => {
      expect((await guest.get("/api/groups")).status()).toBe(401);
      const user = await data(await actorA.post("/api/auth/register", { data: { email: emailA, password, displayName: "Acceptance User A" } }), 201);
      userId = user.id; workspaceId = user.workspaceId;
      expect(workspaceId).toBeTruthy();
      await data(await actorB.post("/api/auth/register", { data: { email: emailB, password, displayName: "Acceptance User B" } }), 201);
      expect((await guest.post("/api/auth/register", { data: { email: emailA, password, displayName: "Duplicate" } })).status()).toBe(409);
      expect((await guest.post("/api/auth/login", { data: { email: emailA, password: "Wrong-password-9" } })).status()).toBe(401);
      await data(await actorA.post("/api/auth/logout", { data: {} }));
      expect((await actorA.get("/api/auth/me")).status()).toBe(401);
      await data(await actorA.post("/api/auth/login", { data: { email: emailA, password } }));
      expect((await data(await actorA.get("/api/auth/me"))).workspaceId).toBe(workspaceId);
    });
    await test.step("group CRUD, URL validation, duplicate detection, and CSV import", async () => {
      for (let i = 0; i < 3; i++) {
        const group = await data(await actorA.post("/api/groups", { data: { name: `Acceptance group ${i}`, facebookUrl: `https://www.facebook.com/groups/test-${runId}-${i}/`, category: "Acceptance" } }), 201);
        groupIds.push(group.id);
      }
      expect((await actorA.post("/api/groups", { data: { name: "Bad", facebookUrl: "https://example.com/not-facebook" } })).status()).toBe(400);
      expect((await actorA.post("/api/groups", { data: { name: "Duplicate", facebookUrl: `https://www.facebook.com/groups/test-${runId}-0/` } })).status()).toBe(409);
      await data(await actorA.patch(`/api/groups/${groupIds[0]}`, { data: { name: "Edited group", status: "PAUSED" } }));
      await data(await actorA.patch(`/api/groups/${groupIds[0]}`, { data: { status: "ACTIVE" } }));
      const imported = await data(await actorA.post("/api/groups/import", { multipart: { file: { name: "groups.csv", mimeType: "text/csv", buffer: Buffer.from(`name,url,category\nDuplicate,https://www.facebook.com/groups/test-${runId}-0/,Acceptance\nNew,https://www.facebook.com/groups/test-${runId}-csv/,Acceptance\nInvalid,https://example.com/no,Acceptance`) } } }));
      expect(imported).toMatchObject({ total: 3, imported: 1, duplicate: 1, invalid: 1 });
      await data(await actorA.delete(`/api/groups/${imported.items[0].id}`));
    });
    await test.step("content CRUD, variants, upload and invalid image rejection", async () => {
      expect((await actorA.post("/api/content", { data: { name: "Unsafe link", body: "Caption", linkUrl: "javascript:alert(1)" } })).status()).toBe(400);
      const content = await data(await actorA.post("/api/content", { data: { name: "Acceptance content", body: "Caption for manual review", linkUrl: "https://example.test/" } }), 201);
      contentId = content.id;
      await data(await actorA.patch(`/api/content/${contentId}`, { data: { name: "Edited content", body: "Updated caption for manual review", linkUrl: "https://example.test/" } }));
      const variant = await data(await actorA.post(`/api/content/${contentId}/variants`, { data: { name: "Variant A", body: "Variant caption" } }), 201);
      await data(await actorA.patch(`/api/content/${contentId}/variants/${variant.id}`, { data: { name: "Edited variant", body: "Updated variant caption" } }));
      expect((await data(await actorA.get(`/api/content/${contentId}/variants`))).length).toBe(1);
      const copy = await data(await actorA.post("/api/content", { data: { name: "Content copy", body: content.body } }), 201);
      await data(await actorA.delete(`/api/content/${copy.id}`));
      const media = await data(await actorA.post("/api/media", { multipart: { contentId, file: { name: "pixel.png", mimeType: "image/png", buffer: png } } }), 201);
      mediaId = media.id;
      expect((await actorA.get(`/api/media/${mediaId}`)).status()).toBe(200);
      expect((await actorA.post("/api/media", { multipart: { contentId, file: { name: "fake.png", mimeType: "image/png", buffer: Buffer.from("not an image") } } })).status()).toBe(400);
    });
    await test.step("campaign creation, scheduling, pause, resume, and authenticated browser pages", async () => {
      const campaign = await data(await actorA.post("/api/campaigns", { data: { name: "Acceptance campaign", contentId, groupIds, minIntervalSeconds: 60, maxIntervalSeconds: 60, variantStrategy: "ROUND_ROBIN" } }), 201);
      campaignId = campaign.id;
      expect((await actorA.delete(`/api/content/${contentId}`)).status()).toBe(409);
      expect((await data(await actorA.post(`/api/campaigns/${campaignId}/start`, { data: {} }))).queued).toBe(3);
      const scheduled = await sql`select scheduled_at from queue_items where campaign_id=${campaignId} order by position`;
      expect(new Date(scheduled[1].scheduled_at).getTime() - new Date(scheduled[0].scheduled_at).getTime()).toBe(60000);
      await data(await actorA.patch(`/api/campaigns/${campaignId}`, { data: { status: "PAUSED" } }));
      await data(await actorA.patch(`/api/campaigns/${campaignId}`, { data: { status: "RUNNING" } }));
      await page.context().addCookies((await actorA.storageState()).cookies);
      for (const path of ["/dashboard", "/groups", "/content", "/campaigns", `/campaigns/${campaignId}`, "/queue", "/history", "/settings"]) {
        const response = await page.goto(path);
        expect(response?.status(), path).toBe(200);
        await expect(page.locator("main h1")).toBeVisible();
      }
      await page.locator("#app-language").selectOption("vi");
      await expect(page.getByRole("heading", { name: "Cài đặt", exact: true })).toBeVisible();
      await page.goto("/groups");
      await expect(page.getByRole("heading", { name: "Nhóm", exact: true })).toBeVisible();
      await expect(page.getByText("Edited group", { exact: true })).toBeVisible();
      await expect(page.locator("select[name=status] option[value=ACTIVE]")).toHaveText("Đang hoạt động");
      await page.goto("/content");
      await expect(page.getByText("Updated caption for manual review", { exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Lưu nội dung", exact: true })).toBeVisible();
      await page.goto("/queue");
      await expect(page.locator("select[name=status] option[value=PENDING]")).toHaveText("Đang chờ");
      await page.locator("select[name=status]").selectOption("PENDING");
      await page.getByRole("button", { name: "Lọc", exact: true }).click();
      await expect(page).toHaveURL(/status=PENDING/);
      await page.locator("#app-language").selectOption("en");
      await page.goto("/campaigns");
      await page.locator("#wizardCampaignName").fill("Browser wizard acceptance");
      await page.getByRole("button", { name: "Continue", exact: true }).click();
      await page.getByRole("button", { name: "Select all shown" }).click();
      await page.getByRole("button", { name: "Continue", exact: true }).click();
      await page.locator("#wizardMin").fill("60"); await page.locator("#wizardMax").fill("60");
      await page.getByRole("button", { name: "Continue", exact: true }).click();
      await page.getByRole("button", { name: "Create campaign", exact: true }).click();
      await expect(page.getByRole("status")).toContainText("Campaign created.");
      const list = await data(await actorA.get("/api/campaigns"));
      const wizard = list.find((entry: { campaign: { name: string } }) => entry.campaign.name === "Browser wizard acceptance");
      await data(await actorA.patch(`/api/campaigns/${wizard.campaign.id}`, { data: { status: "CANCELLED" } }));
      expect((await actorA.post(`/api/campaigns/${wizard.campaign.id}/start`, { data: {} })).status()).toBe(409);
    });
    await test.step("tenant isolation through actual APIs and CSRF checks", async () => {
      expect((await data(await actorB.get("/api/groups"))).items.length).toBe(0);
      expect((await actorB.patch(`/api/groups/${groupIds[0]}`, { data: { status: "DISABLED", workspaceId } })).status()).toBe(404);
      expect((await actorB.delete(`/api/groups/${groupIds[0]}`)).status()).toBe(404);
      expect((await actorB.patch(`/api/content/${contentId}`, { data: { name: "Attempt", body: "Attempt", workspaceId } })).status()).toBe(404);
      expect((await actorB.post(`/api/campaigns/${campaignId}/start`, { data: {} })).status()).toBe(404);
      expect((await actorB.get(`/api/media/${mediaId}`)).status()).toBe(404);
      expect((await actorA.post("/api/groups", { headers: { origin: "https://malicious.example" }, data: { name: "Invalid", facebookUrl: "https://www.facebook.com/groups/invalid/" } })).status()).toBe(403);
    });
    await test.step("pairing, token auth, concurrent claims, stale claim, outcomes, retry, and revocation", async () => {
      const expired = await data(await actorA.post("/api/devices/pairing-code", { data: {} }));
      await sql`update pairing_codes set expires_at=now()-interval '1 minute' where user_id=${userId} and code_hash=${createHash("sha256").update(expired.code).digest("hex")}`;
      expect((await guest.post("/api/extension/pair", { data: { code: expired.code } })).status()).toBe(401);
      const first = await pair(actorA, "Acceptance device 1"); const second = await pair(actorA, "Acceptance device 2");
      devices.push(first, second);
      expect((await guest.post("/api/extension/pair", { data: { code: first.code } })).status()).toBe(401);
      expect((await guest.get("/api/extension/jobs/next", { headers: bearer("invalid-token".repeat(4)) })).status()).toBe(401);
      const other = await pair(actorB, "Other workspace");
      expect(await next(other.deviceToken)).toBeNull();
      expect((await guest.post("/api/extension/campaigns", { headers: bearer(other.deviceToken), data: { campaignId } })).status()).toBe(404);
      await data(await actorA.patch(`/api/campaigns/${campaignId}`, { data: { status: "PAUSED" } }));
      expect(await next(first.deviceToken)).toBeNull();
      await data(await actorA.patch(`/api/campaigns/${campaignId}`, { data: { status: "RUNNING" } }));
      await sql`update queue_items set scheduled_at=now()+interval '1 hour' where campaign_id=${campaignId}`;
      expect(await next(first.deviceToken)).toBeNull();
      await sql`update queue_items set scheduled_at=now()-interval '1 minute' where campaign_id=${campaignId}`;
      const [jobA, jobB] = await Promise.all([next(first.deviceToken), next(second.deviceToken)]);
      expect(jobA).not.toBeNull(); expect(jobB).not.toBeNull(); expect(jobA.id).not.toBe(jobB.id);
      expect(jobA.content.caption).toBe("Updated variant caption");
      expect((await data(await guest.post(`/api/extension/jobs/${jobA.id}/validate`, { headers: bearer(first.deviceToken), data: { claimToken: jobA.claimToken } }))).allowed).toBe(true);
      expect((await guest.post(`/api/extension/jobs/${jobA.id}/validate`, { headers: bearer(other.deviceToken), data: { claimToken: jobA.claimToken } })).status()).toBe(409);
      await data(await actorA.patch(`/api/campaigns/${campaignId}`, { data: { status: "PAUSED" } }));
      expect((await guest.post(`/api/extension/jobs/${jobA.id}/validate`, { headers: bearer(first.deviceToken), data: { claimToken: jobA.claimToken } })).status()).toBe(409);
      await data(await actorA.patch(`/api/campaigns/${campaignId}`, { data: { status: "RUNNING" } }));
      const jobC = await next(first.deviceToken); expect(jobC).not.toBeNull();
      expect((await guest.post(`/api/extension/jobs/${jobA.id}/submission`, { headers: bearer(other.deviceToken), data: { claimToken: jobA.claimToken, action: "begin", automatic: true } })).status()).toBe(409);
      await data(await guest.post(`/api/extension/jobs/${jobA.id}/submission`, { headers: bearer(first.deviceToken), data: { claimToken: jobA.claimToken, action: "begin", automatic: true } }));
      expect((await guest.post(`/api/extension/jobs/${jobA.id}/submission`, { headers: bearer(first.deviceToken), data: { claimToken: jobA.claimToken, action: "begin", automatic: true } })).status()).toBe(409);
      await sql`update queue_items set claimed_at=now()-interval '2 hours' where id=${jobA.id} and workspace_id=${workspaceId}`;
      expect(await next(second.deviceToken)).toBeNull();
      expect((await sql`select status from queue_items where id=${jobA.id}`)[0].status).toBe("AWAITING_CONFIRMATION");
      await data(await guest.post(`/api/extension/jobs/${jobB.id}/submission`, { headers: bearer(second.deviceToken), data: { claimToken: jobB.claimToken, action: "begin", automatic: true } }));
      await data(await guest.post(`/api/extension/jobs/${jobB.id}/submission`, { headers: bearer(second.deviceToken), data: { claimToken: jobB.claimToken, action: "release" } }));
      expect((await sql`select status from queue_items where id=${jobB.id}`)[0].status).toBe("OPENED");
      expect((await guest.get(`/api/extension/media/${mediaId}`, { headers: bearer(first.deviceToken) })).status()).toBe(200);
      expect((await guest.get(`/api/extension/media/${mediaId}`, { headers: bearer(other.deviceToken) })).status()).toBe(404);
      expect((await guest.post(`/api/extension/jobs/${jobA.id}/posted`, { headers: bearer(other.deviceToken), data: { claimToken: jobA.claimToken } })).status()).toBe(404);
      expect((await guest.post(`/api/extension/jobs/${jobA.id}/posted`, { headers: bearer(first.deviceToken), data: { claimToken: jobA.claimToken, facebookPostUrl: "javascript:alert(1)" } })).status()).toBe(400);
      await data(await guest.post(`/api/extension/jobs/${jobA.id}/posted`, { headers: bearer(first.deviceToken), data: { claimToken: jobA.claimToken } }));
      const [current] = await sql`select status from campaigns where id=${campaignId}`;
      expect(current.status).toBe("RUNNING");
      await data(await guest.post(`/api/extension/jobs/${jobB.id}/skip`, { headers: bearer(second.deviceToken), data: { claimToken: jobB.claimToken } }));
      await sql`update queue_items set claimed_at=now()-interval '2 hours' where id=${jobC.id} and workspace_id=${workspaceId}`;
      expect((await guest.post(`/api/extension/jobs/${jobC.id}/validate`, { headers: bearer(first.deviceToken), data: { claimToken: jobC.claimToken } })).status()).toBe(409);
      const stale = await next(second.deviceToken); expect(stale.id).toBe(jobC.id); expect(stale.claimToken).not.toBe(jobC.claimToken);
      expect((await guest.post(`/api/extension/jobs/${jobC.id}/posted`, { headers: bearer(first.deviceToken), data: { claimToken: jobC.claimToken } })).status()).toBe(404);
      await data(await guest.post(`/api/extension/jobs/${stale.id}/failed`, { headers: bearer(second.deviceToken), data: { claimToken: stale.claimToken, errorMessage: "Test user-reported issue" } }));
      expect((await data(await actorA.post(`/api/campaigns/${campaignId}/retry`, { data: {} }))).retried).toBe(1);
      const retry = await next(first.deviceToken);
      await data(await guest.post(`/api/extension/jobs/${retry.id}/posted`, { headers: bearer(first.deviceToken), data: { claimToken: retry.claimToken } }));
      const [complete] = await sql`select status from campaigns where id=${campaignId}`; expect(complete.status).toBe("COMPLETED");
      const history = await sql`select status from post_history where workspace_id=${workspaceId}`; expect(history).toHaveLength(4);
      expect((await actorA.get("/api/history/export")).status()).toBe(200);
      await data(await actorA.delete("/api/devices", { data: { id: first.deviceId } }));
      expect((await guest.get("/api/extension/jobs/next", { headers: bearer(first.deviceToken) })).status()).toBe(401);
      await sql`update devices set expires_at=now()-interval '1 minute' where id=${second.deviceId}`;
      expect((await guest.get("/api/extension/jobs/next", { headers: bearer(second.deviceToken) })).status()).toBe(401);
    });
    await test.step("built extension in real Chromium: pairing, storage, job, composer, copy, media, completion and revocation", async () => {
      const campaign = await data(await actorA.post("/api/campaigns", { data: { name: "Extension runtime acceptance", contentId, groupIds: [groupIds[0]], minIntervalSeconds: 60, maxIntervalSeconds: 60 } }), 201);
      await data(await actorA.post(`/api/campaigns/${campaign.id}/start`, { data: {} }));
      const code = await data(await actorA.post("/api/devices/pairing-code", { data: {} }));
      const extensionPath = resolve("extension/dist");
      const browser = await chromium.launchPersistentContext("", { channel: "chromium", headless: true, args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`, "--host-resolver-rules=MAP www.facebook.com 127.0.0.1, MAP m.facebook.com 127.0.0.1"] });
      try {
        await browser.route("https://www.facebook.com/**", (route) => route.fulfill({ contentType: "text/html", body: '<div role="dialog"><div role="textbox" contenteditable="true"></div><button id="post">Post</button></div>' }));
        const worker = browser.serviceWorkers()[0] ?? await browser.waitForEvent("serviceworker");
        const extensionId = new URL(worker.url()).hostname;
        const popup = await browser.newPage();
        await popup.goto(`chrome-extension://${extensionId}/src/popup/index.html`);
        await popup.locator("#apiUrl").fill("http://localhost:3000");
        await popup.locator("#code").fill(code.code);
        await popup.locator("#pair").click();
        await popup.locator("#language").selectOption("en");
        await popup.locator("#manualDetails").evaluate((details: HTMLDetailsElement) => { details.open = true; });
        await expect(popup.locator("#status")).toHaveText("Device connected.");
        expect(await worker.evaluate(async () => Boolean((await chrome.storage.local.get("deviceToken")).deviceToken))).toBe(true);
        const groupPagePromise = browser.waitForEvent("page");
        await popup.locator("#next").click();
        const groupPage = await groupPagePromise;
        // Extension-created tabs can navigate before Playwright attaches its routes.
        await groupPage.route("**/*", (route) => route.fulfill({ contentType: "text/html", body: '<div role="dialog"><div role="textbox" contenteditable="true"></div><button id="post">Post</button></div>' }));
        await groupPage.goto(`https://www.facebook.com/groups/test-${runId}-0/`);
        await expect(groupPage.getByRole("textbox")).toBeVisible();
        await expect(popup.locator("#caption")).toContainText("Updated caption for manual review");
        await popup.locator("#language").selectOption("vi");
        await expect(popup.locator("#posted")).toHaveText("Tôi đã đăng bài");
        await expect(popup.locator("#caption")).toContainText("Updated caption for manual review");
        await popup.reload();
        await popup.locator("#manualDetails").evaluate((details: HTMLDetailsElement) => { details.open = true; });
        await expect(popup.locator("#language")).toHaveValue("vi");
        await expect(popup.locator("#copy")).toHaveText("Sao chép nội dung");
        await expect(popup.locator("#caption")).toContainText("Updated caption for manual review");
        await popup.locator("#language").selectOption("en");
        await worker.evaluate(async () => {
          const tabs = await chrome.tabs.query({ url: "https://www.facebook.com/groups/*" });
          await chrome.tabs.update(tabs[0].id!, { active: true });
        });
        const prepared = await popup.evaluate(() => chrome.runtime.sendMessage({ type: "PREPARE" }));
        expect(prepared.ok).toBe(true);
        await expect(groupPage.getByRole("textbox")).toContainText("Updated caption for manual review");
        await popup.locator("#copy").click();
        await expect(popup.locator("#status")).toHaveText("Caption copied.");
        await popup.getByRole("button", { name: "View pixel.png" }).click();
        await expect(popup.locator("#media img")).toHaveAttribute("src", /^data:image\/png;base64,/);
        await groupPage.evaluate(() => { document.getElementById("post")!.onclick = () => { document.body.dataset.submissions = String(Number(document.body.dataset.submissions ?? 0) + 1); }; });
        await worker.evaluate(async () => {
          const tabs = await chrome.tabs.query({ url: "https://www.facebook.com/groups/*" });
          await chrome.tabs.update(tabs[0].id!, { active: true });
        });
        await popup.locator("#imagesAttached").check();
        await popup.locator("#publish").click();
        await expect(popup.locator("#status")).toHaveText("Publish was sent to Facebook. Check the result, then confirm it in history.");
        await expect(groupPage.locator("body")).toHaveAttribute("data-submissions", "1");
        await expect(popup.locator("#publish")).toBeDisabled();
        const [unconfirmed] = await sql`select status from queue_items where campaign_id=${campaign.id}`;
        expect(unconfirmed.status).toBe("AWAITING_CONFIRMATION");
        await popup.locator("#posted").click();
        await expect(popup.locator("#status")).toHaveText("Post confirmed in history.");
        const [completed] = await sql`select status from campaigns where id=${campaign.id}`;
        expect(completed.status).toBe("COMPLETED");
        const automatic = await data(await actorA.post("/api/campaigns", { data: { name: "Bounded automatic acceptance", contentId, groupIds: groupIds.slice(0, 2), minIntervalSeconds: 60, maxIntervalSeconds: 60 } }), 201);
        const automaticHtml = '<div role="dialog"><div role="textbox" contenteditable="true"></div><input type="file" accept="image/png" multiple><button id="post" disabled>Post</button></div>';
        await groupPage.addInitScript(() => document.addEventListener("DOMContentLoaded", () => {
          const input = document.querySelector<HTMLInputElement>('input[type="file"]');
          const post = document.querySelector<HTMLButtonElement>("#post");
          if (!input || !post) return;
          input.onchange = () => {
            const image = document.createElement("img");
            image.src = URL.createObjectURL(input.files![0]); image.width = 20; image.height = 20;
            input.parentElement!.append(image); post.disabled = false;
          };
          post.onclick = () => {
            const notice = document.createElement("div"); notice.setAttribute("role", "status");
            notice.textContent = "Your post was published."; document.body.append(notice);
          };
        }));
        await groupPage.unroute("**/*");
        await groupPage.route("**/*", (route) => route.fulfill({ contentType: "text/html", body: automaticHtml }));
        await worker.evaluate(async () => {
          const tabs = await chrome.tabs.query({ url: "https://www.facebook.com/groups/*" });
          await chrome.storage.local.set({ automatic: { enabled: false, tabId: tabs[0].id, status: "Automatic posting stopped.", phase: "PAUSED", attempts: 0 } });
        });
        await popup.locator("#autoRefresh").click();
        await popup.locator("#autoCampaign").selectOption(automatic.id);
        await popup.locator("#autoStart").click();
        await expect.poll(async () => {
          const value = (await worker.evaluate(() => chrome.storage.local.get("automatic"))).automatic as { enabled: boolean; error?: string; status?: string };
          return { enabled: value.enabled, error: value.error ?? "", popup: await popup.locator("#status").innerText() };
        }, { timeout: 10_000 }).toEqual({ enabled: true, error: "", popup: "" });
        await expect.poll(async () => {
          const state = (await worker.evaluate(() => chrome.storage.local.get("automatic"))).automatic as { error?: string };
          if (state?.error) throw new Error(`Automatic runner stopped: ${state.error}. Fixture: ${await groupPage.locator("body").innerHTML()}`);
          return Number((await sql`select count(*) as total from queue_items where campaign_id=${automatic.id} and status='POSTED'`)[0].total);
        }, { timeout: 90_000 }).toBe(1);
        await expect(groupPage.getByRole("textbox")).toContainText("Updated caption for manual review");
        expect(await groupPage.locator('input[type="file"]').evaluate((input: HTMLInputElement) => input.files?.[0].name)).toBe("pixel.png");
        await sql`update queue_items set scheduled_at=now()-interval '1 minute' where campaign_id=${automatic.id} and status='PENDING'`;
        await worker.evaluate(() => chrome.alarms.create("groupflow-automatic", { when: Date.now() + 1000 }));
        await expect.poll(async () => Number((await sql`select count(*) as total from queue_items where campaign_id=${automatic.id} and status='POSTED'`)[0].total), { timeout: 90_000 }).toBe(2);
        await worker.evaluate(() => chrome.alarms.create("groupflow-automatic", { when: Date.now() + 1000 }));
        await expect.poll(async () => Boolean((await worker.evaluate(() => chrome.storage.local.get("automatic"))).automatic && ((await worker.evaluate(() => chrome.storage.local.get("automatic"))).automatic as { enabled: boolean }).enabled), { timeout: 90_000 }).toBe(false);
        expect((await sql`select status from campaigns where id=${automatic.id}`)[0].status).toBe("COMPLETED");
        expect(await sql`select id from post_history where campaign_id=${automatic.id} and notes like 'Automatic run:%'`).toHaveLength(2);
        const extraGroup = await data(await actorA.post("/api/groups", { data: { name: "Limit acceptance group", facebookUrl: `https://www.facebook.com/groups/test-${runId}-limit/` } }), 201);
        const oversized = await data(await actorA.post("/api/campaigns", { data: { name: "Oversized automatic acceptance", contentId, groupIds: [...groupIds, extraGroup.id], minIntervalSeconds: 60, maxIntervalSeconds: 60 } }), 201);
        const token = (await worker.evaluate(() => chrome.storage.local.get("deviceToken"))).deviceToken as string;
        expect((await guest.post("/api/extension/campaigns", { headers: bearer(token), data: { campaignId: oversized.id } })).status()).toBe(409);
        const eligible = await data(await guest.get("/api/extension/campaigns", { headers: bearer(token) }));
        expect(eligible.items.some((entry: { id: string }) => entry.id === oversized.id)).toBe(false);
        const [device] = await sql`select id from devices where user_id=${userId} and name='Chrome Extension' and revoked_at is null`;
        await data(await actorA.delete("/api/devices", { data: { id: device.id } }));
        await popup.locator("#next").click();
        await expect(popup.locator("#setup")).toBeVisible();
        expect(await worker.evaluate(async () => Boolean((await chrome.storage.local.get("deviceToken")).deviceToken))).toBe(false);
      } finally { await browser.close(); }
    });
    await test.step("profile, password change, reset expiry/use, disabled account, and registration rate limiting", async () => {
      await data(await actorA.patch("/api/profile", { data: { displayName: "Updated acceptance user" } }));
      const newPassword = `${password}-new9`;
      await data(await actorA.patch("/api/profile", { data: { displayName: "Updated acceptance user", currentPassword: password, newPassword } }));
      expect((await actorA.get("/api/auth/me")).status()).toBe(401);
      await data(await actorA.post("/api/auth/login", { data: { email: emailA, password: newPassword } }));
      await data(await guest.post("/api/auth/forgot-password", { data: { email: emailA } }));
      const requested = await sql`select id from password_resets where user_id=${userId}`; expect(requested).toHaveLength(1);
      const resetToken = randomBytes(32).toString("base64url");
      const resetHash = createHash("sha256").update(resetToken).digest("hex");
      const expiredToken = randomBytes(32).toString("base64url");
      await sql`insert into password_resets (user_id,token_hash,expires_at) values (${userId},${createHash("sha256").update(expiredToken).digest("hex")},now()-interval '1 minute')`;
      expect((await guest.post("/api/auth/reset-password", { data: { token: expiredToken, password } })).status()).toBe(400);
      await sql`insert into password_resets (user_id,token_hash,expires_at) values (${userId},${resetHash},now()+interval '10 minutes')`;
      await data(await guest.post("/api/auth/reset-password", { data: { token: resetToken, password } }));
      expect((await guest.post("/api/auth/reset-password", { data: { token: resetToken, password } })).status()).toBe(400);
      expect((await actorA.get("/api/auth/me")).status()).toBe(401);
      await data(await actorA.post("/api/auth/login", { data: { email: emailA, password } }));
      const activeDevice = await pair(actorA, "Disabled account test");
      await sql`update users set status='DISABLED' where id=${userId}`;
      expect((await guest.post("/api/auth/login", { data: { email: emailA, password } })).status()).toBe(401);
      expect((await guest.get("/api/extension/jobs/next", { headers: bearer(activeDevice.deviceToken) })).status()).toBe(401);
      for (let attempt = 0; attempt < 6; attempt++) await guest.post("/api/auth/register", { data: { email: "invalid" } });
      expect((await guest.post("/api/auth/register", { data: { email: "invalid" } })).status()).toBe(429);
    });
  } finally {
    const testUsers = await sql`select id from users where email in (${emailA},${emailB})`;
    const ids = testUsers.map((user) => user.id);
    if (ids.length) {
      const spaces = await sql`select id from workspaces where owner_id in ${sql(ids)}`;
      const spaceIds = spaces.map((space) => space.id);
      if (spaceIds.length) {
        const files = await sql`select storage_key from media where workspace_id in ${sql(spaceIds)}`;
        for (const file of files) {
          if (/^[0-9a-f-]{36}$/i.test(file.storage_key)) await unlink(resolve(".local-storage/media", file.storage_key)).catch(() => undefined);
        }
        await sql`delete from audit_logs where workspace_id in ${sql(spaceIds)}`;
        await sql`delete from campaigns where workspace_id in ${sql(spaceIds)}`;
        await sql`delete from workspaces where id in ${sql(spaceIds)}`;
      }
      await sql`delete from audit_logs where user_id in ${sql(ids)}`;
      await sql`delete from users where id in ${sql(ids)}`;
    }
    await sql`delete from rate_limits where key like ${`%acceptance-${runId}%`} or key like ${`%acceptance-b-${runId}%`} or key like ${`%${emailA}%`}`;
    await sql.end();
    await Promise.all([actorA.dispose(), actorB.dispose(), guest.dispose()]);
  }
});





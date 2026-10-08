import { randomUUID } from "node:crypto";
import dotenv from "dotenv";
import postgres from "postgres";
import { test, expect, request as apiRequest, type APIResponse } from "@playwright/test";
import { databaseConnectionString } from "../src/lib/db/connection";

dotenv.config({ path: ".env.local", quiet: true });
test.skip(process.env.LIVE_API_TESTS !== "1", "Requires the configured test database.");

test("campaign editor adds, edits and removes groups and replaces content", async ({ page }) => {
  test.setTimeout(180_000);
  const run = randomUUID();
  const sql = postgres(databaseConnectionString(), { max: 1 });
  const actor = await apiRequest.newContext({ baseURL: "http://127.0.0.1:3000", extraHTTPHeaders: { origin: "http://127.0.0.1:3000", "x-nf-client-connection-ip": run } });
  let userId = "";
  let workspaceId = "";
  async function data(response: APIResponse, status = 200) {
    expect(response.status(), await response.text()).toBe(status);
    return (await response.json()).data;
  }
  try {
    const user = await data(await actor.post("/api/auth/register", { data: { email: `campaign-edit-${run}@example.test`, password: "CampaignEdit12345", displayName: "Campaign Editor" } }), 201);
    userId = user.id; workspaceId = user.workspaceId;
    const content = await data(await actor.post("/api/content", { data: { name: "Original content", body: "Original caption" } }), 201);
    const first = await data(await actor.post("/api/groups", { data: { name: "Original group", facebookUrl: `https://www.facebook.com/groups/edit-${run}/` } }), 201);
    const campaign = await data(await actor.post("/api/campaigns", { data: { name: "Editable campaign", contentId: content.id, groupIds: [first.id], minIntervalSeconds: 60, maxIntervalSeconds: 60 } }), 201);
    await page.context().addCookies((await actor.storageState()).cookies);
    await page.goto(`/campaigns/${campaign.id}`);
    await page.locator("#app-language").selectOption("en");
    await page.getByRole("button", { name: "Edit campaign", exact: true }).click();
    await page.locator("#editCampaignName").fill("Updated campaign");
    await page.getByRole("button", { name: "Remove selected content", exact: true }).click();
    await page.locator("#campaignContentName").fill("New campaign content");
    await page.locator("#campaignContentBody").fill("New caption");
    await page.getByRole("button", { name: "Add a Facebook Group", exact: true }).click();
    await page.locator("#campaignGroupName").fill("New group");
    await page.locator("#campaignGroupUrl").fill(`https://www.facebook.com/groups/new-${run}/`);
    await page.getByRole("button", { name: "Save group", exact: true }).click();
    await expect(page.getByRole("status")).toHaveText("Group saved. Save the campaign to apply your selection.");
    const editor = page.getByRole("region", { name: "Edit campaign" });
    const firstRow = editor.locator(".row").filter({ has: page.getByText("Original group", { exact: true }) });
    await firstRow.getByRole("button", { name: "Remove from campaign", exact: true }).click();
    await firstRow.getByRole("button", { name: "Edit group", exact: true }).click();
    await page.locator("#campaignGroupName").fill("Renamed original group");
    await page.getByRole("button", { name: "Save group", exact: true }).click();
    // Saving group metadata selects it; remove it again to verify campaign-only removal.
    await editor.locator(".row").filter({ has: page.getByText("Renamed original group", { exact: true }) }).getByRole("button", { name: "Remove from campaign", exact: true }).click();
    await Promise.all([page.waitForEvent("load"), page.getByRole("button", { name: "Save campaign changes", exact: true }).click()]);
    await expect(page.getByRole("heading", { name: "Updated campaign", exact: true })).toBeVisible();
    await expect(page.getByText("New caption", { exact: true })).toBeVisible();
    const selected = await sql`select g.name from campaign_groups cg join groups g on g.id=cg.group_id where cg.campaign_id=${campaign.id}`;
    expect(selected.map((group) => group.name)).toEqual(["New group"]);
    expect((await sql`select name from groups where id=${first.id}`)[0].name).toBe("Renamed original group");
    expect((await sql`select body from contents where id=${content.id}`)[0].body).toBe("Original caption");
    await data(await actor.post(`/api/campaigns/${campaign.id}/start`, { data: {} }));
    await page.reload();
    await expect(page.getByRole("button", { name: "Edit campaign", exact: true })).toBeDisabled();
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    await expect(page.getByRole("button", { name: "Edit campaign", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "Edit campaign", exact: true }).click();
    await page.locator("#campaignContentBody").fill("Private revised caption");
    await Promise.all([page.waitForEvent("load"), page.getByRole("button", { name: "Save campaign changes", exact: true }).click()]);
    await expect(page.getByText("Private revised caption", { exact: true })).toBeVisible();
    await page.setViewportSize({ width: 375, height: 812 });
    await page.getByRole("button", { name: "Edit campaign", exact: true }).click();
    await expect(page.locator("#editCampaignName")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  } finally {
    if (workspaceId) {
      await sql`delete from audit_logs where workspace_id=${workspaceId}`;
      await sql`delete from campaigns where workspace_id=${workspaceId}`;
      await sql`delete from workspaces where id=${workspaceId}`;
    }
    if (userId) { await sql`delete from audit_logs where user_id=${userId}`; await sql`delete from users where id=${userId}`; }
    await sql`delete from rate_limits where key like ${`%${run}%`}`;
    await actor.dispose(); await sql.end();
  }
});
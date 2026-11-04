import { build } from "esbuild";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { test, expect, type Page } from "@playwright/test";

let bundle: string;
test.beforeAll(async () => {
  const result = await build({
    stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
      import React from "react";
      import { createRoot } from "react-dom/client";
      import { LanguageProvider, LanguagePickerSlot, T } from "./src/components/language-provider";
      import { CampaignsPanel } from "./src/components/workspace-panel";
      import { WorkspaceBreadcrumb } from "./src/components/app-nav";
      import { AppSidebar } from "./src/components/app-sidebar";
      import { WorkflowOverview } from "./src/components/workflow-overview";
      const groups = ["Alpha", "Beta", "Gamma", "Paused"].map((name, index) => ({
        id: "group-" + index, name, facebookUrl: "https://www.facebook.com/groups/fixture-" + index,
        category: index === 1 ? "Travel" : "Community", status: index === 3 ? "PAUSED" : "ACTIVE", lastPostedAt: null,
      }));
      const contents = [{ id: "content", name: "Weekly update", body: "First line\\nSecond line", linkUrl: null }];
      const saved = { campaign: { id: "saved", contentId: "content", name: "Saved campaign", status: "READY", minIntervalSeconds: 2, maxIntervalSeconds: 2, createdAt: "2026-11-01" }, contentName: "Weekly update" };
      const fixture = new URLSearchParams(location.search).get("fixture");
      createRoot(document.getElementById("root")).render(<LanguageProvider initialLocale="en">
        <div className="app"><AppSidebar initialCollapsed={document.cookie.split(";").some((entry) => entry.trim() === "groupflow_sidebar=collapsed")} name="Demo user" initial="D" />
        <div className="main"><header className="topbar"><WorkspaceBreadcrumb /><div className="topbar-account"><LanguagePickerSlot /><button className="button"><T>Sign out</T></button></div></header><main className="content">
          <div className="page-head"><div><div className="eyebrow"><T>Planning</T></div><h1><T>Campaigns</T></h1><p><T>Build a queue across selected groups, then start it when ready.</T></p></div></div>
          {fixture === "overview" ? <WorkflowOverview hasContent={true} hasGroups={false} hasDevice={false} /> : <CampaignsPanel initialCampaigns={fixture === "saved" ? [saved] : []} groups={fixture === "empty" ? [] : groups} contents={fixture === "empty" ? [] : contents} />}
        </main></div></div>
      </LanguageProvider>);
    ` },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [{ name: "fixture-navigation", setup(builder) {
      builder.onResolve({ filter: /^next\/(navigation|link)$/ }, ({ path }) => ({ path, namespace: "fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({ resolveDir: process.cwd(), contents: path.endsWith("link")
        ? 'import React from "react"; export default function Link(props){return React.createElement("a",props)}'
        : 'export function usePathname(){return "/campaigns"} export function useRouter(){return {replace(){},refresh(){}}}' }));
    } }],
  });
  bundle = result.outputFiles[0].text;
});

async function mount(page: Page, fixture = "new") {
  await page.route("http://fixture.test/**", (route) => route.fulfill({ contentType: "text/html", body: '<meta name="viewport" content="width=device-width, initial-scale=1"><div id="root"></div>' }));
  await page.goto(`http://fixture.test/?fixture=${fixture}`);
  const cssRoot = resolve(".next/static/chunks");
  for (const file of (await readdir(cssRoot)).filter((name) => name.endsWith(".css"))) {
    await page.addStyleTag({ content: await readFile(resolve(cssRoot, file), "utf8") });
  }
  await page.addStyleTag({ content: (await readFile("src/app/globals.css", "utf8")).replace(/^@import.*$/m, "") });
  await page.addScriptTag({ content: bundle });
}

async function selectGroups(page: Page) {
  await page.locator("#wizardCampaignName").fill("November campaign");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "Select all shown", exact: true }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
}

test("three-step creation validates fields, preserves choices and submits once", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await mount(page);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText("Enter a campaign name.");
  await expect(page.locator("#wizardCampaignName")).toBeFocused();
  await page.locator("#wizardCampaignName").fill("November campaign");
  await page.locator("#wizardCampaignName").press("Enter");
  await expect(page.getByRole("checkbox")).toHaveCount(3);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText("Select at least one active group.");
  await page.getByRole("checkbox", { name: "Beta" }).check();
  await page.getByRole("checkbox", { name: "Alpha" }).check();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Schedule & Review", exact: true })).toBeFocused();
  await page.getByRole("button", { name: "Edit content", exact: true }).click();
  await expect(page.locator("#wizardCampaignName")).toHaveValue("November campaign");
  await page.locator(".wizard-steps").getByRole("button", { name: "3 Schedule & Review", exact: true }).click();
  await page.locator("#wizardMin").fill("2.5");
  await page.getByRole("button", { name: "Create campaign", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Use whole seconds");
  await page.locator("#wizardMin").fill("5");
  await page.locator("#wizardMax").fill("10");
  await page.locator("#wizardStart").fill("2020-01-01T12:00");
  await page.getByRole("button", { name: "Create campaign", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText("Choose a future start time or leave it blank.");
  await page.locator("#wizardStart").fill("");
  let requests = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/campaigns", async (route) => {
    requests++;
    expect(route.request().postDataJSON()).toMatchObject({ name: "November campaign", groupIds: ["group-1", "group-0"], minIntervalSeconds: 5, maxIntervalSeconds: 10 });
    await gate;
    await route.fulfill({ status: 201, json: { data: { id: "created", ...route.request().postDataJSON(), status: "READY", createdAt: "2026-11-03" }, error: null } });
  });
  await page.getByRole("button", { name: "Create campaign", exact: true }).click();
  await expect(page.getByRole("button", { name: "Creating…", exact: true })).toBeDisabled();
  await page.locator(".campaign-wizard").evaluate((form) => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(requests).toBe(1);
  release();
  await expect(page.getByRole("status")).toContainText("Campaign created.");
  await expect(page.locator("#campaign-composer")).toBeHidden();
  await expect(page.locator("#campaign-feedback")).toBeFocused();
  await expect(page.getByRole("link", { name: "Open campaign", exact: true })).toHaveAttribute("href", "/campaigns/created");
  expect(errors).toEqual([]);
});

test("selection survives filtering and selected-only view", async ({ page }) => {
  await mount(page);
  await page.locator("#wizardCampaignName").fill("Filters");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.locator("#wizardCategory").selectOption("Travel");
  await page.getByRole("button", { name: "Select all shown", exact: true }).click();
  await page.locator("#wizardCategory").selectOption("");
  await page.locator("#wizardSearch").fill("Alpha");
  await page.getByRole("checkbox", { name: "Alpha" }).check();
  await page.locator("#wizardSearch").fill("");
  await page.getByRole("button", { name: "Selected only (2)", exact: true }).click();
  await expect(page.getByRole("checkbox")).toHaveCount(2);
  await page.locator("#wizardSearch").fill("No match");
  await expect(page.getByText("No active groups match these filters.")).toBeVisible();
  await page.getByRole("button", { name: "Clear filters", exact: true }).click();
  await expect(page.getByRole("checkbox", { name: "Beta" })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: "Alpha" })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: "Gamma" })).not.toBeChecked();
});

test("failed saves preserve the draft and allow a retry", async ({ page }) => {
  await mount(page);
  await selectGroups(page);
  let fail = true;
  await page.route("**/api/campaigns", (route) => route.fulfill(fail
    ? { status: 500, json: { data: null, error: { message: "Unable to create campaign." } } }
    : { status: 201, json: { data: { id: "retry", ...route.request().postDataJSON(), status: "READY", createdAt: "2026-11-03" }, error: null } }));
  await page.getByRole("button", { name: "Create campaign", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText("Unable to create campaign.");
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByRole("checkbox", { name: "Alpha" })).toBeChecked();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  fail = false;
  await page.getByRole("button", { name: "Create campaign", exact: true }).click();
  await expect(page.getByRole("link", { name: "Open campaign", exact: true })).toHaveAttribute("href", "/campaigns/retry");
});

test("saved campaigns show the list first and keep a hidden draft intact", async ({ page }) => {
  await mount(page, "saved");
  await expect(page.getByRole("link", { name: "Saved campaign", exact: true })).toBeVisible();
  await expect(page.locator("#campaign-composer")).toBeHidden();
  await page.getByRole("button", { name: "New campaign", exact: true }).click();
  await page.locator("#wizardCampaignName").fill("Keep this draft");
  await page.getByRole("button", { name: "Hide campaign form", exact: true }).click();
  await page.getByRole("button", { name: "New campaign", exact: true }).click();
  await expect(page.locator("#wizardCampaignName")).toHaveValue("Keep this draft");
  await page.getByRole("button", { name: "Hide campaign form", exact: true }).click();
  await page.evaluate(() => { window.location.hash = "new"; });
  await expect(page.locator("#campaign-composer")).toBeVisible();
  await page.getByRole("button", { name: "Hide campaign form", exact: true }).click();
  await expect(page).not.toHaveURL(/#new/);
  await page.evaluate(() => { window.location.hash = "new"; });
  await expect(page.locator("#campaign-composer")).toBeVisible();
});

test("empty setup gives direct links and dashboard identifies the next missing step", async ({ page }) => {
  await mount(page, "empty");
  await expect(page.getByRole("link", { name: "Create reusable content", exact: true })).toHaveAttribute("href", "/content");
  await expect(page.getByRole("link", { name: "Add a Facebook Group", exact: true })).toHaveAttribute("href", "/groups");
  await mount(page, "overview");
  await expect(page.getByRole("heading", { name: "Add your groups", exact: true })).toBeVisible();
  await expect(page.locator(".workflow-step.is-next")).toHaveAttribute("href", "/groups");
});

test("Vietnamese workflow stays usable on phone and desktop without horizontal overflow", async ({ page }) => {
  await mount(page);
  await page.locator("#app-language").selectOption("vi");
  await expect(page.getByRole("navigation", { name: "Điều hướng chính", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Tiếp tục", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText("Hãy nhập tên chiến dịch.");
  await page.locator("#wizardCampaignName").fill("Chiến dịch tháng 11");
  await page.getByRole("button", { name: "Tiếp tục", exact: true }).click();
  await page.getByRole("button", { name: "Chọn tất cả đang hiển thị", exact: true }).click();
  await page.getByRole("button", { name: "Tiếp tục", exact: true }).click();
  for (const width of [1440, 1024, 768, 375]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.getByRole("button", { name: "Tạo chiến dịch", exact: true })).toBeVisible();
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.screenshot({ path: "test-results/ui-workflow-mobile.png", fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: "test-results/ui-workflow-desktop.png", fullPage: true });
});


test("desktop sidebar stays fixed and collapse expands the usable workspace", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mount(page, "saved");
  const sidebar = page.locator(".sidebar");
  await expect(sidebar).toHaveCSS("position", "fixed");
  await page.locator(".content").evaluate((element) => { (element as HTMLElement).style.minHeight = "2400px"; });
  await page.evaluate(() => window.scrollTo(0, 800));
  expect((await sidebar.boundingBox())!.y).toBe(0);
  await page.getByRole("button", { name: "Collapse sidebar", exact: true }).click();
  await expect.poll(async () => Math.round((await sidebar.boundingBox())!.width)).toBe(112);
  await expect.poll(async () => Math.round((await page.locator(".main").boundingBox())!.x)).toBe(112);
  await expect(page.getByRole("button", { name: "Expand sidebar", exact: true })).toHaveAttribute("aria-expanded", "false");
  await expect(sidebar.getByRole("link", { name: "Campaigns", exact: true })).toBeVisible();
  await expect(sidebar.getByRole("link", { name: "Settings", exact: true })).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ animations: "disabled", path: "test-results/sidebar-collapsed-desktop.png" });
  await page.getByRole("button", { name: "Expand sidebar", exact: true }).click();
  await expect.poll(async () => Math.round((await sidebar.boundingBox())!.width)).toBe(260);
  await expect.poll(async () => Math.round((await page.locator(".main").boundingBox())!.x)).toBe(260);
  await page.screenshot({ animations: "disabled", path: "test-results/sidebar-expanded-desktop.png" });
});

test("sidebar preference survives reload and keyboard toggling keeps focus", async ({ page }) => {
  await mount(page, "saved");
  const toggle = page.getByRole("button", { name: "Collapse sidebar", exact: true });
  await toggle.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Expand sidebar", exact: true })).toBeFocused();
  expect((await page.context().cookies()).find((cookie) => cookie.name === "groupflow_sidebar")?.value).toBe("collapsed");
  await mount(page, "saved");
  await expect(page.locator(".sidebar")).toHaveAttribute("data-collapsed", "true");
  await page.getByRole("button", { name: "Expand sidebar", exact: true }).click();
  await mount(page, "saved");
  await expect(page.locator(".sidebar")).toHaveAttribute("data-collapsed", "false");
});

test("mobile navigation collapses without overflow and can always be reopened", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await mount(page, "saved");
  await page.locator("#app-language").selectOption("vi");
  await page.getByRole("button", { name: "Thu gọn thanh bên", exact: true }).click();
  await expect(page.locator("#workspace-sidebar-content")).toBeHidden();
  await expect(page.getByRole("button", { name: "Mở rộng thanh bên", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator(".content").evaluate((element) => { (element as HTMLElement).style.minHeight = "2400px"; });
  await page.evaluate(() => window.scrollTo(0, 700));
  expect((await page.locator(".sidebar").boundingBox())!.y).toBe(0);
  await page.getByRole("button", { name: "Mở rộng thanh bên", exact: true }).click();
  await expect(page.getByRole("navigation", { name: "Điều hướng chính", exact: true })).toBeVisible();
  await expect(page.locator(".sidebar-content")).toHaveCSS("opacity", "1");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ animations: "disabled", path: "test-results/sidebar-mobile.png" });
});

test("reduced motion removes transitions and step animation without losing the draft", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await mount(page);
  await page.getByRole("button", { name: "Collapse sidebar", exact: true }).click();
  await expect(page.locator(".sidebar")).toHaveCSS("transition-duration", "0s");
  await expect(page.locator(".main")).toHaveCSS("transition-duration", "0s");
  await page.locator("#wizardCampaignName").fill("Motion preference");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.locator(".workspace-step-enter")).toHaveCSS("animation-name", "none");
  await page.locator(".wizard-steps").getByRole("button", { name: "1 Campaign & Content", exact: true }).click();
  await expect(page.locator("#wizardCampaignName")).toHaveValue("Motion preference");
});

import { build } from "esbuild";
import { readFile } from "node:fs/promises";
import { test, expect, type Page } from "@playwright/test";
let bundle: string;
test.beforeAll(async () => {
  const result = await build({
    stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
      import React from "react";
      import { createRoot } from "react-dom/client";
      import { LanguageProvider } from "./src/components/language-provider";
      import { GroupsPanel } from "./src/components/workspace-panel";
      import CampaignEditor from "./src/components/campaign-editor";
      const groups = ["Alpha", "Beta"].map((name,index)=>({id: "group-"+index,name,facebookUrl:"https://www.facebook.com/groups/test-"+index+"/",category:null,status:"ACTIVE",lastPostedAt:null}));
      createRoot(document.getElementById("root")).render(<LanguageProvider initialLocale="en">{window.fixtureCampaign ? <CampaignEditor campaign={{id:"campaign",name:"Campaign",contentId:"content",minIntervalSeconds:60,maxIntervalSeconds:120}} selectedGroupIds={groups.map(g=>g.id)} availableGroups={groups} availableContents={[{id:"content",name:"Content",body:"Caption",linkUrl:null}]} onClose={()=>{}}/> : <GroupsPanel initialGroups={groups}/>}</LanguageProvider>);
    ` }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [{ name: "router", setup(builder) {
      builder.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: "router", namespace: "fixture" }));
      builder.onResolve({ filter: /^next\/link$/ }, () => ({ path: "link", namespace: "fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({ resolveDir: process.cwd(), contents: path === "link"
        ? 'import React from "react"; export default function Link(props){return React.createElement("a",props)}'
        : "export function useRouter(){return {replace(){},refresh(){}}}" }));
    }}],
  });
  bundle = result.outputFiles[0].text;
});
async function mount(page: Page, campaign = false) {
  await page.route("http://fixture.test/", (route) => route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' }));
  await page.goto("http://fixture.test/");
  await page.evaluate((value) => { (window as unknown as { fixtureCampaign: boolean }).fixtureCampaign = value; }, campaign);
  await page.addStyleTag({ content: (await readFile("src/app/globals.css", "utf8")).replace(/^@import.*$/m, "") });
  await page.addScriptTag({ content: bundle });
}
const row = (page: Page, name: string) => page.getByRole("row").filter({ has: page.getByText(name, { exact: true }) });
test("group editor opens in a modal and updates the row after saving", async ({ page }) => {
  await mount(page);
  await page.route("**/api/groups/group-0", (route) => route.fulfill({ json: { data: { id: "group-0", name: "Updated Alpha", facebookUrl: "https://www.facebook.com/groups/updated/", category: "Updated", status: "ACTIVE", lastPostedAt: null }, error: null } }));
  const trigger = row(page, "Alpha").getByRole("button", { name: "Edit", exact: true });
  const position = await row(page, "Beta").evaluate((element) => element.getBoundingClientRect().top + window.scrollY);
  await trigger.click();
  const editor = page.getByRole("dialog", { name: "Edit group", exact: true });
  await expect(editor).toBeVisible();
  expect(await row(page, "Beta").evaluate((element) => element.getBoundingClientRect().top + window.scrollY)).toEqual(position);
  await expect(editor.getByLabel("Name", { exact: true })).toHaveValue("Alpha");
  await editor.getByLabel("Name", { exact: true }).fill("Updated Alpha");
  await editor.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(row(page, "Updated Alpha")).toBeVisible();
  await expect(editor).toHaveCount(0);
});

test("Escape closes the editor and restores focus before editing another group", async ({ page }) => {
  await mount(page);
  const trigger = row(page, "Alpha").getByRole("button", { name: "Edit", exact: true });
  await trigger.click();
  const editor = page.getByRole("dialog", { name: "Edit group", exact: true });
  await editor.getByLabel("Name", { exact: true }).fill("Unsaved Alpha");
  await page.keyboard.press("Escape");
  await expect(editor).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await row(page, "Beta").getByRole("button", { name: "Edit", exact: true }).click();
  await expect(editor.getByLabel("Name", { exact: true })).toHaveValue("Beta");
  await editor.getByRole("button", { name: "Close", exact: true }).click();
  await expect(editor).toHaveCount(0);
});

test("failed group edit retains the draft inside the popup", async ({ page }) => {
  await mount(page);
  await page.route("**/api/groups/group-0", (route) => route.fulfill({ status: 500, json: { data: null, error: { message: "Unable to update group." } } }));
  await row(page, "Alpha").getByRole("button", { name: "Edit", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Edit group", exact: true });
  await editor.getByLabel("Name", { exact: true }).fill("Unsaved Alpha");
  await editor.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(editor.getByRole("alert")).toContainText("Unable to update group.");
  await expect(editor.getByLabel("Name", { exact: true })).toHaveValue("Unsaved Alpha");
});

test("campaign group popup closes back to the campaign draft", async ({ page }) => {
  await mount(page, true);
  const campaign = page.getByRole("dialog", { name: "Edit campaign", exact: true });
  await campaign.getByLabel("Campaign name", { exact: true }).fill("Unsaved campaign");
  const alpha = campaign.locator(".row").filter({ has: page.getByText("Alpha", { exact: true }) });
  await alpha.getByRole("button", { name: "Edit group", exact: true }).click();
  const group = page.getByRole("dialog", { name: "Edit group", exact: true });
  await expect(group.getByLabel("Group name", { exact: true })).toHaveValue("Alpha");
  await page.keyboard.press("Escape");
  await expect(group).toHaveCount(0);
  await expect(campaign).toBeVisible();
  await expect(campaign.getByLabel("Campaign name", { exact: true })).toHaveValue("Unsaved campaign");
  await campaign.getByRole("button", { name: "Add a Facebook Group", exact: true }).click();
  const add = page.getByRole("dialog", { name: "Add a Facebook Group", exact: true });
  await expect(add.getByLabel("Group name", { exact: true })).toHaveValue("");
  await add.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(campaign.getByLabel("Campaign name", { exact: true })).toHaveValue("Unsaved campaign");
});

test("group deletion requires confirmation and cancel keeps the row", async ({ page }) => {
  await mount(page);
  let requests = 0;
  await page.route("**/api/groups/group-0", (route) => { requests++; return route.fulfill({ json: { data: {}, error: null } }); });
  const trigger = row(page, "Alpha").getByRole("button", { name: "Delete", exact: true });
  await trigger.click();
  const confirm = page.getByRole("dialog", { name: "Delete group", exact: true });
  await expect(confirm).toContainText("Alpha");
  await confirm.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(requests).toBe(0);
  await expect(trigger).toBeFocused();
  await trigger.click();
  await confirm.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(row(page, "Alpha")).toHaveCount(0);
  expect(requests).toBe(1);
});

test("mobile popup stays within the viewport and traps keyboard focus", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await mount(page);
  await row(page, "Alpha").getByRole("button", { name: "Edit", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Edit group", exact: true });
  const bounds = (await editor.boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(375);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(667);
  for (let index = 0; index < 12; index++) {
    await page.keyboard.press("Tab");
    expect(await editor.evaluate((element) => element.contains(document.activeElement) || document.activeElement === document.body)).toBe(true);
  }
  await page.screenshot({ path: "docs/repair-evidence/group-popup-mobile.png", fullPage: true });
});


test("loading keeps an async row action locked until the response and recovers after failure", async ({ page }) => {
  await mount(page);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let requests = 0;
  await page.route("**/api/groups/group-0", async (route) => {
    requests++;
    await gate;
    await route.fulfill({ status: 500, json: { data: null, error: { message: "Unable to update group." } } });
  });
  const button = row(page, "Alpha").getByRole("button", { name: "Pause", exact: true });
  await button.click();
  await expect(button).toHaveAttribute("aria-busy", "true");
  await expect(button).toBeDisabled();
  await expect(button.locator(".loading-dots")).toBeVisible();
  await button.evaluate((element) => element.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  expect(requests).toBe(1);
  release();
  await expect(button).toBeEnabled();
  await expect(button).toHaveAttribute("aria-busy", "false");
  await expect(button.locator(".loading-dots")).toHaveCount(0);
  await expect(page.getByRole("alert")).toContainText("Unable to update group.");
});

test("form loading blocks a second submit and retains input after a failed save", async ({ page }) => {
  await mount(page);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let requests = 0;
  await page.route("**/api/groups", async (route) => {
    requests++;
    await gate;
    await route.fulfill({ status: 500, json: { data: null, error: { message: "Unable to add the group." } } });
  });
  const form = page.locator("form").first();
  await form.locator('[name="name"]').fill("New group");
  await form.locator('[name="facebookUrl"]').fill("https://www.facebook.com/groups/new-group/");
  await form.getByRole("button", { name: "Add group", exact: true }).click();
  await expect(form).toHaveAttribute("aria-busy", "true");
  await expect(form.locator("button .loading-dots")).toBeVisible();
  await form.evaluate((element) => element.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(requests).toBe(1);
  release();
  await expect(form).toHaveAttribute("aria-busy", "false");
  await expect(form.getByRole("button", { name: "Add group", exact: true })).toBeEnabled();
  await expect(form.locator('[name="name"]')).toHaveValue("New group");
  await expect(form.getByRole("alert")).toContainText("Unable to add the group.");
});


test("saving a group prevents dismissal until the request finishes", async ({ page }) => {
  await mount(page);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/groups/group-0", async (route) => {
    await gate;
    await route.fulfill({ status: 500, json: { data: null, error: { message: "Unable to update group." } } });
  });
  await row(page, "Alpha").getByRole("button", { name: "Edit", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Edit group", exact: true });
  await editor.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(editor.getByRole("button", { name: "Close", exact: true })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(editor).toBeVisible();
  release();
  await expect(editor.getByRole("alert")).toBeVisible();
  await editor.getByRole("button", { name: "Close", exact: true }).click();
  await expect(editor).toHaveCount(0);
});


test("popup entrance and dismissal animate while preserving focus restoration", async ({ page }) => {
  await mount(page);
  const trigger = row(page, "Alpha").getByRole("button", { name: "Edit", exact: true });
  await trigger.click();
  const editor = page.getByRole("dialog", { name: "Edit group", exact: true });
  await expect(editor).toHaveCSS("animation-name", "workspace-modal-in");
  await expect(editor).toHaveCSS("animation-duration", "0.2s");
  await editor.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.locator("dialog")).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe("");
});

test("reduced motion removes popup animations and still closes with Escape", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await mount(page);
  const trigger = row(page, "Alpha").getByRole("button", { name: "Edit", exact: true });
  await trigger.click();
  const editor = page.getByRole("dialog", { name: "Edit group", exact: true });
  await expect(editor).toHaveCSS("animation-name", "none");
  await page.keyboard.press("Escape");
  await expect(page.locator("dialog")).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

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
      import { LanguageProvider } from "./src/components/language-provider";
      import { GroupsPanel } from "./src/components/workspace-panel";
      import CampaignEditor from "./src/components/campaign-editor";
      const groups = ["Alpha", "Beta"].map((name,index)=>({id: "group-"+index,name,facebookUrl:"https://www.facebook.com/groups/test-"+index+"/",category:null,status:"ACTIVE",lastPostedAt:null}));
      createRoot(document.getElementById("root")).render(<LanguageProvider initialLocale="en">{window.fixtureCampaign ? <CampaignEditor campaign={{id:"campaign",name:"Campaign",contentId:"content",minIntervalSeconds:60,maxIntervalSeconds:120}} selectedGroupIds={groups.map(g=>g.id)} availableGroups={groups} availableContents={[{id:"content",name:"Content",body:"Caption",linkUrl:null}]} onClose={()=>{}}/> : <GroupsPanel initialGroups={groups}/>}</LanguageProvider>);
    ` }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [{ name: "router", setup(builder) {
      builder.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: "router", namespace: "fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: "export function useRouter(){return {replace(){},refresh(){}}}" }));
    }}],
  });
  bundle = result.outputFiles[0].text;
});
async function mount(page: Page, campaign = false) {
  await page.route("http://fixture.test/", (route) => route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' }));
  await page.goto("http://fixture.test/");
  await page.evaluate((value) => { (window as unknown as { fixtureCampaign: boolean }).fixtureCampaign = value; }, campaign);
  await page.addScriptTag({ content: bundle });
}
const row = (page: Page, name: string) => page.getByRole("row").filter({ has: page.getByText(name, { exact: true }) });
test("group editor opens directly below the selected row and saves there", async ({ page }) => {
  await mount(page);
  await page.route("**/api/groups/group-0", (route) => route.fulfill({ json: { data: { id: "group-0", name: "Updated Alpha", facebookUrl: "https://www.facebook.com/groups/updated/", category: "Updated", status: "ACTIVE", lastPostedAt: null }, error: null } }));
  await row(page, "Alpha").getByRole("button", { name: "Edit", exact: true }).click();
  const editor = page.locator("#group-editor-group-0");
  expect(await editor.evaluate((element) => element.previousElementSibling?.textContent)).toContain("Alpha");
  await expect(editor.getByLabel("Name", { exact: true })).toHaveValue("Alpha");
  let cssRoot = resolve(".next/static/chunks");
  let files: string[];
  try { files = await readdir(cssRoot); }
  catch { cssRoot = resolve(".next/dev/static/chunks"); files = await readdir(cssRoot); }
  for (const file of files.filter((name) => name.endsWith(".css"))) {
    await page.addStyleTag({ content: await readFile(resolve(cssRoot, file), "utf8") });
  }
  await page.evaluate(() => { document.getElementById("root")!.style.cssText = "max-width:1100px;margin:0 auto;padding:24px"; });
  await page.screenshot({ path: "docs/repair-evidence/group-inline-editor.png", fullPage: true });
  await editor.getByLabel("Name", { exact: true }).fill("Updated Alpha");
  await editor.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(row(page, "Updated Alpha")).toBeVisible();
  await expect(editor).toHaveCount(0);
  await expect(row(page, "Beta")).toBeVisible();
});
test("switching the selected group resets the editor to the correct item", async ({ page }) => {
  await mount(page);
  await row(page, "Alpha").getByRole("button", { name: "Edit", exact: true }).click();
  await page.locator("#group-editor-group-0").getByLabel("Name", { exact: true }).fill("Unsaved Alpha");
  await row(page, "Beta").getByRole("button", { name: "Edit", exact: true }).click();
  await expect(page.locator("#group-editor-group-0")).toHaveCount(0);
  await expect(page.locator("#group-editor-group-1").getByLabel("Name", { exact: true })).toHaveValue("Beta");
  await page.locator("#group-editor-group-1").getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.locator("#group-editor-group-1")).toHaveCount(0);
});
test("failed group edit keeps the draft beneath the selected row", async ({ page }) => {
  await mount(page);
  await page.route("**/api/groups/group-0", (route) => route.fulfill({ status: 500, json: { data: null, error: { message: "Unable to update group." } } }));
  await row(page, "Alpha").getByRole("button", { name: "Edit", exact: true }).click();
  const editor = page.locator("#group-editor-group-0");
  await editor.getByLabel("Name", { exact: true }).fill("Unsaved Alpha");
  await editor.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(editor.getByRole("alert")).toContainText("Unable to update group.");
  await expect(editor.getByLabel("Name", { exact: true })).toHaveValue("Unsaved Alpha");
  await expect(row(page, "Alpha")).toBeVisible();
});
test("campaign group editor stays inside the selected group and new group form stays below Add", async ({ page }) => {
  await mount(page, true);
  const alpha = page.locator(".row").filter({ has: page.getByText("Alpha", { exact: true }) });
  const beta = page.locator(".row").filter({ has: page.getByText("Beta", { exact: true }) });
  await alpha.getByRole("button", { name: "Edit group", exact: true }).click();
  await expect(alpha.getByLabel("Group name", { exact: true })).toHaveValue("Alpha");
  await beta.getByRole("button", { name: "Edit group", exact: true }).click();
  await expect(alpha.getByLabel("Group name", { exact: true })).toHaveCount(0);
  await expect(beta.getByLabel("Group name", { exact: true })).toHaveValue("Beta");
  await beta.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Add a Facebook Group", exact: true }).click();
  await expect(page.getByLabel("Group name", { exact: true })).toHaveValue("");
  const groupForm = page.locator(".form").filter({ has: page.locator("#campaignGroupName") }).last();
  expect(await groupForm.evaluate((element) => element.previousElementSibling?.textContent)).toContain("Selected groups");
});

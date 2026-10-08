import { build } from "esbuild";
import { test, expect, type Page } from "@playwright/test";

let bundle: string;
test.beforeAll(async () => {
  const result = await build({
    stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
      import React, { useState } from "react";
      import { createRoot } from "react-dom/client";
      import { LanguageProvider } from "./src/components/language-provider";
      import DeleteCampaignButton from "./src/components/delete-campaign-button";
      const config = window.demoConfig;
      function Demo() {
        const [deleted, setDeleted] = useState(false);
        return <LanguageProvider initialLocale={config.locale}>{deleted ? <p role="status">Deleted</p> : <DeleteCampaignButton id="11111111-1111-4111-8111-111111111111" name="Test campaign" disabled={config.disabled} onDeleted={config.detail ? undefined : () => setDeleted(true)} />}</LanguageProvider>;
      }
      createRoot(document.getElementById("root")).render(<Demo />);
    ` },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [{ name: "fixture-router", setup(builder) {
      builder.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: "fixture-router", namespace: "fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: "export function useRouter(){return {replace(path){window.lastNavigation=path},refresh(){}}}" }));
    } }],
  });
  bundle = result.outputFiles[0].text;
});
async function mount(page: Page, config: { disabled?: boolean; locale?: string; detail?: boolean } = {}) {
  await page.route("http://fixture.test/", (route) => route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' }));
  await page.goto("http://fixture.test/");
  await page.evaluate((options) => { (window as unknown as { demoConfig: unknown }).demoConfig = options; document.cookie = `groupflow_locale=${options.locale}; Path=/`; }, { locale: "en", ...config });
  await page.addScriptTag({ content: bundle });
}
test("cancel confirmation makes no DELETE request", async ({ page }) => {
  let requests = 0;
  await page.route("**/api/campaigns/**", (route) => { requests++; return route.fulfill({ json: { data: { deleted: true }, error: null } }); });
  await mount(page);
  page.once("dialog", async (dialog) => { expect(dialog.message()).toContain("queue/history permanently"); await dialog.dismiss(); });
  await page.getByRole("button", { name: "Delete campaign", exact: true }).click();
  expect(requests).toBe(0);
  await expect(page.getByRole("button", { name: "Delete campaign", exact: true })).toBeEnabled();
});
test("confirmed deletion uses DELETE and removes the item", async ({ page }) => {
  await page.route("**/api/campaigns/**", (route) => {
    expect(route.request().method()).toBe("DELETE");
    return route.fulfill({ json: { data: { deleted: true }, error: null } });
  });
  await mount(page);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Delete campaign", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Deleted");
});
test("server conflict stays visible in Vietnamese and permits retry", async ({ page }) => {
  await page.route("**/api/campaigns/**", (route) => route.fulfill({ status: 409, json: { data: null, error: { message: "Resolve opened or unconfirmed posts before deleting this campaign." } } }));
  await mount(page, { locale: "vi" });
  page.once("dialog", async (dialog) => { expect(dialog.message()).toContain("Xóa vĩnh viễn"); await dialog.accept(); });
  await page.getByRole("button", { name: "Xóa chiến dịch", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("chưa rõ kết quả");
  await expect(page.getByRole("button", { name: "Xóa chiến dịch", exact: true })).toBeEnabled();
});
test("running campaign button is disabled", async ({ page }) => {
  await mount(page, { disabled: true });
  await expect(page.getByRole("button", { name: "Delete campaign", exact: true })).toBeDisabled();
});
test("detail page returns to campaign list after deletion", async ({ page }) => {
  await page.route("**/api/campaigns/**", (route) => route.fulfill({ json: { data: { deleted: true }, error: null } }));
  await mount(page, { detail: true });
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Delete campaign", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { lastNavigation?: string }).lastNavigation)).toBe("/campaigns");
});


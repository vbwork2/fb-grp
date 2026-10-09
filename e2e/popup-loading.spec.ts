import { build } from "esbuild";
import { readFile } from "node:fs/promises";
import { test, expect } from "@playwright/test";

let bundle: string;
let html: string;
test.beforeAll(async () => {
  const result = await build({ entryPoints: ["extension/src/popup/main.ts"], bundle: true, write: false, platform: "browser", format: "iife" });
  bundle = result.outputFiles[0].text;
  html = (await readFile("extension/src/popup/index.html", "utf8")).replace(/<script[^>]*>[\s\S]*?<\/script>/g, "");
});

for (const success of [true, false]) {
  test(`popup pairing shows loading and recovers after success=${success}`, async ({ page }) => {
    await page.route("http://popup.test/", (route) => route.fulfill({ contentType: "text/html", body: html }));
    await page.goto("http://popup.test/");
    await page.evaluate(() => {
      let release!: (result: unknown) => void;
      let calls = 0;
      Object.assign(window, {
        chrome: {
          runtime: { getManifest: () => ({ version: "0.1.3" }), sendMessage: (message: { type: string }) => {
            if (message.type === "PAIR") { calls++; return new Promise((resolve) => { release = resolve; }); }
            return Promise.resolve({ ok: true, items: [] });
          } },
          permissions: { request: () => Promise.resolve(true) },
          storage: { local: { get: () => Promise.resolve({ locale: "vi" }) }, onChanged: { addListener() {} } },
        },
        releasePair: (result: unknown) => release(result),
        pairCalls: () => calls,
      });
    });
    await page.addScriptTag({ content: bundle });
    await expect(page.locator("#apiUrl")).toHaveValue("https://fb-group-indol.vercel.app");
    await page.locator("#code").fill("123456");
    const button = page.locator("#pair");
    await button.click();
    await expect(button).toHaveAttribute("aria-busy", "true");
    await expect(button).toBeDisabled();
    await button.evaluate((element) => element.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(await page.evaluate(() => (window as unknown as { pairCalls: () => number }).pairCalls())).toBe(1);
    await page.screenshot({ path: `test-results/popup-loading-${success}.png` });
    await page.evaluate((ok) => (window as unknown as { releasePair: (value: unknown) => void }).releasePair(ok ? { ok: true } : { ok: false, error: "Pairing failed." }), success);
    await expect(button).not.toHaveAttribute("aria-busy", "true");
    await expect(button).toBeEnabled();
    if (!success) await expect(page.locator("#status")).toHaveText("Ghép nối thất bại.");
  });
}

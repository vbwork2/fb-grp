import { build } from "esbuild";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { test, expect, type Page } from "@playwright/test";

let bundle: string;
const image = { id: "saved-image", mimeType: "image/png", originalFilename: "saved.png", sizeBytes: 1024 };
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==", "base64");
const file = (name: string) => ({ name, mimeType: "image/png", buffer: png });
const pdfBytes = Buffer.from("%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n");
const pdf = { id: "saved-pdf", mimeType: "application/pdf", originalFilename: "Tài liệu.pdf", sizeBytes: pdfBytes.length };
test.beforeAll(async () => {
  const result = await build({
    stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
      import React from "react";
      import { createRoot } from "react-dom/client";
      import { LanguageProvider } from "./src/components/language-provider";
      import { ContentPanel } from "./src/components/workspace-panel";
      createRoot(document.getElementById("root")).render(<LanguageProvider initialLocale={window.demoConfig.locale}><ContentPanel initialContents={[{id:"content-a",name:"Saved content A",body:"Private caption A",linkUrl:null},{id:"content-b",name:"Saved content B",body:"Private caption B",linkUrl:null}]} initialMedia={window.demoConfig.media} /></LanguageProvider>);
    ` },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [{ name: "fixture-router", setup(builder) {
      builder.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: "fixture-router", namespace: "fixture" }));
      builder.onResolve({ filter: /^next\/link$/ }, () => ({ path: "fixture-link", namespace: "fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({ resolveDir: process.cwd(), contents: path === "fixture-link"
        ? 'import React from "react"; export default function Link(props){return React.createElement("a",props)}'
        : "export function useRouter(){return {replace(){},refresh(){}}}" }));
    } }],
  });
  bundle = result.outputFiles[0].text;
});
async function mount(page: Page, media: Record<string, (typeof image)[]> = { "content-a": [image] }, locale = "en") {
  await page.route("http://fixture.test/", (route) => route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' }));
  await page.route("**/api/media/*", (route) => route.fulfill({ contentType: "image/png", body: png }));
  await page.goto("http://fixture.test/");
  await page.evaluate((config) => { (window as unknown as { demoConfig: unknown }).demoConfig = config; document.cookie = `groupflow_locale=${config.locale}; Path=/`; }, { media, locale });
  await page.addStyleTag({ content: (await readFile("src/app/globals.css", "utf8")).replace(/^@import.*$/m, "") });
  await page.addScriptTag({ content: bundle });
}
const card = (page: Page, name = "Saved content A") => page.locator("article").filter({ hasText: name });
async function open(page: Page) { await card(page).getByRole("button", { name: "Details", exact: true }).click(); }

test("saved image counts persist and one button reveals details", async ({ page }) => {
  await mount(page);
  await expect(card(page)).toContainText("1 images uploaded");
  await expect(page.getByText("Private caption A", { exact: true })).toBeHidden();
  await open(page);
  await expect(page.getByText("Private caption A", { exact: true })).toBeVisible();
  await expect(card(page).getByRole("img", { name: "saved.png" })).toBeVisible();
  await expect(card(page).getByRole("button", { name: "Edit", exact: true })).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
  await card(page, "Saved content B").getByRole("button", { name: "Details", exact: true }).click();
  await expect(page.getByText("Private caption A", { exact: true })).toBeHidden();
  await expect(page.getByText("Private caption B", { exact: true })).toBeVisible();
  await mount(page);
  await expect(card(page)).toContainText("1 images uploaded");
});

test("PDF upload displays a document card, separate counts and authenticated open/download links", async ({ page }) => {
  await mount(page);
  await page.route("**/api/media", (route) => {
    expect(route.request().postDataBuffer()!.toString()).toContain('filename="Tài liệu.pdf"');
    return route.fulfill({ status: 201, json: { data: pdf, error: null } });
  });
  await open(page);
  await expect(card(page).getByLabel("Upload images or PDFs", { exact: true })).toHaveAttribute("accept", /application\/pdf/);
  await card(page).getByLabel("Upload images or PDFs", { exact: true }).setInputFiles({ name: pdf.originalFilename, mimeType: "application/pdf", buffer: pdfBytes });
  await expect(card(page)).toContainText("1 images uploaded · 1 PDFs uploaded");
  await expect(card(page).getByRole("img")).toHaveCount(1);
  await expect(card(page).getByRole("link", { name: /Open PDF/ })).toHaveAttribute("href", "/api/media/saved-pdf");
  await expect(card(page).getByRole("link", { name: "Download PDF", exact: true })).toHaveAttribute("href", "/api/media/saved-pdf?download=1");
  await mount(page, { "content-a": [image, pdf] });
  await expect(card(page)).toContainText("1 images uploaded · 1 PDFs uploaded");
  await open(page);
  await expect(card(page).getByRole("button", { name: "Delete PDF", exact: true })).toBeVisible();
});

test("PDF deletion keeps the file on failure, then removes only the selected PDF on retry", async ({ page }) => {
  await mount(page, { "content-a": [image, pdf] }, "vi");
  await card(page).getByRole("button", { name: "Chi tiết", exact: true }).click();
  let attempts = 0;
  await page.route("**/api/media/saved-pdf", (route) => {
    expect(route.request().method()).toBe("DELETE");
    attempts++;
    return route.fulfill(attempts === 1 ? { status: 500, json: { data: null, error: { message: "Unable to delete file. Try again." } } } : { json: { data: { id: pdf.id }, error: null } });
  });
  await card(page).getByRole("button", { name: "Xóa PDF", exact: true }).click();
  await page.getByRole("dialog", { name: "Xóa PDF", exact: true }).getByRole("button", { name: "Xóa", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Xóa PDF", exact: true }).getByRole("alert")).toHaveText("Không thể xóa tệp. Hãy thử lại.");
  await expect(card(page)).toContainText("1 PDF đã tải lên");
  await page.getByRole("dialog", { name: "Xóa PDF", exact: true }).getByRole("button", { name: "Xóa", exact: true }).click();
  await expect(card(page).getByRole("button", { name: "Xóa PDF", exact: true })).toHaveCount(0);
  await expect(card(page).getByRole("img", { name: image.originalFilename, exact: true })).toBeVisible();
});

test("new content retries only the remaining PDF after a mixed upload fails", async ({ page }) => {
  let creations = 0;
  let uploads = 0;
  await mount(page);
  await page.route("**/api/content", (route) => {
    creations++;
    return route.fulfill({ json: { data: { id: "new-pdf-content", name: "PDF content", body: "Caption", linkUrl: null }, error: null } });
  });
  await page.route("**/api/content/new-pdf-content", (route) => route.fulfill({ json: { data: { id: "new-pdf-content", name: "PDF content", body: "Caption", linkUrl: null }, error: null } }));
  await page.route("**/api/media", (route) => {
    uploads++;
    return route.fulfill(uploads === 2 ? { status: 503, json: { data: null, error: { message: "Upload interrupted" } } } : { status: 201, json: { data: uploads === 1 ? image : pdf, error: null } });
  });
  await page.getByLabel("Content name", { exact: true }).fill("PDF content");
  await page.getByLabel("Caption", { exact: true }).fill("Caption");
  await page.getByLabel("Images or PDFs (optional)", { exact: true }).setInputFiles([file("photo.png"), { name: pdf.originalFilename, mimeType: "application/pdf", buffer: pdfBytes }]);
  await page.getByRole("button", { name: "Save content", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Upload interrupted");
  await expect(card(page, "PDF content")).toContainText("1 images uploaded");
  await page.getByRole("button", { name: "Save content", exact: true }).click();
  await expect(card(page, "PDF content")).toContainText("1 images uploaded · 1 PDFs uploaded");
  expect(creations).toBe(1);
  expect(uploads).toBe(3);
  await expect(page.getByRole("status")).toContainText("Content and files saved.");
});

test("multi image partial failure counts only saved files and retries remaining files", async ({ page }) => {
  let calls = 0;
  const bodies: string[] = [];
  await page.route("**/api/media", (route) => {
    calls++;
    bodies.push(route.request().postDataBuffer()!.toString());
    return route.fulfill(calls === 2 ? { status: 500, json: { data: null, error: { message: "Upload interrupted" } } } : { json: { data: { ...image, id: `upload-${calls}`, originalFilename: calls === 1 ? "first.png" : "second.png" }, error: null } });
  });
  await mount(page);
  await open(page);
  await card(page).getByLabel("Upload images or PDFs", { exact: true }).setInputFiles([file("first.png"), file("second.png")]);
  await expect(page.getByRole("alert")).toContainText("Upload interrupted");
  await expect(card(page)).toContainText("2 images uploaded");
  await expect(card(page)).toContainText("1 images waiting to upload");
  await card(page).getByRole("button", { name: "Retry remaining images" }).click();
  await expect(card(page)).toContainText("3 images uploaded");
  expect(calls).toBe(3);
  expect(bodies[2]).toContain('filename="second.png"');
  expect(bodies[2]).not.toContain('filename="first.png"');
  await expect(card(page).getByRole("button", { name: "Retry remaining images" })).toHaveCount(0);
  await expect(card(page).getByLabel("Upload images or PDFs", { exact: true })).toBeEnabled();
});

test("invalid image selection makes no request and leaves count unchanged", async ({ page }) => {
  let calls = 0;
  await page.route("**/api/media", (route) => { calls++; return route.fulfill({ status: 500 }); });
  await mount(page);
  await open(page);
  await card(page).getByLabel("Upload images or PDFs", { exact: true }).setInputFiles({ name: "bad.txt", mimeType: "text/plain", buffer: Buffer.from("invalid") });
  await expect(page.getByRole("alert")).toContainText("Upload a valid JPG, PNG, WebP, or PDF file.");
  expect(calls).toBe(0);
  await expect(card(page)).toContainText("1 images uploaded");
  await expect(card(page).getByLabel("Upload images or PDFs", { exact: true })).toBeEnabled();
});

test("uploading locks conflicting operations and reports progress", async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/media", async (route) => { await gate; await route.fulfill({ json: { data: { ...image, id: "new-image" }, error: null } }); });
  await mount(page);
  await open(page);
  await card(page).getByLabel("Upload images or PDFs", { exact: true }).setInputFiles(file("new.png"));
  await expect(card(page).getByRole("status")).toContainText("Uploading files");
  await expect(card(page).getByRole("button", { name: "Delete", exact: true })).toBeDisabled();
  await expect(card(page).getByRole("button", { name: "Edit", exact: true })).toBeDisabled();
  await expect(card(page).getByLabel("Upload images or PDFs", { exact: true })).toBeDisabled();
  release();
  await expect(card(page)).toContainText("2 images uploaded");
  await expect(card(page).getByRole("button", { name: "Delete", exact: true })).toBeEnabled();
});

test("Vietnamese labels and zero image counts are visible", async ({ page }) => {
  await mount(page, { "content-a": [] }, "vi");
  await expect(card(page)).toContainText("0 ảnh đã tải lên");
  await card(page).getByRole("button", { name: "Chi tiết", exact: true }).click();
  await expect(card(page).getByLabel("Tải ảnh hoặc PDF lên", { exact: true })).toBeVisible();
});

test("new content retries a partial upload without creating duplicate content", async ({ page }) => {
  let creations = 0;
  let updates = 0;
  let uploads = 0;
  await page.route("**/api/content", (route) => {
    creations++;
    return route.fulfill({ json: { data: { id: "new-content", name: "New content", body: "New caption", linkUrl: null }, error: null } });
  });
  await page.route("**/api/content/new-content", (route) => {
    expect(route.request().method()).toBe("PATCH");
    updates++;
    return route.fulfill({ json: { data: { id: "new-content", name: "New content", body: "New caption", linkUrl: null }, error: null } });
  });
  await page.route("**/api/media", (route) => {
    uploads++;
    return route.fulfill(uploads === 2 ? { status: 500, json: { data: null, error: { message: "Upload interrupted" } } } : { json: { data: { ...image, id: `created-image-${uploads}` }, error: null } });
  });
  await mount(page);
  await page.getByLabel("Content name", { exact: true }).fill("New content");
  await page.getByLabel("Caption", { exact: true }).fill("New caption");
  await page.locator('#contentImages').setInputFiles([file("first.png"), file("second.png")]);
  await expect(page.getByRole("status")).toContainText("2 images selected");
  await page.getByRole("button", { name: "Save content", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Upload interrupted");
  await expect(card(page, "New content")).toContainText("1 images uploaded");
  await page.getByRole("button", { name: "Save content", exact: true }).click();
  await expect(card(page, "New content")).toContainText("2 images uploaded");
  expect(creations).toBe(1);
  expect(updates).toBe(1);
  expect(uploads).toBe(3);
  await expect(page.getByRole("status")).toContainText("Content and images saved.");
});

test("content details layout fits desktop and mobile", async ({ page }) => {
  await mount(page, { "content-a": [image] }, "vi");
  let cssRoot = resolve(".next/static/chunks");
  let cssFiles: string[];
  try {
    cssFiles = await readdir(cssRoot);
  } catch {
    cssRoot = resolve(".next/dev/static/chunks");
    cssFiles = await readdir(cssRoot);
  }
  const stylesheets = cssFiles.filter((name) => name.endsWith(".css"));
  expect(stylesheets.length).toBeGreaterThan(0);
  for (const cssFile of stylesheets) {
    await page.addStyleTag({ content: await readFile(resolve(cssRoot, cssFile), "utf8") });
  }
  await page.addStyleTag({ content: (await readFile("src/app/globals.css", "utf8")).replace(/^@import.*$/m, "") });
  await page.evaluate(() => { document.getElementById("root")!.style.cssText = "max-width:1100px;margin:0 auto;padding:24px"; });
  await card(page).getByRole("button", { name: "Chi tiết", exact: true }).click();
  await expect(card(page).getByRole("img", { name: "saved.png" })).toBeVisible();
  await page.screenshot({ path: "docs/repair-evidence/content-details-desktop.png", fullPage: false });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(card(page).getByLabel("Tải ảnh hoặc PDF lên", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: "docs/repair-evidence/content-details-mobile.png", fullPage: false });
  await card(page).getByRole("button", { name: "Sửa", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Sửa nội dung", exact: true }).getByLabel("Tên nội dung", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: "docs/repair-evidence/content-popup-editor-mobile.png", fullPage: false });
});

test("deleting an image removes its preview and updates the count", async ({ page }) => {
  await mount(page);
  let deletes = 0;
  await page.route("**/api/media/saved-image", (route) => {
    if (route.request().method() !== "DELETE") return route.fulfill({ contentType: "image/png", body: png });
    deletes++;
    return route.fulfill({ json: { data: { id: image.id }, error: null } });
  });
  await open(page);
  await card(page).getByRole("button", { name: "Delete image", exact: true }).click();
  await page.getByRole("dialog", { name: "Delete image", exact: true }).getByRole("button", { name: "Cancel", exact: true }).click();
  expect(deletes).toBe(0);
  await expect(card(page)).toContainText("1 images uploaded");
  await card(page).getByRole("button", { name: "Delete image", exact: true }).click();
  await page.getByRole("dialog", { name: "Delete image", exact: true }).getByRole("button", { name: "Delete", exact: true }).click();
  await expect(card(page)).toContainText("0 images uploaded");
  await expect(card(page).getByRole("img", { name: "saved.png" })).toHaveCount(0);
  await expect(card(page).getByRole("status")).toContainText("Image deleted.");
  expect(deletes).toBe(1);
});

test("failed image deletion retains the image and count and allows retry", async ({ page }) => {
  await mount(page);
  let deletes = 0;
  await page.route("**/api/media/saved-image", (route) => {
    if (route.request().method() !== "DELETE") return route.fulfill({ contentType: "image/png", body: png });
    deletes++;
    return route.fulfill(deletes === 1 ? { status: 500, json: { data: null, error: { message: "Unable to delete image. Try again." } } } : { json: { data: { id: image.id }, error: null } });
  });
  await open(page);
  await card(page).getByRole("button", { name: "Delete image", exact: true }).click();
  await page.getByRole("dialog", { name: "Delete image", exact: true }).getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Delete image", exact: true }).getByRole("alert")).toContainText("Unable to delete image.");
  await expect(card(page)).toContainText("1 images uploaded");
  await expect(card(page).getByRole("img", { name: "saved.png" })).toBeVisible();
  await page.getByRole("dialog", { name: "Delete image", exact: true }).getByRole("button", { name: "Delete", exact: true }).click();
  await expect(card(page)).toContainText("0 images uploaded");
});

test("content edit popup saves changes and returns to details", async ({ page }) => {
  await mount(page);
  await page.route("**/api/content/content-a", (route) => {
    expect(route.request().method()).toBe("PATCH");
    expect(route.request().postDataJSON()).toMatchObject({ name: "Edited content A", body: "Edited caption A" });
    return route.fulfill({ json: { data: { id: "content-a", name: "Edited content A", body: "Edited caption A", linkUrl: "https://example.test/edited" }, error: null } });
  });
  await open(page);
  await card(page).getByRole("button", { name: "Edit", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Edit content", exact: true }).getByLabel("Content name", { exact: true })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Edit content", exact: true })).toBeVisible();
  await page.getByRole("dialog", { name: "Edit content", exact: true }).getByLabel("Content name", { exact: true }).fill("Edited content A");
  await page.getByRole("dialog", { name: "Edit content", exact: true }).getByLabel("Caption", { exact: true }).fill("Edited caption A");
  await page.getByRole("dialog", { name: "Edit content", exact: true }).getByLabel("Link (optional)", { exact: true }).fill("https://example.test/edited");
  await page.getByRole("dialog", { name: "Edit content", exact: true }).getByRole("button", { name: "Save changes", exact: true }).click();
  const updated = card(page, "Edited content A");
  await expect(updated.getByText("Edited caption A", { exact: true })).toBeVisible();
  await expect(updated.getByLabel("Content name", { exact: true })).toHaveCount(0);
  await expect(updated).toContainText("1 images uploaded");
  await expect(updated.getByRole("img", { name: "saved.png" })).toBeVisible();
  await expect(card(page, "Saved content B")).toBeVisible();
});

test("failed popup save retains entered text and closing restores the saved caption", async ({ page }) => {
  await mount(page);
  await page.route("**/api/content/content-a", (route) => route.fulfill({ status: 500, json: { data: null, error: { message: "Unable to update content." } } }));
  await open(page);
  await card(page).getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByRole("dialog", { name: "Edit content", exact: true }).getByLabel("Caption", { exact: true }).fill("Unsaved draft");
  await page.getByRole("dialog", { name: "Edit content", exact: true }).getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Edit content", exact: true }).getByRole("alert")).toContainText("Unable to update content.");
  await expect(page.getByRole("dialog", { name: "Edit content", exact: true }).getByLabel("Caption", { exact: true })).toHaveValue("Unsaved draft");
  await page.getByRole("dialog", { name: "Edit content", exact: true }).getByRole("button", { name: "Close", exact: true }).click();
  await expect(card(page).getByText("Private caption A", { exact: true })).toBeVisible();
  await expect(card(page)).toContainText("1 images uploaded");
});


test("content deletion can be cancelled and a failed confirmation permits retry", async ({ page }) => {
  await mount(page);
  let requests = 0;
  await page.route("**/api/content/content-a", (route) => {
    requests++;
    return route.fulfill(requests === 1 ? { status: 409, json: { data: null, error: { message: "Unable to delete content." } } } : { json: { data: {}, error: null } });
  });
  await open(page);
  await card(page).getByRole("button", { name: "Delete", exact: true }).click();
  const confirm = page.getByRole("dialog", { name: "Delete content", exact: true });
  await expect(confirm.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  expect(requests).toBe(0);
  await card(page).getByRole("button", { name: "Delete", exact: true }).click();
  await confirm.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(confirm.getByRole("alert")).toHaveText("Unable to delete content.");
  await confirm.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(confirm).toHaveCount(0);
  await expect(card(page)).toHaveCount(0);
  await expect(card(page, "Saved content B")).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe("");
});

test("variant edit and delete popups return to content details", async ({ page }) => {
  await mount(page);
  const variant = { id: "variant", name: "Short version", body: "Short caption" };
  await page.route("**/api/content/content-a/variants", (route) => route.fulfill({ json: { data: [variant], error: null } }));
  await page.route("**/api/content/content-a/variants/variant", (route) => route.fulfill({ json: { data: { ...variant, body: "Revised caption" }, error: null } }));
  await open(page);
  await card(page).getByRole("button", { name: "Show content variants", exact: true }).click();
  const entry = card(page).locator("section > div").filter({ has: page.getByText("Short version", { exact: true }) });
  await entry.getByRole("button", { name: "Edit", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Edit variant", exact: true });
  await editor.getByLabel("Variant caption", { exact: true }).fill("Revised caption");
  await editor.getByRole("button", { name: "Save variant", exact: true }).click();
  await expect(editor).toHaveCount(0);
  await expect(entry).toContainText("Revised caption");
  await entry.getByRole("button", { name: "Delete", exact: true }).click();
  await page.getByRole("dialog", { name: "Delete variant", exact: true }).getByRole("button", { name: "Delete", exact: true }).click();
  await expect(entry).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "Details: Saved content A", exact: true })).toBeVisible();
});


test("content popup shows duplicate errors where the action was performed", async ({ page }) => {
  await mount(page);
  await page.route("**/api/content", (route) => route.fulfill({ status: 500, json: { data: null, error: { message: "Unable to duplicate content." } } }));
  await open(page);
  await card(page).getByRole("button", { name: "Duplicate", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toHaveText("Unable to duplicate content.");
});

test("content deletion popup is localized in Vietnamese", async ({ page }) => {
  await mount(page, {}, "vi");
  await card(page).getByRole("button", { name: "Chi tiết", exact: true }).click();
  await card(page).getByRole("button", { name: "Xóa", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Xóa nội dung", exact: true })).toBeVisible();
});

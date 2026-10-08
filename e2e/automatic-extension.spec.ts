import { createServer } from "node:http";
import { resolve } from "node:path";
import { test, expect, chromium, type Route } from "@playwright/test";

for (const scenario of [{ legacyPreference: false, autoEnabled: false }, { legacyPreference: true, autoEnabled: false }, { legacyPreference: false, autoEnabled: true }]) {
const { legacyPreference, autoEnabled } = scenario;
test(`assisted campaign with legacy preference ${legacyPreference} and explicit Post switch ${autoEnabled} proceeds while Facebook resources keep loading`, async () => {
  test.setTimeout(60_000);
  const campaignId = "11111111-1111-4111-8111-111111111111";
  const caption = "First line\n\nSecond section\nLast line";
  const image = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4AWJiYGBgAAAAAP//XRcpzQAAAAZJREFUAwAADwADJDd96QAAAABJRU5ErkJggg==", "base64");
  let claimed = 0;
  const groupCount = 4;
  let failedCount = 0;
  const confirmed: string[] = [];
  const reservations: string[] = [];
  // Use a local API fixture with actual HTTP requests from the built worker.
  const server = createServer(async (request, response) => {
    response.setHeader("access-control-allow-origin", "*");
    response.setHeader("access-control-allow-headers", "authorization, content-type");
    response.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
    if (request.method === "OPTIONS") {
      response.writeHead(204).end();
      return;
    }
    if (request.headers.authorization !== "Bearer fixture-device-token") {
      response.writeHead(401).end();
      return;
    }
    const path = new URL(request.url!, "http://localhost").pathname;
    if (path.includes("/media/")) {
      response.writeHead(200, { "content-type": "image/png" }).end(image);
      return;
    }
    let data: unknown = { allowed: true };
    if (path === "/api/extension/jobs/next") {
      if (claimed === groupCount) data = { job: null, campaignStatus: "COMPLETED", remaining: 0 };
      else {
        const number = ++claimed;
        data = { job: {
          id: `job-${number}`, campaignId, claimToken: `claim-${number}`, campaign: "Loading regression",
          group: { id: `group-${number}`, name: `Group ${number}`, url: `https://www.facebook.com/groups/loading-${number}/` },
          content: { name: "Multiline content", caption, linkUrl: null, media: [{ id: "image-1", filename: "pixel.png", mimeType: "image/png" }] },
        } };
      }
    }
    if (path.endsWith("/submission")) {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const payload = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { action: string };
      if (payload.action === "begin") reservations.push(path);
    }
    if (path.endsWith("/posted")) confirmed.push(path);
    if (path === "/api/extension/campaigns" && request.method === "GET") data = {
      items: [{ id: campaignId, name: "Loading regression", status: "RUNNING", groupCount, failedCount }],
    };
    response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ data, error: null }));
  });
  await new Promise<void>((resolveReady) => server.listen(0, "127.0.0.1", resolveReady));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("API fixture did not start.");
  const extensionPath = resolve("extension/dist");
  const context = await chromium.launchPersistentContext("", {
    channel: "chromium", headless: true,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });
  let releaseResource: () => void = () => {};
  const resourceHold = new Promise<void>((done) => { releaseResource = done; });
  try {
    const routeFacebook = async (route: Route) => {
      if (new URL(route.request().url()).pathname === "/slow-image") {
        await resourceHold;
        await route.fulfill({ contentType: "image/png", body: image }).catch(() => undefined);
        return;
      }
      await route.fulfill({ contentType: "text/html; charset=utf-8", body: `
        <button id="compose">Write something...</button>
        <img src="/slow-image">
        <script>
          document.getElementById('compose').onclick = () => {
            const dialog = document.createElement('div');
            dialog.setAttribute('role', 'dialog');
            dialog.innerHTML = '<div role="textbox" contenteditable="true"></div><input type="file" accept="image/png" multiple><button id="post" disabled>Post</button>';
            document.body.append(dialog);
            const picker = dialog.querySelector('input');
            const post = dialog.querySelector('#post');
            picker.onchange = () => {
              const preview = document.createElement('img');
              preview.src = URL.createObjectURL(picker.files[0]);
              preview.width = 30; preview.height = 30;
              dialog.append(preview);
              post.disabled = false;
            };
            post.onclick = () => {
              const notice = document.createElement('div');
              notice.setAttribute('role', 'status');
              notice.textContent = 'Your post was published.';
              document.body.append(notice);
            };
          };
        </script>` });
    };
    await context.route("https://www.facebook.com/**", routeFacebook);
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${new URL(worker.url()).hostname}/src/popup/index.html`);
    // Attach routing before the extension navigates its tab; new Chrome tabs
    // can issue their first navigation before Playwright installs interception.
    const groupPage = await context.newPage();
    await groupPage.route("https://www.facebook.com/**", routeFacebook);
    await popup.evaluate(async (apiUrl) => {
      const runtime = (globalThis as unknown as { chrome: {
        storage: { local: { set: (value: unknown) => Promise<void> } };
      } }).chrome;
      await runtime.storage.local.set({ apiUrl, deviceToken: "fixture-device-token" });
    }, `http://localhost:${address.port}`);
    await worker.evaluate(async () => {
      const runtime = (globalThis as unknown as { chrome: {
        tabs: { query: (query: unknown) => Promise<Array<{ id?: number }>> };
        storage: { local: { set: (value: unknown) => Promise<void> } };
      } }).chrome;
      const tabs = await runtime.tabs.query({ url: "about:blank" });
      await runtime.storage.local.set({ automatic: { tabId: tabs[tabs.length - 1].id } });
    });
    await popup.reload();
    await expect(popup.locator("#autoCampaign")).toHaveValue(campaignId);
    await expect(popup.getByRole("switch")).not.toBeChecked();
    if (autoEnabled) {
      await popup.getByRole("switch").check();
      await expect.poll(() => worker.evaluate(async () => {
        const runtime = (globalThis as unknown as { chrome: { storage: { local: { get: (key: string) => Promise<Record<string, unknown>> } } } }).chrome;
        return (await runtime.storage.local.get("autoClickPost")).autoClickPost;
      })).toBe(true);
      await popup.reload();
      await expect(popup.getByRole("switch")).toBeChecked();
    }
    await worker.evaluate(async (enabled) => {
      await (globalThis as unknown as { chrome: { storage: { local: { set: (value: unknown) => Promise<void> } } } }).chrome.storage.local.set({ autoPublish: enabled });
    }, legacyPreference);
    const state = () => worker.evaluate(async () => {
      const runtime = (globalThis as unknown as { chrome: {
        storage: { local: { get: (key: string) => Promise<Record<string, unknown>> } };
      } }).chrome;
      return (await runtime.storage.local.get("automatic")).automatic as { phase?: string; error?: string; enabled?: boolean; attempts?: number; tabId?: number };
    });
    const start = await popup.evaluate(async (id) => {
      const runtime = (globalThis as unknown as { chrome: { runtime: { sendMessage: (value: unknown) => Promise<unknown> } } }).chrome;
      return runtime.runtime.sendMessage({ type: "AUTO_START", campaignId: id });
    }, campaignId);
    expect(start, JSON.stringify(start)).toMatchObject({ ok: true });
    for (let number = 1; !autoEnabled && number <= groupCount; number++) {
      await expect.poll(async () => {
        const current = await state();
        if (current?.error) throw new Error(current.error);
        return { phase: current?.phase, attempts: current?.attempts };
      }, { timeout: 20_000 }).toEqual({ phase: "AWAITING_USER", attempts: number });
      expect(await worker.evaluate(async () => {
        const runtime = (globalThis as unknown as { chrome: {
          tabs: { query: (query: unknown) => Promise<Array<{ status?: string }>> };
        } }).chrome;
        return (await runtime.tabs.query({ url: "https://www.facebook.com/groups/*" }))[0].status;
      })).toBe("loading");
      await expect(groupPage.getByRole("textbox")).toHaveText(caption, { useInnerText: true });
      expect(await groupPage.locator('input[type="file"]').evaluate((node: HTMLInputElement) => node.files?.[0]?.name)).toBe("pixel.png");
      expect(confirmed).toHaveLength(number - 1);
      await groupPage.getByRole("button", { name: "Post", exact: true }).click();
      await expect.poll(() => confirmed.length).toBe(number);
    }
    await expect.poll(async () => { const current = await state(); if (current?.error) throw new Error(current.error); return current?.enabled; }, { timeout: 20_000 }).toBe(false);
    expect(reservations).toHaveLength(groupCount);
    expect(confirmed).toEqual(Array.from({ length: groupCount }, (_, index) => `/api/extension/jobs/job-${index + 1}/posted`));
    await popup.screenshot({ path: `docs/repair-evidence/post-mode-${autoEnabled ? "on" : "off"}-${legacyPreference}.png` });
    await groupPage.screenshot({ path: `test-results/assisted-composer-${legacyPreference}.png` });
    // A popup already open during failure must refresh the server's failed
    // count so the user can recover without closing and reopening it.
    failedCount = 1;
    await worker.evaluate(async (id) => {
      const runtime = (globalThis as unknown as { chrome: {
        storage: { local: { set: (value: unknown) => Promise<void> } };
      } }).chrome;
      await runtime.storage.local.set({ automatic: {
        campaignId: id, enabled: false, phase: "PAUSED", attempts: 0,
        status: "Automatic posting paused for review.", error: "The Facebook Group did not finish loading.",
      } });
    }, campaignId);
    await expect(popup.locator("#autoReset")).toBeVisible();
    await expect(popup.locator("#autoRetry")).toBeHidden();
    await popup.screenshot({ path: `test-results/assisted-paused-${legacyPreference}.png` });
  } finally {
    releaseResource();
    await context.close();
    await new Promise<void>((done, reject) => server.close((error) => error ? reject(error) : done()));
  }
});
}


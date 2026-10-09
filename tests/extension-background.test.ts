import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { webcrypto } from "node:crypto";
import { transpileModule, ScriptTarget, ModuleKind } from "typescript";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Message = { type: string; enabled?: boolean; apiUrl?: string; code?: string; mediaId?: string; jobId?: string; mediaConfirmed?: boolean; campaignId?: string; outcome?: string };
type Result = { ok: boolean; error?: string; job?: unknown; dataUrl?: string };
type Listener = (message: Message, sender: unknown, reply: (value: Result) => void) => boolean;
const campaignId = "11111111-1111-4111-8111-111111111111";
const token = "test-opaque-device-token".repeat(3);
const job = { id: "job-1", campaignId, claimToken: "claim-1", campaign: "Test", group: { name: "Group", url: "https://www.facebook.com/groups/test/" }, content: { caption: "Review this caption", linkUrl: null, media: [] } };
let listener: Listener;
let saved: Record<string, unknown>;
const fetchMock = vi.fn<typeof fetch>();
const createTab = vi.fn();
const tabMessage = vi.fn();
const queryTabs = vi.fn();
let alarmListener: (alarm: { name: string }) => void;
let tabUrl: string;
let tabStatus: string;
const clearAlarm = vi.fn();

beforeEach(() => {
  vi.resetAllMocks();
  tabUrl = job.group.url;
  tabStatus = "complete";
  createTab.mockImplementation(async ({ url }: { url: string }) => { tabUrl = url; return { id: 1, url, status: "complete" }; });
  saved = { apiUrl: "http://localhost:3000", deviceToken: token, job };
  tabMessage.mockImplementation(async (_tab: number, message: { type: string }) => message.type === "PING"
    ? { ok: true, url: tabUrl, readyState: "interactive" }
    : { ok: true, clicked: true });
  queryTabs.mockResolvedValue([{ id: 1, url: job.group.url }]);
  const source = readFileSync("extension/src/background/index.ts", "utf8");
  const output = transpileModule(source, { compilerOptions: { target: ScriptTarget.ES2022, module: ModuleKind.None } }).outputText;
  runInNewContext(output, {
    URL, Response, Error, Uint8Array, setTimeout, clearTimeout, crypto: webcrypto, fetch: fetchMock,
    btoa: (value: string) => Buffer.from(value, "binary").toString("base64"),
    chrome: {
      storage: { local: {
        get: async () => ({ ...saved }),
        set: async (values: Record<string, unknown>) => { Object.assign(saved, values); },
        remove: async (keys: string | string[]) => { for (const key of typeof keys === "string" ? [keys] : keys) delete saved[key]; },
      } },
      alarms: { create: vi.fn(), clear: clearAlarm, onAlarm: { addListener: (handler: typeof alarmListener) => { alarmListener = handler; } } },
      runtime: { onMessage: { addListener: (handler: Listener) => { listener = handler; } } },
      tabs: { create: createTab, query: queryTabs, sendMessage: tabMessage, get: async () => ({ id: 1, url: tabUrl, status: tabStatus }), update: async (_id: number, value: { url?: string }) => { if (value.url) tabUrl = value.url; return { id: 1, url: tabUrl, status: tabStatus }; } },
    },
  });
});

function send(message: Message, sender: { tab?: { id: number }; url?: string } = {}) { return new Promise<Result>((resolve) => listener(message, sender, resolve)); }
function json(data: unknown, status = 200) { return Response.json({ data, error: null }, { status }); }

describe("Chrome Extension service worker", () => {
  it("pairs from the worker and stores the opaque device token", async () => {
    saved = {};
    fetchMock.mockResolvedValue(json({ deviceToken: token }));
    expect((await send({ type: "PAIR", apiUrl: "http://localhost:3000", code: "123-456" })).ok).toBe(true);
    expect(saved.deviceToken).toBe(token);
    const payload = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(payload).toEqual({ code: "123-456", name: "Chrome Extension" });
    expect(payload).not.toHaveProperty("password");
  });
  it("rejects non-HTTPS remote application URLs", async () => {
    expect((await send({ type: "PAIR", apiUrl: "http://example.com", code: "123-456" })).ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("fetches one job with bearer auth and opens its Facebook Group", async () => {
    fetchMock.mockResolvedValue(json({ job }));
    expect((await send({ type: "NEXT" })).ok).toBe(true);
    expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({ authorization: `Bearer ${token}` });
    expect(createTab).toHaveBeenCalledWith({ url: job.group.url, active: true });
    expect(saved.job).toEqual(job);
    expect(tabMessage).not.toHaveBeenCalled();
  });
  it.each([["POSTED", "posted"], ["SKIP", "skip"], ["FAILED", "failed"]])("reports the explicit %s user action and clears the job", async (type, action) => {
    fetchMock.mockResolvedValue(json({ status: action.toUpperCase() }));
    expect((await send({ type })).ok).toBe(true);
    expect(String(fetchMock.mock.calls[0][0])).toContain(`/jobs/job-1/${action}`);
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({ claimToken: job.claimToken });
    expect(saved.job).toBeUndefined();
  });
  it("clears credentials immediately when the server rejects a revoked device", async () => {
    fetchMock.mockResolvedValue(Response.json({ data: null, error: { code: "DEVICE_UNAUTHORIZED", message: "Device revoked" } }, { status: 401 }));
    expect((await send({ type: "NEXT" })).ok).toBe(false);
    expect(saved.deviceToken).toBeUndefined(); expect(saved.job).toBeUndefined();
  });
  it("prepares caption only on an explicit request and reports the composer fallback", async () => {
    tabMessage.mockResolvedValue({ ok: false });
    const result = await send({ type: "PREPARE" });
    expect(tabMessage).toHaveBeenCalledWith(1, { type: "PREPARE_CAPTION", jobId: job.id, expectedGroupUrl: job.group.url, caption: job.content.caption, linkUrl: null });
    expect(result.error).toContain("Copy the caption");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("loads media through the authenticated service worker", async () => {
    fetchMock.mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/png" } }));
    expect((await send({ type: "MEDIA", mediaId: "media-1" })).dataUrl).toBe("data:image/png;base64,AQID");
    expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({ authorization: `Bearer ${token}` });
  });
  it("disconnects local credentials", async () => {
    expect((await send({ type: "DISCONNECT" })).ok).toBe(true);
    expect(saved.deviceToken).toBeUndefined(); expect(saved.job).toBeUndefined();
  });
});

it("publishes only after a durable server reservation and does not report posted automatically", async () => {
  fetchMock.mockImplementation(async () => json({ allowed: true }));
  expect((await send({ type: "PUBLISH", jobId: job.id })).ok).toBe(true);
  expect(String(fetchMock.mock.calls[0][0])).toContain("/jobs/job-1/submission");
  expect(tabMessage).toHaveBeenCalledWith(1, expect.objectContaining({ type: "PUBLISH_POST", jobId: job.id }));
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({ action: "begin", claimToken: job.claimToken });
  expect(saved.job).toMatchObject({ publishAttempted: true });
  expect((await send({ type: "PUBLISH", jobId: job.id })).ok).toBe(false);
  expect(tabMessage).toHaveBeenCalledTimes(1);
});
it("blocks a different group before sending a Facebook action", async () => {
  queryTabs.mockResolvedValue([{ id: 1, url: "https://www.facebook.com/groups/other/" }]);
  expect((await send({ type: "PUBLISH", jobId: job.id })).ok).toBe(false);
  expect(tabMessage).not.toHaveBeenCalled(); expect(fetchMock).not.toHaveBeenCalled();
});
it("does not publish with an expired or revoked claim", async () => {
  fetchMock.mockResolvedValue(Response.json({ data: null, error: { message: "Expired claim" } }, { status: 409 }));
  expect((await send({ type: "PUBLISH", jobId: job.id })).ok).toBe(false);
  expect(tabMessage).not.toHaveBeenCalled();
});
it("allows a corrected retry only when Facebook confirms no click occurred", async () => {
  fetchMock.mockImplementation(async () => json({ allowed: true }));
  tabMessage.mockResolvedValue({ ok: false, clicked: false, message: "Button disabled" });
  expect((await send({ type: "PUBLISH", jobId: job.id })).ok).toBe(false);
  expect(saved.job).not.toHaveProperty("publishAttempted");
  expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toMatchObject({ action: "release", claimToken: job.claimToken });
});
it("keeps uncertain attempts locked instead of submitting again", async () => {
  fetchMock.mockImplementation(async () => json({ allowed: true }));
  tabMessage.mockRejectedValue(new Error("Tab closed"));
  expect((await send({ type: "PUBLISH", jobId: job.id })).ok).toBe(false);
  expect(saved.job).toMatchObject({ publishAttempted: true });
});
it("requires explicit confirmation that campaign images have been attached", async () => {
  saved.job = { ...job, content: { ...job.content, media: [{ id: "image-1" }] } };
  expect((await send({ type: "PUBLISH", jobId: job.id })).ok).toBe(false);
  expect(tabMessage).not.toHaveBeenCalled(); expect(fetchMock).not.toHaveBeenCalled();
});


describe("manual-confirmed automatic campaign (no three-group limit)", () => {
  function configure() {
    delete saved.job;
    let index = 0;
    fetchMock.mockImplementation(async (url) => {
      const path = new URL(String(url)).pathname;
      if (path === "/api/extension/campaigns") return json({ allowed: true });
      if (path === "/api/extension/jobs/next") {
        const number = ++index;
        return json({ job: { ...job, id: `automatic-${number}`, group: {
          ...job.group, url: `https://www.facebook.com/groups/auto-${number}/`
        }, content: { ...job.content, media: [{ id: "image-1", filename: "image.png", mimeType: "image/png" }] } } });
      }
      if (path.includes("/media/")) return new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/png" } });
      return json({ allowed: true });
    });
    tabMessage.mockImplementation(async (_tab: number, message: { type: string }) => message.type === "PING"
      ? { ok: true, url: tabUrl, readyState: "interactive" }
      : { ok: true });
  }
  it("reserves an early user Post click instead of failing and retrying the job", async () => {
    configure();
    tabMessage.mockImplementation(async (_tab: number, message: { type: string }) => message.type === "PING"
      ? { ok: true, url: tabUrl, readyState: "interactive" }
      : message.type === "PREPARE_CAPTION" ? { ok: false, clicked: true, reason: "ALREADY_SUBMITTED" } : { ok: true });
    await send({ type: "AUTO_START", campaignId });
    await vi.waitFor(() => expect(saved.automatic).toMatchObject({ phase: "PAUSED", enabled: false }));
    expect(saved.job).toMatchObject({ publishAttempted: true });
    expect(fetchMock.mock.calls.some(call => String(call[0]).endsWith("/submission"))).toBe(true);
    expect(fetchMock.mock.calls.some(call => String(call[0]).endsWith("/failed"))).toBe(false);
  });
  it("manual preparation warnings keep the campaign waiting for the user", async () => {
    configure();
    tabMessage.mockImplementation(async (_tab: number, message: { type: string }) => message.type === "PING"
      ? { ok: true, url: tabUrl, readyState: "interactive" }
      : { ok: true, warning: message.type === "PREPARE_CAPTION" ? "Review images manually" : undefined });
    await send({ type: "AUTO_START", campaignId });
    await vi.waitFor(() => expect(saved.automatic).toMatchObject({ phase: "AWAITING_USER", enabled: true, status: "Review images manually" }));
    expect(tabMessage).toHaveBeenCalledWith(1, expect.objectContaining({ type: "PREPARE_CAPTION", allowUnverifiedImages: true }));
    expect(tabMessage).toHaveBeenCalledWith(1, expect.objectContaining({ type: "ARM_USER_POST", allowUnverifiedImages: true }));
    expect(tabMessage.mock.calls.some(call => call[1].type === "PUBLISH_POST")).toBe(false);
    expect(fetchMock.mock.calls.some(call => String(call[0]).endsWith("/failed"))).toBe(false);
  });
  it("prepares each group for user Post click; confirms and proceeds through four groups", async () => {
    configure();
    expect((await send({ type: "AUTO_START", campaignId })).ok).toBe(true);
    for (let number = 1; number <= 4; number++) {
      await vi.waitFor(() => expect(saved.automatic).toMatchObject({ phase: "AWAITING_USER", attempts: number }));
      const current = saved.job as { id: string };
      expect(current.id).toBe(`automatic-${number}`);
      expect(tabMessage.mock.calls.some((call) => call[1].type === "PUBLISH_POST")).toBe(false);
      expect(tabMessage.mock.calls.some((call) => call[1].type === "ARM_USER_POST")).toBe(true);
      expect((await send({ type: "USER_POST_CLICKED", jobId: current.id }, { tab: { id: 1 } })).ok).toBe(true);
      await vi.waitFor(() => expect(saved.automatic).toMatchObject({ phase: "VERIFYING" }));
      expect((await send({ type: "USER_POST_RESULT", jobId: current.id, outcome: "published" }, { tab: { id: 1 } })).ok).toBe(true);
    }
    await vi.waitFor(() => expect(saved.automatic).toMatchObject({ attempts: 5, phase: "AWAITING_USER" }));
    expect(fetchMock.mock.calls.filter((call) => String(call[0]).endsWith("/posted"))).toHaveLength(4);
    const prepared = tabMessage.mock.calls.find((call) => call[1].type === "PREPARE_CAPTION")![1];
    expect(prepared.skipContentVerification).toBe(false);
    expect(prepared.attachments).toEqual([expect.objectContaining({ filename: "image.png", dataUrl: "data:image/png;base64,AQID" })]);
    expect(tabMessage.mock.calls.filter((call) => call[1].type === "PUBLISH_POST")).toHaveLength(0);
  });
  it("prepares a usable group while Chrome still reports loading", async () => {
    configure();
    tabStatus = "loading";
    await send({ type: "AUTO_START", campaignId });
    await vi.waitFor(() => expect(saved.automatic).toMatchObject({ phase: "AWAITING_USER", enabled: true }));
    expect(tabMessage).toHaveBeenCalledWith(1, expect.objectContaining({ type: "PREPARE_CAPTION" }));
  });
  it("ignores the legacy preference until the new Post switch is enabled", async () => {
    configure();
    saved.autoPublish = true;
    await send({ type: "AUTO_START", campaignId });
    await vi.waitFor(() => expect(saved.automatic).toMatchObject({ phase: "AWAITING_USER" }));
    expect(tabMessage.mock.calls.some((call) => call[1].type === "PUBLISH_POST")).toBe(false);
  });

  it.each(["unknown", "approval"])("AUTO continues after five seconds without using the %s outcome", async (outcome) => {
    configure();
    const original = fetchMock.getMockImplementation()!;
    let claims = 0;
    fetchMock.mockImplementation(async (url, init) => String(url).includes("/jobs/next") && ++claims > 1 ? json({ job: null, campaignStatus: "COMPLETED", remaining: 0 }) : original(url, init));
    await send({ type: "AUTO_SET_PUBLISH", enabled: true });
    tabMessage.mockImplementation(async (_tab: number, message: { type: string }) => message.type === "PING" ? { ok: true, url: tabUrl, readyState: "interactive" } : message.type === "PUBLISH_POST" ? { ok: true, clicked: true, outcome } : { ok: true });
    await send({ type: "AUTO_START", campaignId });
    await vi.waitFor(() => expect(saved.job).toMatchObject({ userClicked: true, autoContinueAt: expect.any(Number) }));
    expect(fetchMock.mock.calls.some(call => String(call[0]).endsWith("/posted"))).toBe(false);
    await vi.waitFor(() => expect(saved.automatic).toMatchObject({ enabled: false, status: "Automatic posting completed." }), { timeout: 8000 });
    expect(tabMessage).toHaveBeenCalledWith(1, expect.objectContaining({ type: "PREPARE_CAPTION", skipContentVerification: true }));
    expect(tabMessage).toHaveBeenCalledWith(1, expect.objectContaining({ type: "PUBLISH_POST", trackOutcome: false, skipContentVerification: true }));
    expect(tabMessage.mock.calls.filter(call => call[1].type === "PUBLISH_POST")).toHaveLength(1);
    expect(fetchMock.mock.calls.filter(call => String(call[0]).endsWith("/posted"))).toHaveLength(1);
    const completion = fetchMock.mock.calls.find(call => String(call[0]).endsWith("/posted"))!;
    expect(JSON.parse(String(completion[1]?.body))).toMatchObject({ confirmationSource: "automatic_unverified" });
    expect(saved.job).toBeUndefined();
  }, 12_000);

  it("unchecked AUTO completes four groups without publication notices", async () => {
    configure();
    const original = fetchMock.getMockImplementation()!;
    let claims = 0;
    fetchMock.mockImplementation(async (url, init) => {
      if (String(url).includes("/jobs/next") && ++claims > 4) return json({ job: null, campaignStatus: "COMPLETED", remaining: 0 });
      return original(url, init);
    });
    await send({ type: "AUTO_SET_PUBLISH", enabled: true });
    tabMessage.mockImplementation(async (_tab: number, message: { type: string }) => message.type === "PING" ? { ok: true, url: tabUrl, readyState: "interactive" } : message.type === "PUBLISH_POST" ? { ok: true, clicked: true, outcome: "published" } : { ok: true });
    await send({ type: "AUTO_START", campaignId });
    await vi.waitFor(() => expect(saved.automatic).toMatchObject({ enabled: false, status: "Automatic posting completed.", attempts: 4 }), { timeout: 26_000 });
    expect(tabMessage.mock.calls.filter((call) => call[1].type === "PUBLISH_POST")).toHaveLength(4);
    expect(fetchMock.mock.calls.filter((call) => String(call[0]).endsWith("/posted"))).toHaveLength(4);
    expect(saved.job).toBeUndefined();
  }, 30_000);
  it("lost automatic submit response keeps the reservation and prevents another attempt", async () => {
    configure();
    await send({ type: "AUTO_SET_PUBLISH", enabled: true });
    tabMessage.mockImplementation(async (_tab: number, message: { type: string }) => {
      if (message.type === "PING") return { ok: true, url: tabUrl, readyState: "interactive" };
      if (message.type === "PUBLISH_POST") throw new Error("Connection interrupted after dispatch");
      return { ok: true };
    });
    await send({ type: "AUTO_START", campaignId });
    await vi.waitFor(() => expect(saved.automatic).toMatchObject({ enabled: false, phase: "PAUSED", errorCode: "POST_OUTCOME_UNKNOWN" }));
    expect(saved.job).toMatchObject({ publishAttempted: true });
    expect(fetchMock.mock.calls.some((call) => JSON.parse(String(call[1]?.body ?? "{}" )).action === "release")).toBe(false);
    expect((await send({ type: "AUTO_START", campaignId })).ok).toBe(false);
  });
  it("allows toggling off before starting and rejects a tab changing the preference", async () => {
    configure();
    expect((await send({ type: "AUTO_SET_PUBLISH", enabled: true }, { tab: { id: 1 } })).ok).toBe(false);
    expect((await send({ type: "AUTO_SET_PUBLISH", enabled: true })).ok).toBe(true);
    expect((await send({ type: "AUTO_SET_PUBLISH", enabled: false })).ok).toBe(true);
    await send({ type: "AUTO_START", campaignId });
    await vi.waitFor(() => expect(saved.automatic).toMatchObject({ phase: "AWAITING_USER", autoClickPost: false }));
    expect((await send({ type: "AUTO_SET_PUBLISH", enabled: true })).ok).toBe(false);
    expect(tabMessage.mock.calls.some((call) => call[1].type === "PUBLISH_POST")).toBe(false);
  });
  it("waits for the new document instead of trusting an old group's adapter", async () => {
    configure();
    let pings = 0;
    tabMessage.mockImplementation(async (_tab: number, message: { type: string }) => message.type === "PING"
      ? { ok: true, url: ++pings === 1 ? job.group.url : tabUrl, readyState: "interactive" }
      : { ok: true });
    await send({ type: "AUTO_START", campaignId });
    await vi.waitFor(() => expect(saved.automatic).toMatchObject({ phase: "AWAITING_USER" }), { timeout: 2000 });
    expect(pings).toBe(2);
  });
  it.each(["unknown", "approval"])("stops on %s and does not record success", async (outcome) => {
    configure();
    await send({ type: "AUTO_START", campaignId });
    await vi.waitFor(() => expect(saved.automatic).toMatchObject({ phase: "AWAITING_USER" }));
    const current = saved.job as { id: string; publishAttempted: boolean };
    await send({ type: "USER_POST_CLICKED", jobId: current.id }, { tab: { id: 1 } });
    await send({ type: "USER_POST_RESULT", jobId: current.id, outcome }, { tab: { id: 1 } });
    await vi.waitFor(() => expect(saved.automatic).toMatchObject({ enabled: false, phase: "PAUSED" }));
    expect(saved.job).toMatchObject({ publishAttempted: true });
    expect(fetchMock.mock.calls.some((call) => String(call[0]).endsWith("/posted"))).toBe(false);
  });
  it("shows a recording failure instead of silently staying in verification", async () => {
    configure();
    await send({ type: "AUTO_START", campaignId });
    await vi.waitFor(() => expect(saved.automatic).toMatchObject({ phase: "AWAITING_USER" }));
    const current = saved.job as { id: string };
    await send({ type: "USER_POST_CLICKED", jobId: current.id }, { tab: { id: 1 } });
    fetchMock.mockRejectedValue(new Error("Connection lost while recording publication"));
    expect(await send({ type: "USER_POST_RESULT", jobId: current.id, outcome: "published" }, { tab: { id: 1 } })).toMatchObject({ ok: false });
    expect(saved.automatic).toMatchObject({ enabled: false, phase: "PAUSED", error: "Connection lost while recording publication" });
    expect(saved.job).toMatchObject({ id: current.id, publishAttempted: true });
  });
  it("rejects forged or wrong-tab submission events", async () => {
    configure();
    await send({ type: "AUTO_START", campaignId });
    await vi.waitFor(() => expect(saved.automatic).toMatchObject({ phase: "AWAITING_USER" }));
    expect((await send({ type: "USER_POST_CLICKED", jobId: (saved.job as {id:string}).id }, { tab: { id: 99 } })).ok).toBe(false);
    expect(saved.automatic).toMatchObject({ phase: "AWAITING_USER" });
  });
  it("cancels the campaign via server and cancels local monitoring", async () => {
    configure();
    await send({ type: "AUTO_START", campaignId });
    await vi.waitFor(() => expect(saved.automatic).toMatchObject({ phase: "AWAITING_USER" }));
    const result = await send({ type: "AUTO_CANCEL_CAMPAIGN" });
    expect(result.ok).toBe(true);
    expect(saved.automatic).toMatchObject({ enabled: false, status: "Campaign cancelled." });
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes("/campaigns/cancel"))).toBe(true);
  });
  it("resets only failed jobs through authenticated endpoint", async () => {
    saved.automatic = { runId: "run-test", campaignId, enabled: false, phase: "PAUSED", attempts: 1, status: "Automatic posting stopped." };
    fetchMock.mockResolvedValue(json({ reset: 2 }));
    const result = await send({ type: "AUTO_RESET_FAILED" });
    expect(result.ok).toBe(true);
    expect(String(fetchMock.mock.calls[0][0])).toContain("/api/extension/campaigns/reset");
    expect(saved.automatic).toMatchObject({ enabled: false, status: "Failed groups reset. Start the campaign to continue." });
  });
  it("keeps uncertain job reserved after restart", async () => {
    saved.job = { ...job, publishAttempted: true };
    expect((await send({ type: "AUTO_START", campaignId })).ok).toBe(false);
    expect(tabMessage).not.toHaveBeenCalled();
  });
  it("stops while preparing and never clicks Post", async () => {
    configure();
    let finish: (result: { ok: boolean }) => void = () => {};
    tabMessage.mockImplementation(async (_tab: number, message: { type: string }) =>
      message.type === "PREPARE_CAPTION"
        ? new Promise((resolve) => { finish = resolve; })
        : message.type === "PING" ? { ok: true, url: tabUrl, readyState: "interactive" } : { ok: true }
    );
    await send({ type: "AUTO_START", campaignId });
    await vi.waitFor(() => expect(tabMessage).toHaveBeenCalledWith(1, expect.objectContaining({ type: "PREPARE_CAPTION" })));
    expect((await send({ type: "AUTO_STOP" })).ok).toBe(true);
    finish({ ok: true });
    await vi.waitFor(() => expect(saved.automatic).toMatchObject({ enabled: false }));
    expect(tabMessage.mock.calls.some((call) => call[1].type === "PUBLISH_POST")).toBe(false);
  });
});

it("keeps the local attempt locked when the server cannot release a no-click reservation", async () => {
  fetchMock.mockResolvedValueOnce(json({ allowed: true })).mockRejectedValueOnce(new Error("Connection lost"));
  tabMessage.mockResolvedValue({ ok: false, clicked: false, message: "Button disabled" });
  expect((await send({ type: "PUBLISH", jobId: job.id })).ok).toBe(false);
  expect(saved.job).toMatchObject({ publishAttempted: true });
  expect((await send({ type: "PUBLISH", jobId: job.id })).ok).toBe(false);
  expect(tabMessage).toHaveBeenCalledTimes(1);
});

it("worker restart pauses an uncertain post instead of starting another group", async () => {
  saved.automatic = { runId: "restart", campaignId, enabled: true, phase: "AWAITING_USER", attempts: 1, tabId: 1, jobId: job.id };
  saved.job = { ...job, publishAttempted: true };
  alarmListener({ name: "groupflow-automatic" });
  await vi.waitFor(() => expect(saved.automatic).toMatchObject({ enabled: false, phase: "PAUSED" }));
  expect(saved.job).toMatchObject({ publishAttempted: true });
  expect(fetchMock).not.toHaveBeenCalled();
});

it("manual prepare cannot refill a reserved or uncertain job", async () => {
  saved.job = { ...job, publishAttempted: true };
  expect((await send({ type: "PREPARE" })).ok).toBe(false);
  expect(tabMessage).not.toHaveBeenCalled();
});

it("durably reserves upload once and rejects another document or worker attempt", async () => {
  saved.automatic = { runId: "upload", campaignId, enabled: true, phase: "PREPARING", attempts: 0, tabId: 1, jobId: job.id };
  const sender = { tab: { id: 1 }, url: job.group.url };
  expect(await send({ type: "UPLOAD_BEGIN", jobId: job.id }, sender)).toMatchObject({ ok: true });
  expect(saved.uploadReservations).toEqual({ [job.id]: true });
  expect(await send({ type: "UPLOAD_BEGIN", jobId: job.id }, sender)).toMatchObject({ ok: false });
  expect(fetchMock).not.toHaveBeenCalled();
});

it("rejects upload reservation from another tab or group", async () => {
  saved.automatic = { runId: "upload", campaignId, enabled: true, phase: "PREPARING", attempts: 0, tabId: 1, jobId: job.id };
  expect((await send({ type: "UPLOAD_BEGIN", jobId: job.id }, { tab: { id: 2 }, url: job.group.url })).ok).toBe(false);
  expect((await send({ type: "UPLOAD_BEGIN", jobId: job.id }, { tab: { id: 1 }, url: "https://www.facebook.com/groups/other/" })).ok).toBe(false);
  expect(saved.uploadReservations).toBeUndefined();
});

it("uncertain dispatched preparation retains the claim for manual recovery", async () => {
  saved.uploadReservations = { [job.id]: true };
  fetchMock.mockResolvedValue(json({ allowed: true }));
  tabMessage.mockImplementation(async (_tab: number, message: { type: string }) => message.type === "PING" ? { ok: true, url: tabUrl, readyState: "interactive" } : message.type === "PREPARE_CAPTION" ? { ok: false, clicked: false, reason: "UPLOAD_PREVIEW_UNVERIFIED", message: "Review attached images." } : { ok: true });
  await send({ type: "AUTO_START", campaignId });
  await vi.waitFor(() => expect(saved.automatic).toMatchObject({ enabled: false, errorCode: "UPLOAD_PREVIEW_UNVERIFIED" }));
  expect(saved.job).toMatchObject({ id: job.id, claimToken: job.claimToken });
  expect(fetchMock.mock.calls.some(call => String(call[0]).endsWith("/failed"))).toBe(false);
  expect(tabMessage.mock.calls.some(call => call[1].type === "PUBLISH_POST")).toBe(false);
});

it.each(["PREPARING", "OPENING"])("human click stays durable in %s when backend reservation fails", async (phase) => {
  saved.automatic = { runId: "early", campaignId, enabled: true, phase, attempts: 0, tabId: 1, jobId: job.id };
  fetchMock.mockRejectedValue(new Error("Connection lost"));
  expect((await send({ type: "PREPARATION_POST_CLICKED", jobId: job.id }, { tab: { id: 1 }, url: job.group.url })).ok).toBe(false);
  expect(saved.job).toMatchObject({ id: job.id, publishAttempted: true });
  expect((await send({ type: "PUBLISH", jobId: job.id })).ok).toBe(false);
});

it("stopping during post-click delay prevents completion and the next group", async () => {
  saved.job = { ...job, publishAttempted: true, userClicked: true, autoContinueAt: Date.now() + 5000 };
  saved.automatic = { runId: "stop-delay", campaignId, enabled: true, autoClickPost: true, phase: "VERIFYING", tabId: 1, jobId: job.id, attempts: 1 };
  alarmListener({ name: "groupflow-automatic" });
  await vi.waitFor(() => expect(tabMessage).toHaveBeenCalledWith(1, expect.objectContaining({ type: "AUTO_PROGRESS" })));
  await send({ type: "AUTO_STOP" });
  await new Promise(resolve => setTimeout(resolve, 350));
  expect(saved.job).toMatchObject({ publishAttempted: true, userClicked: true });
  expect(fetchMock.mock.calls.some(call => String(call[0]).endsWith("/posted"))).toBe(false);
  expect(createTab).not.toHaveBeenCalled();
});

it("restart completes a durably recorded AUTO click without clicking again", async () => {
  saved.job = { ...job, publishAttempted: true, userClicked: true, autoContinueAt: Date.now() - 1 };
  saved.automatic = { runId: "restart-delay", campaignId, enabled: true, autoClickPost: true, phase: "VERIFYING", tabId: 1, jobId: job.id, attempts: 1 };
  fetchMock.mockImplementation(async url => String(url).includes("/jobs/next") ? json({ job: null, campaignStatus: "COMPLETED", remaining: 0 }) : json({ allowed: true }));
  alarmListener({ name: "groupflow-automatic" });
  await vi.waitFor(() => expect(saved.automatic).toMatchObject({ enabled: false, status: "Automatic posting completed." }));
  expect(fetchMock.mock.calls.filter(call => String(call[0]).endsWith("/posted"))).toHaveLength(1);
  expect(tabMessage.mock.calls.some(call => call[1].type === "PUBLISH_POST")).toBe(false);
});

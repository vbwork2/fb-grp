import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { webcrypto } from "node:crypto";
import { transpileModule, ScriptTarget, ModuleKind } from "typescript";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Message = { type: string; apiUrl?: string; code?: string; mediaId?: string; jobId?: string; mediaConfirmed?: boolean; campaignId?: string };
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
const clearAlarm = vi.fn();

beforeEach(() => {
  vi.resetAllMocks();
  tabUrl = job.group.url;
  createTab.mockImplementation(async ({ url }: { url: string }) => { tabUrl = url; return { id: 1, url, status: "complete" }; });
  saved = { apiUrl: "http://localhost:3000", deviceToken: token, job };
  tabMessage.mockResolvedValue({ ok: true, clicked: true });
  queryTabs.mockResolvedValue([{ id: 1, url: job.group.url }]);
  const source = readFileSync("extension/src/background/index.ts", "utf8");
  const output = transpileModule(source, { compilerOptions: { target: ScriptTarget.ES2022, module: ModuleKind.None } }).outputText;
  runInNewContext(output, {
    URL, Response, Uint8Array, setTimeout, clearTimeout, crypto: webcrypto, fetch: fetchMock,
    btoa: (value: string) => Buffer.from(value, "binary").toString("base64"),
    chrome: {
      storage: { local: {
        get: async () => ({ ...saved }),
        set: async (values: Record<string, unknown>) => { Object.assign(saved, values); },
        remove: async (keys: string | string[]) => { for (const key of typeof keys === "string" ? [keys] : keys) delete saved[key]; },
      } },
      alarms: { create: vi.fn(), clear: clearAlarm, onAlarm: { addListener: (handler: typeof alarmListener) => { alarmListener = handler; } } },
      runtime: { onMessage: { addListener: (handler: Listener) => { listener = handler; } } },
      tabs: { create: createTab, query: queryTabs, sendMessage: tabMessage, get: async () => ({ id: 1, url: tabUrl, status: "complete" }), update: async (_id: number, value: { url: string }) => { tabUrl = value.url; return { id: 1, url: value.url, status: "complete" }; } },
    },
  });
});

function send(message: Message) { return new Promise<Result>((resolve) => listener(message, {}, resolve)); }
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

it("publishes only after a valid claim check and does not report posted automatically", async () => {
  fetchMock.mockResolvedValue(json({ allowed: true }));
  expect((await send({ type: "PUBLISH", jobId: job.id })).ok).toBe(true);
  expect(String(fetchMock.mock.calls[0][0])).toContain("/jobs/job-1/validate");
  expect(tabMessage).toHaveBeenCalledWith(1, expect.objectContaining({ type: "PUBLISH_POST", jobId: job.id }));
  expect(fetchMock).toHaveBeenCalledTimes(1);
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
  fetchMock.mockResolvedValue(json({ allowed: true }));
  tabMessage.mockResolvedValue({ ok: false, clicked: false, message: "Button disabled" });
  expect((await send({ type: "PUBLISH", jobId: job.id })).ok).toBe(false);
  expect(saved.job).not.toHaveProperty("publishAttempted");
});
it("keeps uncertain attempts locked instead of submitting again", async () => {
  fetchMock.mockResolvedValue(json({ allowed: true }));
  tabMessage.mockRejectedValue(new Error("Tab closed"));
  expect((await send({ type: "PUBLISH", jobId: job.id })).ok).toBe(false);
  expect(saved.job).toMatchObject({ publishAttempted: true });
});
it("requires explicit confirmation that campaign images have been attached", async () => {
  saved.job = { ...job, content: { ...job.content, media: [{ id: "image-1" }] } };
  expect((await send({ type: "PUBLISH", jobId: job.id })).ok).toBe(false);
  expect(tabMessage).not.toHaveBeenCalled(); expect(fetchMock).not.toHaveBeenCalled();
});


describe("approved three-group automatic run", () => {
  function configure(outcome = "published") {
    delete saved.job;
    let index = 0;
    fetchMock.mockImplementation(async (url) => {
      const path = new URL(String(url)).pathname;
      if (path === "/api/extension/campaigns") return json({ allowed: true, maxGroups: 3 });
      if (path === "/api/extension/jobs/next") return json({ job: { ...job, id: `automatic-${++index}`, group: { ...job.group, url: `https://www.facebook.com/groups/auto-${index}/` }, content: { ...job.content, media: [{ id: "image-1", filename: "image.png", mimeType: "image/png" }] } } });
      if (path.includes("/media/")) return new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/png" } });
      return json({ allowed: true });
    });
    tabMessage.mockImplementation(async (_tab: number, message: { type: string }) => message.type === "PUBLISH_POST" ? { ok: true, clicked: true, outcome } : { ok: true });
  }
  it("uploads images, records verified results and stops after three groups", async () => {
    configure();
    expect((await send({ type: "AUTO_START", campaignId })).ok).toBe(true);
    await vi.waitFor(() => expect(saved.automatic).toMatchObject({ phase: "WAITING", attempts: 1 }));
    alarmListener({ name: "groupflow-automatic" });
    await vi.waitFor(() => expect(saved.automatic).toMatchObject({ phase: "WAITING", attempts: 2 }));
    alarmListener({ name: "groupflow-automatic" });
    await vi.waitFor(() => expect(saved.automatic).toMatchObject({ enabled: false, attempts: 3 }));
    alarmListener({ name: "groupflow-automatic" });
    await Promise.resolve();
    const submissions = tabMessage.mock.calls.filter((call) => call[1].type === "PUBLISH_POST");
    expect(submissions).toHaveLength(3);
    const prepared = tabMessage.mock.calls.find((call) => call[1].type === "PREPARE_CAPTION")![1];
    expect(prepared.attachments).toEqual([expect.objectContaining({ filename: "image.png", dataUrl: "data:image/png;base64,AQID" })]);
    expect(fetchMock.mock.calls.filter((call) => String(call[0]).endsWith("/posted"))).toHaveLength(3);
    expect(fetchMock.mock.calls.filter((call) => String(call[0]).includes("/jobs/next"))).toHaveLength(3);
    expect(saved.job).toBeUndefined();
  });
  it.each(["unknown", "approval"])("pauses on %s without recording success or trying another group", async (outcome) => {
    configure(outcome);
    await send({ type: "AUTO_START", campaignId });
    await vi.waitFor(() => expect(saved.automatic).toMatchObject({ enabled: false, phase: "PAUSED" }));
    expect(saved.job).toMatchObject({ publishAttempted: true });
    expect(fetchMock.mock.calls.some((call) => String(call[0]).endsWith("/posted"))).toBe(false);
    expect(tabMessage.mock.calls.filter((call) => call[1].type === "PUBLISH_POST")).toHaveLength(1);
    expect((await send({ type: "NEXT" })).ok).toBe(false);
    expect(saved.job).toMatchObject({ publishAttempted: true });
  });
  it("does not bypass a server rejection of a campaign above the limit", async () => {
    delete saved.job;
    fetchMock.mockResolvedValue(Response.json({ data: null, error: { message: "Maximum three groups" } }, { status: 409 }));
    expect((await send({ type: "AUTO_START", campaignId })).ok).toBe(false);
    expect(createTab).not.toHaveBeenCalled(); expect(tabMessage).not.toHaveBeenCalled();
  });
  it("does not retry a durable uncertain attempt after worker restart", async () => {
    saved.job = { ...job, publishAttempted: true };
    expect((await send({ type: "AUTO_START", campaignId })).ok).toBe(false);
    expect(tabMessage).not.toHaveBeenCalled(); expect(fetchMock).not.toHaveBeenCalled();
  });
  it("stops during preparation without issuing a publish request", async () => {
    configure();
    let finish: (result: { ok: boolean }) => void = () => {};
    tabMessage.mockImplementation(async (_tab: number, message: { type: string }) => message.type === "PREPARE_CAPTION" ? new Promise((resolve) => { finish = resolve; }) : { ok: true });
    await send({ type: "AUTO_START", campaignId });
    await vi.waitFor(() => expect(tabMessage).toHaveBeenCalledWith(1, expect.objectContaining({ type: "PREPARE_CAPTION" })));
    expect((await send({ type: "AUTO_STOP" })).ok).toBe(true);
    finish({ ok: true });
    await vi.waitFor(() => expect(saved.automatic).toMatchObject({ enabled: false }));
    expect(tabMessage.mock.calls.some((call) => call[1].type === "PUBLISH_POST")).toBe(false);
  });
});

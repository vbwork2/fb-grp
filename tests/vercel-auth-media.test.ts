import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { devices, media, passwordResets } from "../src/lib/db/schema";

const state = vi.hoisted(() => ({ db: undefined as unknown, cookie: "", cookieOptions: {} as Record<string, unknown>, images: new Map<string, Uint8Array>() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: state.db }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => state.cookie ? { value: state.cookie } : undefined, set: (_name: string, value: string, options: Record<string, unknown>) => { state.cookie = value; state.cookieOptions = options; } }) }));
vi.mock("@/lib/email", () => ({ sendPasswordResetEmail: vi.fn() }));
vi.mock("@/lib/storage", () => ({
  putMedia: vi.fn(async (key: string, bytes: Uint8Array) => { state.images.set(key, bytes); }),
  getMedia: vi.fn(async (key: string) => state.images.get(key) ?? null),
  deleteMedia: vi.fn(async (key: string) => { state.images.delete(key); }),
}));
const client = new PGlite(); const db = drizzle({ client }); state.db = db;
const request = (path: string, body?: unknown, method = "POST") => new Request("https://app.example" + path, { method, headers: { origin: "https://app.example", host: "app.example", "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const password = "ControlledPass123";
async function register(email = "owner@example.test") {
  const { POST } = await import("../src/app/api/auth/register/route");
  const result = await POST(request("/api/auth/register", { email, password, displayName: "Fixture" }));
  expect(result.status).toBe(201); return (await result.json()).data as { id: string; workspaceId: string };
}
beforeAll(async () => {
  vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("AUTH_SECRET", "isolated-test-secret-at-least-32-characters"); vi.stubEnv("APP_URL", "https://app.example");
  const root = resolve("netlify/database/migrations");
  for (const directory of (await readdir(root, { withFileTypes: true })).filter(item => item.isDirectory()).map(item => item.name).sort()) {
    await client.exec((await readFile(resolve(root, directory, "migration.sql"), "utf8")).replaceAll("--> statement-breakpoint", ""));
  }
});
beforeEach(async () => { await client.exec("TRUNCATE users CASCADE; TRUNCATE rate_limits"); state.cookie = ""; state.images.clear(); vi.clearAllMocks(); });
afterAll(async () => { vi.unstubAllEnvs(); await client.close(); });

it("registers, signs a secure production session, logs out and logs back in", async () => {
  const account = await register();
  const { getIdentity } = await import("../src/lib/auth/session");
  expect(await getIdentity()).toMatchObject({ userId: account.id, workspaceId: account.workspaceId });
  expect(state.cookieOptions).toMatchObject({ secure: true, httpOnly: true, sameSite: "lax" });
  const logout = await import("../src/app/api/auth/logout/route");
  expect((await logout.POST(request("/api/auth/logout"))).status).toBe(200); expect(await getIdentity()).toBeNull();
  const login = await import("../src/app/api/auth/login/route");
  expect((await login.POST(request("/api/auth/login", { email: "owner@example.test", password: "WrongPass123" }))).status).toBe(401);
  expect((await login.POST(request("/api/auth/login", { email: "owner@example.test", password }))).status).toBe(200);
  expect(await getIdentity()).toMatchObject({ userId: account.id });
});

it("rejects foreign origins and enforces shared database login rate limits", async () => {
  const registerRoute = await import("../src/app/api/auth/register/route");
  const foreign = new Request("https://app.example/api/auth/register", { method: "POST", headers: { host: "app.example", origin: "https://foreign.example" } });
  expect((await registerRoute.POST(foreign)).status).toBe(403);
  await register(); const login = await import("../src/app/api/auth/login/route");
  for (let index = 0; index < 10; index++) expect((await login.POST(request("/api/auth/login", { email: "owner@example.test", password: "WrongPass123" }))).status).toBe(401);
  expect((await login.POST(request("/api/auth/login", { email: "owner@example.test", password }))).status).toBe(429);
});

it("resets a password once and invalidates the previous signed session", async () => {
  await register(); const oldCookie = state.cookie;
  const forgot = await import("../src/app/api/auth/forgot-password/route");
  expect((await forgot.POST(request("/api/auth/forgot-password", { email: "owner@example.test" }))).status).toBe(200);
  const { sendPasswordResetEmail } = await import("../src/lib/email");
  const token = new URL(vi.mocked(sendPasswordResetEmail).mock.calls[0][1]).searchParams.get("token");
  const reset = await import("../src/app/api/auth/reset-password/route");
  expect((await reset.POST(request("/api/auth/reset-password", { token, password: "NewControlledPass123" }))).status).toBe(200);
  state.cookie = oldCookie;
  expect(await (await import("../src/lib/auth/session")).getIdentity()).toBeNull();
  expect((await reset.POST(request("/api/auth/reset-password", { token, password: "NewControlledPass123" }))).status).toBe(400);
  expect((await db.select().from(passwordResets))[0].usedAt).not.toBeNull();
});

it("pairs once, stores only a token hash and rejects expired and revoked devices", async () => {
  await register(); const codes = await import("../src/app/api/devices/pairing-code/route");
  const code = (await (await codes.POST(request("/api/devices/pairing-code"))).json()).data.code;
  const pair = await import("../src/app/api/extension/pair/route");
  const response = await pair.POST(request("/api/extension/pair", { code })); expect(response.status).toBe(201);
  const paired = (await response.json()).data;
  const authorization = new Request("https://app.example/api/extension/media", { headers: { authorization: "Bearer " + paired.deviceToken } });
  const { getDevice } = await import("../src/lib/auth/device");
  expect(await getDevice(authorization)).toMatchObject({ id: paired.deviceId });
  expect((await db.select().from(devices))[0].tokenHash).not.toContain(paired.deviceToken);
  expect((await pair.POST(request("/api/extension/pair", { code }))).status).toBe(401);
  await db.update(devices).set({ expiresAt: new Date(0) }).where(eq(devices.id, paired.deviceId)); expect(await getDevice(authorization)).toBeNull();
  await db.update(devices).set({ expiresAt: new Date(Date.now() + 60000) }).where(eq(devices.id, paired.deviceId));
  const revoke = await import("../src/app/api/devices/route");
  expect((await revoke.DELETE(request("/api/devices", { id: paired.deviceId }, "DELETE"))).status).toBe(200); expect(await getDevice(authorization)).toBeNull();
});

it("uploads private media and checks session and device workspace before fetching bytes", async () => {
  const owner = await register(); const ownerCookie = state.cookie;
  const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const form = new FormData(); form.set("file", new File([bytes], "fixture.png", { type: "image/png" }));
  const upload = await import("../src/app/api/media/route");
  const result = await upload.POST(new Request("https://app.example/api/media", { method: "POST", headers: { origin: "https://app.example", host: "app.example" }, body: form }));
  expect(result.status).toBe(201); const image = (await result.json()).data;
  const context = { params: Promise.resolve({ id: image.id }) };
  const route = await import("../src/app/api/media/[id]/route");
  const response = await route.GET(request("/api/media/" + image.id, undefined, "GET"), context);
  expect(response.status).toBe(200); expect(response.headers.get("content-type")).toBe("image/png"); expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
  state.cookie = ""; expect((await route.GET(request("/api/media/" + image.id, undefined, "GET"), context)).status).toBe(401);
  await register("foreign@example.test");
  const { getMedia } = await import("../src/lib/storage"); vi.mocked(getMedia).mockClear();
  expect((await route.GET(request("/api/media/" + image.id, undefined, "GET"), context)).status).toBe(404); expect(getMedia).not.toHaveBeenCalled();
  state.cookie = ownerCookie;
  const codeRoute = await import("../src/app/api/devices/pairing-code/route");
  const code = (await (await codeRoute.POST(request("/api/devices/pairing-code"))).json()).data.code;
  const pairRoute = await import("../src/app/api/extension/pair/route");
  const token = (await (await pairRoute.POST(request("/api/extension/pair", { code }))).json()).data.deviceToken;
  const extensionRoute = await import("../src/app/api/extension/media/[id]/route");
  const deviceRequest = new Request("https://app.example/api/extension/media/" + image.id, { headers: { authorization: "Bearer " + token } });
  expect((await extensionRoute.GET(deviceRequest, context)).status).toBe(200);
  await db.update(media).set({ workspaceId: (await register("third@example.test")).workspaceId }).where(eq(media.id, image.id));
  vi.mocked(getMedia).mockClear(); expect((await extensionRoute.GET(deviceRequest, context)).status).toBe(404); expect(getMedia).not.toHaveBeenCalled();
  expect(owner.workspaceId).not.toBe((await db.select().from(media))[0].workspaceId);
});

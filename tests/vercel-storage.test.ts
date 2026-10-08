import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@vercel/blob", () => ({ put: vi.fn(), get: vi.fn(), del: vi.fn() }));
import { put, get, del } from "@vercel/blob";
import { putMedia, getMedia, deleteMedia } from "../src/lib/storage";
import { clientIp } from "../src/lib/security/client-ip";
import { databaseConnectionString } from "../src/lib/db/connection";

beforeEach(() => { vi.stubEnv("NODE_ENV", "production"); vi.clearAllMocks(); });
afterEach(() => vi.unstubAllEnvs());
describe("private Blob storage", () => {
  it.each(["image/jpeg", "image/png", "image/webp"])("uploads %s privately without changing the database key", async mimeType => {
    await putMedia("image-key", new Uint8Array([1, 2]), { mimeType });
    expect(put).toHaveBeenCalledWith("image-key", expect.any(ArrayBuffer), { access: "private", addRandomSuffix: false, allowOverwrite: false, contentType: mimeType });
  });
  it("reads authenticated bytes and distinguishes absence from failure", async () => {
    vi.mocked(get).mockResolvedValueOnce({ statusCode: 200, stream: new Blob([new Uint8Array([1, 2, 3])]).stream() } as Awaited<ReturnType<typeof get>>);
    expect(await getMedia("image-key")).toEqual(new Uint8Array([1, 2, 3]));
    expect(get).toHaveBeenCalledWith("image-key", { access: "private", useCache: false });
    vi.mocked(get).mockResolvedValueOnce(null);
    expect(await getMedia("image-key")).toBeNull();
    vi.mocked(get).mockRejectedValueOnce(new Error("Storage unavailable"));
    await expect(getMedia("image-key")).rejects.toThrow("Storage unavailable");
  });
  it("deletes by pathname and propagates errors to preserve metadata", async () => {
    await deleteMedia("image-key"); expect(del).toHaveBeenCalledWith("image-key");
    vi.mocked(del).mockRejectedValueOnce(new Error("Storage unavailable"));
    await expect(deleteMedia("image-key")).rejects.toThrow();
  });
  it.each(["../secret", "https://other.example/file", "", "folder/image"])("rejects unsafe key %s before accessing storage", async key => {
    await expect(putMedia(key, new Uint8Array(), {})).rejects.toThrow("Invalid storage key");
    await expect(getMedia(key)).rejects.toThrow("Invalid storage key");
    await expect(deleteMedia(key)).rejects.toThrow("Invalid storage key");
    expect(put).not.toHaveBeenCalled(); expect(get).not.toHaveBeenCalled(); expect(del).not.toHaveBeenCalled();
  });
});
describe("Vercel request identity", () => {
  it("trusts only Vercel's validated platform IP", () => {
    vi.stubEnv("VERCEL", "1");
    const request = new Request("https://app.example", { headers: { "x-vercel-forwarded-for": "203.0.113.7", "x-forwarded-for": "1.1.1.1", "x-nf-client-connection-ip": "2.2.2.2" } });
    expect(clientIp(request)).toBe("203.0.113.7");
    expect(clientIp(new Request("https://app.example", { headers: { "x-vercel-forwarded-for": "forged" } }))).toBe("unknown");
    vi.stubEnv("VERCEL", ""); expect(clientIp(request)).toBe("unknown");
  });
});
it("preserves Neon URLs and fails closed without production configuration", () => {
  const url = "postgresql://user:password@host-pooler.neon.tech/db?sslmode=require";
  expect(databaseConnectionString({ DATABASE_PROVIDER: "neon", DATABASE_URL: url })).toBe(url);
  expect(() => databaseConnectionString({ NODE_ENV: "production" })).toThrow("DATABASE_URL");
  expect(() => databaseConnectionString({ DATABASE_PROVIDER: "netlify", DATABASE_URL: url })).toThrow("DATABASE_PROVIDER");
});

it("keeps local image writes, reads and deletion working without Blob credentials", async () => {
  vi.stubEnv("NODE_ENV", "development");
  const key = "vercel-regression-" + crypto.randomUUID();
  const bytes = new Uint8Array([1, 2, 3]);
  try { await putMedia(key, bytes, { mimeType: "image/png" }); expect(Array.from((await getMedia(key))!)).toEqual(Array.from(bytes)); }
  finally { await deleteMedia(key); }
  expect(await getMedia(key)).toBeNull();
  expect(put).not.toHaveBeenCalled(); expect(get).not.toHaveBeenCalled();
});

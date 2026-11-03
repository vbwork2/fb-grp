import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@vercel/blob", () => ({ put: vi.fn(), get: vi.fn(), del: vi.fn() }));
vi.mock("@aws-sdk/client-s3", () => {
  class Command { constructor(public input: Record<string, unknown>) {} }
  return {
    S3Client: class { send = state.send; },
    PutObjectCommand: class extends Command {}, GetObjectCommand: class extends Command {},
    DeleteObjectCommand: class extends Command {}, ListObjectVersionsCommand: class extends Command {},
  };
});

import { DeleteObjectCommand, GetObjectCommand, ListObjectVersionsCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { del, get, put } from "@vercel/blob";
import { deleteMedia, getMedia, putMedia } from "../src/lib/storage";
import { createMediaStorageKey } from "../src/lib/storage/keys";

beforeEach(() => {
  vi.clearAllMocks(); state.send.mockReset();
  vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("MEDIA_STORAGE_PROVIDER", "b2");
  vi.stubEnv("B2_ENDPOINT", "https://s3.us-west-004.backblazeb2.com");
  vi.stubEnv("B2_REGION", "us-west-004"); vi.stubEnv("B2_BUCKET", "private-test-bucket");
  vi.stubEnv("B2_KEY_ID", "fixture-key"); vi.stubEnv("B2_APPLICATION_KEY", "fixture-secret");
});
afterEach(() => vi.unstubAllEnvs());

describe("B2 media routing", () => {
  it("marks new production keys and preserves routing after switching the write provider", async () => {
    const key = createMediaStorageKey();
    expect(key).toMatch(/^b2_[a-f0-9-]{36}$/);
    vi.stubEnv("MEDIA_STORAGE_PROVIDER", "vercel");
    state.send.mockResolvedValueOnce({ Body: { transformToByteArray: async () => new Uint8Array([1, 2]) } });
    expect(await getMedia(key)).toEqual(new Uint8Array([1, 2]));
    expect(state.send.mock.calls[0][0]).toBeInstanceOf(GetObjectCommand);
    expect(get).not.toHaveBeenCalled();
    expect(createMediaStorageKey()).toMatch(/^[a-f0-9-]{36}$/);
    vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("MEDIA_STORAGE_PROVIDER", "b2");
    expect(createMediaStorageKey()).not.toMatch(/^b2_/);
  });

  it("uploads original bytes with private cache headers", async () => {
    const bytes = new Uint8Array([0, 128, 255]);
    await putMedia("b2_image", bytes, { mimeType: "image/png" });
    const command = state.send.mock.calls[0][0];
    expect(command).toBeInstanceOf(PutObjectCommand);
    expect(command.input).toEqual({ Bucket: "private-test-bucket", Key: "b2_image", Body: bytes, ContentType: "image/png", CacheControl: "private, no-store" });
    expect(put).not.toHaveBeenCalled();
  });

  it("continues reading and deleting legacy Blob keys when B2 is selected", async () => {
    vi.mocked(get).mockResolvedValueOnce(null);
    expect(await getMedia("legacy-image")).toBeNull();
    await deleteMedia("legacy-image");
    expect(get).toHaveBeenCalledWith("legacy-image", { access: "private", useCache: false });
    expect(del).toHaveBeenCalledWith("legacy-image");
    expect(state.send).not.toHaveBeenCalled();
  });

  it("distinguishes a missing object from an outage without falling back to Blob", async () => {
    state.send.mockRejectedValueOnce(Object.assign(new Error("Missing"), { name: "NoSuchKey" }));
    expect(await getMedia("b2_image")).toBeNull();
    state.send.mockRejectedValueOnce(Object.assign(new Error("Forbidden"), { name: "AccessDenied" }));
    await expect(getMedia("b2_image")).rejects.toThrow("Forbidden");
    state.send.mockResolvedValueOnce({});
    await expect(getMedia("b2_image")).rejects.toThrow("Unable to read image");
    expect(get).not.toHaveBeenCalled();
  });

  it("deletes all exact versions and markers across pages without deleting matching prefixes", async () => {
    state.send.mockResolvedValueOnce({
      Versions: [{ Key: "b2_image", VersionId: "v1" }, { Key: "b2_image-other", VersionId: "untouched" }],
      DeleteMarkers: [{ Key: "b2_image", VersionId: "marker" }],
      IsTruncated: true, NextKeyMarker: "b2_image", NextVersionIdMarker: "marker",
    }).mockResolvedValueOnce({ Versions: [{ Key: "b2_image", VersionId: "v2" }], IsTruncated: false })
      .mockResolvedValueOnce({}).mockResolvedValueOnce({}).mockResolvedValueOnce({});
    await deleteMedia("b2_image");
    const commands = state.send.mock.calls.map(([command]) => command);
    expect(commands[0]).toBeInstanceOf(ListObjectVersionsCommand);
    expect(commands[1].input).toMatchObject({ KeyMarker: "b2_image", VersionIdMarker: "marker" });
    expect(commands.filter(command => command instanceof DeleteObjectCommand).map(command => command.input.VersionId)).toEqual(["v1", "marker", "v2"]);
    expect(del).not.toHaveBeenCalled();
  });

  it("treats deletion of an absent object as success and propagates failed deletion", async () => {
    state.send.mockResolvedValueOnce({});
    await deleteMedia("b2_missing");
    state.send.mockResolvedValueOnce({ Versions: [{ Key: "b2_image", VersionId: "v1" }] }).mockRejectedValueOnce(new Error("Delete denied"));
    await expect(deleteMedia("b2_image")).rejects.toThrow("Delete denied");
  });

  it("fails before contacting storage for missing configuration, invalid endpoints or unsafe keys", async () => {
    vi.stubEnv("B2_APPLICATION_KEY", "");
    await expect(putMedia("b2_image", new Uint8Array([1]), { mimeType: "image/png" })).rejects.toThrow("not configured");
    vi.stubEnv("B2_APPLICATION_KEY", "fixture-secret"); vi.stubEnv("B2_ENDPOINT", "https://untrusted.example");
    await expect(getMedia("b2_image")).rejects.toThrow("Invalid Backblaze B2 endpoint");
    await expect(deleteMedia("b2_../secret")).rejects.toThrow("Invalid storage key");
    vi.stubEnv("MEDIA_STORAGE_PROVIDER", "unknown");
    expect(createMediaStorageKey).toThrow("Invalid media storage provider");
    expect(state.send).not.toHaveBeenCalled();
  });
});

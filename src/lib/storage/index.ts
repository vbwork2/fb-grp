import "server-only";
import { del, get, put } from "@vercel/blob";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";

const localRoot = join(process.cwd(), ".local-storage", "media");

function storagePath(key: string): string {
  // Only opaque keys from database records may reach either storage adapter.
  if (!/^[a-zA-Z0-9_-]+$/.test(key)) throw new Error("Invalid storage key.");
  const target = resolve(localRoot, key);
  if (!target.startsWith(resolve(localRoot) + sep)) throw new Error("Invalid storage key.");
  return target;
}

export async function putMedia(key: string, value: Uint8Array, metadata: Record<string, string>): Promise<void> {
  const target = storagePath(key);
  if (process.env.NODE_ENV === "production") {
    await put(key, value.slice().buffer as ArrayBuffer, {
      access: "private", addRandomSuffix: false, allowOverwrite: false,
      contentType: metadata.mimeType,
    });
    return;
  }
  await mkdir(localRoot, { recursive: true });
  await writeFile(target, value);
}

export async function getMedia(key: string): Promise<Uint8Array | null> {
  const target = storagePath(key);
  if (process.env.NODE_ENV === "production") {
    // The SDK authenticates the private read; never redirect to a storage URL.
    const result = await get(key, { access: "private", useCache: false });
    if (!result) return null;
    if (result.statusCode !== 200 || !result.stream) throw new Error("Unable to read image.");
    return new Uint8Array(await new Response(result.stream).arrayBuffer());
  }
  try { return await readFile(target); } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
}

export async function deleteMedia(key: string): Promise<void> {
  const target = storagePath(key);
  if (process.env.NODE_ENV === "production") { await del(key); return; }
  try { await unlink(target); } catch (error) {
    // An already missing file does not prevent removing its metadata.
    if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error;
  }
}

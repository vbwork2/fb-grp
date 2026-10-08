import "server-only";
import { getStore } from "@netlify/blobs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";

const localRoot = join(process.cwd(), ".local-storage", "media");

export async function putMedia(key: string, value: Uint8Array, metadata: Record<string, string>): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    await getStore({ name: "groupflow-media" }).set(key, value.slice().buffer as ArrayBuffer, { metadata });
    return;
  }
  const target = resolve(localRoot, key);
  if (!target.startsWith(`${resolve(localRoot)}${sep}`)) throw new Error("Invalid storage key.");
  await mkdir(localRoot, { recursive: true });
  await writeFile(target, value);
}

export async function getMedia(key: string): Promise<Uint8Array | null> {
  if (process.env.NODE_ENV === "production") {
    const value = await getStore({ name: "groupflow-media", consistency: "strong" }).get(key, { type: "arrayBuffer" });
    return value ? new Uint8Array(value) : null;
  }
  const target = resolve(localRoot, key);
  if (!target.startsWith(`${resolve(localRoot)}${sep}`)) return null;
  try { return await readFile(target); } catch { return null; }
}

export async function deleteMedia(key: string): Promise<void> {
  if (process.env.NODE_ENV === "production") { await getStore({ name: "groupflow-media" }).delete(key); return; }
  const { unlink } = await import("node:fs/promises");
  const target = resolve(localRoot, key);
  if (target.startsWith(`${resolve(localRoot)}${sep}`)) await unlink(target).catch(() => undefined);
}

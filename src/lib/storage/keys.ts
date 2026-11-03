import { randomUUID } from "node:crypto";

export function createMediaStorageKey(): string {
  const provider = process.env.MEDIA_STORAGE_PROVIDER || "vercel";
  if (!["vercel", "b2"].includes(provider)) throw new Error("Invalid media storage provider.");
  // Store the provider in the key so changing providers never reroutes existing images.
  return `${process.env.NODE_ENV === "production" && provider === "b2" ? "b2_" : ""}${randomUUID()}`;
}

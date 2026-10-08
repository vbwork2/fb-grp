import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { media } from "@/lib/db/schema";

export async function getContentLibraryMedia(workspaceId: string, contentIds: string[]) {
  if (!contentIds.length) return {};
  const images = await db.select({
    id: media.id,
    contentId: media.contentId,
    mimeType: media.mimeType,
    originalFilename: media.originalFilename,
    sizeBytes: media.sizeBytes,
  }).from(media).where(and(
    eq(media.workspaceId, workspaceId),
    inArray(media.contentId, contentIds),
  )).orderBy(asc(media.createdAt), asc(media.id));
  const byContent: Record<string, typeof images> = {};
  for (const image of images) {
    if (image.contentId) (byContent[image.contentId] ??= []).push(image);
  }
  return byContent;
}

import "server-only";
import { DeleteObjectCommand, GetObjectCommand, ListObjectVersionsCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

let cachedClient: S3Client | undefined;

function connection() {
  const { B2_ENDPOINT: endpoint, B2_REGION: region, B2_BUCKET: bucket, B2_KEY_ID: accessKeyId, B2_APPLICATION_KEY: secretAccessKey } = process.env;
  if (!endpoint || !region || !bucket || !accessKeyId || !secretAccessKey) {
    throw new Error("Backblaze B2 storage is not configured.");
  }
  const url = new URL(endpoint);
  if (url.protocol !== "https:" || url.hostname !== `s3.${region}.backblazeb2.com` || url.port || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("Invalid Backblaze B2 endpoint.");
  }
  cachedClient ??= new S3Client({
    endpoint, region, credentials: { accessKeyId, secretAccessKey }, forcePathStyle: true,
    requestChecksumCalculation: "WHEN_REQUIRED", responseChecksumValidation: "WHEN_REQUIRED", maxAttempts: 3,
  });
  return { client: cachedClient, bucket };
}

export async function putB2Media(key: string, bytes: Uint8Array, mimeType: string): Promise<void> {
  const { client, bucket } = connection();
  await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: bytes, ContentType: mimeType, CacheControl: "private, no-store" }));
}

export async function getB2Media(key: string): Promise<Uint8Array | null> {
  const { client, bucket } = connection();
  try {
    const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    if (!result.Body) throw new Error("Unable to read image.");
    return await result.Body.transformToByteArray();
  } catch (error) {
    // Only an absent object is a cache miss; credentials and service errors must propagate.
    if (error instanceof Error && error.name === "NoSuchKey") return null;
    throw error;
  }
}

export async function deleteB2Media(key: string): Promise<void> {
  const { client, bucket } = connection();
  let keyMarker: string | undefined;
  let versionIdMarker: string | undefined;
  const versions = new Set<string>();
  do {
    const page = await client.send(new ListObjectVersionsCommand({ Bucket: bucket, Prefix: key, KeyMarker: keyMarker, VersionIdMarker: versionIdMarker }));
    // B2 retains bytes behind delete markers. Delete exact versions to actually reclaim space.
    for (const object of [...(page.Versions ?? []), ...(page.DeleteMarkers ?? [])]) {
      if (object.Key !== key) continue;
      if (!object.VersionId) throw new Error("Unable to identify image version.");
      versions.add(object.VersionId);
    }
    keyMarker = page.IsTruncated ? page.NextKeyMarker : undefined;
    versionIdMarker = page.IsTruncated ? page.NextVersionIdMarker : undefined;
    if (page.IsTruncated && !keyMarker) throw new Error("Unable to list all image versions.");
  } while (keyMarker);
  // Finish listing before deletion so pagination markers still refer to existing versions.
  for (const versionId of versions) {
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key, VersionId: versionId }));
  }
}

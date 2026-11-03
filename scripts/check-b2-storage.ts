import { randomUUID } from "node:crypto";
import { config } from "dotenv";
import { DeleteObjectCommand, GetBucketAclCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

config({ path: ".env.b2.local", quiet: true });

async function main() {
  const { B2_ENDPOINT: endpoint, B2_REGION: region, B2_BUCKET: bucket, B2_KEY_ID: accessKeyId, B2_APPLICATION_KEY: secretAccessKey } = process.env;
  if (!endpoint || !region || !bucket || !accessKeyId || !secretAccessKey) throw new Error("B2ConfigurationMissing");
  const url = new URL(endpoint);
  if (url.origin !== `https://s3.${region}.backblazeb2.com` || url.pathname !== "/" || url.username || url.password || url.search || url.hash) throw new Error("B2EndpointInvalid");
  const client = new S3Client({ endpoint, region, credentials: { accessKeyId, secretAccessKey }, forcePathStyle: true, requestChecksumCalculation: "WHEN_REQUIRED", responseChecksumValidation: "WHEN_REQUIRED" });
  const key = `b2_storage-check-${randomUUID()}`;
  let versionId: string | undefined;
  try {
    const acl = await client.send(new GetBucketAclCommand({ Bucket: bucket }));
    if (acl.Grants?.some(grant => grant.Grantee?.Type === "Group")) throw new Error("B2BucketMustBePrivate");
    const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aV1sAAAAASUVORK5CYII=", "base64");
    const uploaded = await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: bytes, ContentType: "image/png", CacheControl: "private, no-store" }));
    versionId = uploaded.VersionId;
    if (!versionId) throw new Error("B2VersionMissing");
    const downloaded = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    if (!downloaded.Body || !Buffer.from(await downloaded.Body.transformToByteArray()).equals(bytes)) throw new Error("B2ImageRoundTripFailed");
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key, VersionId: versionId }));
    versionId = undefined;
    console.log("Private bucket verified. Image upload, download and permanent deletion passed.");
  } finally {
    // Clean up only the disposable object created by this check.
    if (versionId) await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key, VersionId: versionId }));
    client.destroy();
  }
}

main().catch(error => {
  const name = error instanceof Error ? error.message.startsWith("B2") ? error.message : error.name : "UnknownError";
  console.error(`B2 storage check failed (${name}). Check private bucket settings and scoped application-key permissions.`);
  process.exitCode = 1;
});

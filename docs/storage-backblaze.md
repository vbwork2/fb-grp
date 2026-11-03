# Temporary Backblaze B2 storage

The app supports private Backblaze B2 storage while the Vercel Blob quota is suspended. This requires no database migration and no extension rebuild. Upload validation, the 4 MiB production limit, session/device authorization and workspace checks stay in the app APIs.

## Account setup

1. Create and verify a Backblaze B2 account: https://www.backblaze.com/cloud-storage.
2. Create a dedicated **Private** bucket for fb-group. Leave Object Lock disabled. Copy its S3 endpoint and region. Do not enable public access.
3. Create a standard application key restricted to this bucket, with read, write, list-file-versions and delete permissions. Do not use the master key. The optional private-bucket preflight also needs permission to read the bucket ACL.
4. Use lifecycle settings that remove old versions rather than retain them indefinitely. Each new image uses a unique key; app deletion explicitly removes versions and markers to reclaim storage.

The initial 10 GB of storage is free. Downloads and API calls have separate quotas. Review current allowances and set usage alerts/caps in the account: https://www.backblaze.com/cloud-storage/pricing. Keep the bucket dedicated to this app.

## Server configuration

Add these variables to the **fb-group** project's Production environment on Vercel. Do not change virbot or replace database/authentication secrets.

```dotenv
MEDIA_STORAGE_PROVIDER=b2
B2_ENDPOINT=https://s3.us-west-004.backblazeb2.com
B2_REGION=us-west-004
B2_BUCKET=your-private-bucket
B2_KEY_ID=your-scoped-key-id
B2_APPLICATION_KEY=your-scoped-application-key
```

Use the exact endpoint and region shown by Backblaze, not the example region above. Never prefix credentials with `NEXT_PUBLIC_`, commit them, or paste them into chat. Keep existing Blob credentials/store connections for legacy images.

For a local credential check, place the five `B2_` settings in the git-ignored `.env.b2.local` file and run `npm run storage:check`. It verifies private access and uploads, reads and permanently deletes one unique disposable PNG without changing application data. It prints no credentials. If the key cannot read bucket ACLs, the check fails before uploading; grant only the required bucket-scoped read capability.

Deploy the updated source after setting environment variables. Merely adding variables does not update the running deployment.

## Verification and rollback

- Sign in on production, attach a small PNG to a controlled content item and verify its preview. Refresh to confirm the bytes were persisted.
- Confirm the paired extension can fetch that image using its authenticated media endpoint.
- Delete the controlled test image using the app and confirm it disappears.
- New production records have `b2_` storage keys. Existing unprefixed keys still use Vercel Blob. Legacy images can remain unavailable until Vercel lifts its quota suspension; this change does not migrate those bytes.
- Campaign content copies use the selected provider for their new images. Copying a legacy image still requires its original Blob to be readable.
- To switch future writes back, set `MEDIA_STORAGE_PROVIDER=vercel` and redeploy the updated code. Keep B2 credentials so existing B2 images remain readable. Do not roll back to source that predates B2 support while B2 records exist.

Automated checks: `npm run typecheck`, `npm run lint`, and `npm run test -- tests/b2-storage.test.ts tests/vercel-storage.test.ts tests/vercel-auth-media.test.ts tests/campaign-edit.test.ts`. Controlled tests mock the external storage transport; live credentials and a production deployment are still required to establish real upload availability.

# Security model

## Data stored by the service

- Application account email, display name, and salted scrypt password hash.
- Workspace membership, Facebook Group URLs, content, campaigns, queue, and history.
- Media metadata and image files.
- Hashes of device tokens and one-time pairing codes.

## Data never collected

- Facebook passwords, cookies, browser sessions, 2FA codes, or CAPTCHA answers.

Facebook authentication takes place directly on facebook.com in the user's browser. The extension does not read or export cookies. It validates the claim, exact group and composer before clicking one enabled Post button. Explicit automatic runs support at most three selected groups, attach campaign images and reserve submissions as AWAITING_CONFIRMATION before clicking. A new recognizable publication notice is required to record automatic success. Approval, errors and uncertain results stop the run and preserve the job for review; stale claim recovery excludes reserved submissions.

Every group, content, campaign, device, media, queue, and history query is scoped to the authenticated workspace on the server. Browser-session mutation endpoints check the request origin. Extension endpoints use bearer device tokens, hashed at rest, with immediate revocation checks. Pair codes are random, one use, and expire after five minutes.

Sessions use HMAC-SHA256 signed seven-day cookies with HttpOnly, Secure in production, and SameSite=Lax settings. Passwords use Node's scrypt with a random salt. Login and other sensitive flows use database-backed rate limits.

The deployed Content Security Policy permits inline scripts required by Next.js App Router. Reassess this policy if scripts or analytics are added.


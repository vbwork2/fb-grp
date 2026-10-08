# Security model

## Data stored by the service

- Application account email, display name, and salted scrypt password hash.
- Workspace membership, Facebook Group URLs, content, campaigns, queue, and history.
- Media metadata and image files.
- Hashes of device tokens and one-time pairing codes.

## Data never collected

- Facebook passwords, cookies, browser sessions, 2FA codes, or CAPTCHA answers.

Facebook authentication takes place directly on facebook.com in the user's browser. The extension does not read or export cookies. Automatic Post is an explicit popup setting (autoClickPost), off by default. When off, only the user clicks Facebook Post. When on, verified preparation allows one automatic click. Legacy autoPublish preferences cannot silently enable this mode. There is no fixed group-count cap. Submission reservation and actual click and its user/automatic source are tracked separately. A recorded click blocks reservation release. Fresh publication evidence is required; approval, conflicting notices and unknown outcomes preserve AWAITING_CONFIRMATION. Failed/skip APIs reject that state, and Reset touches only FAILED. Publication audit records distinguish ui_confirmed from user_confirmed; repeated callbacks cannot duplicate history. Cancellation does not retract a Facebook post and cannot reopen a cancelled campaign.

Every group, content, campaign, device, media, queue, and history query is scoped to the authenticated workspace on the server. Browser-session mutation endpoints check the request origin. Extension endpoints use bearer device tokens, hashed at rest, with immediate revocation checks. Pair codes are random, one use, and expire after five minutes.

Sessions use HMAC-SHA256 signed seven-day cookies with HttpOnly, Secure in production, and SameSite=Lax settings. Passwords use Node's scrypt with a random salt. Login and other sensitive flows use database-backed rate limits.

The deployed Content Security Policy permits inline scripts required by Next.js App Router. Reassess this policy if scripts or analytics are added.


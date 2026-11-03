# Security

## Authentication

- Passwords: argon2id (19 MiB, t=2, p=1). Unknown e-mails still run one verification (timing parity); wrong password and unknown e-mail return the same error.
- Access token: JWT HS256, 15 minutes, audience-scoped; the user is loaded on every request, so disabling an account takes effect immediately.
- Refresh token: 256-bit random, stored as HMAC-SHA256 (pepper), rotated on every use, bound to the device id. A rotated/revoked token presented again revokes its whole family and is audited.
- Logout revokes the family and the device's biometric binding. Password change, admin reset and disabling revoke all sessions and bindings.
- Biometrics: a random per-device secret lives in the device secure store; the server keeps only its HMAC. It is convenience on top of a password account, never a replacement.
- Admin panel: one environment password, constant-time comparison, signed session cookie (`HttpOnly`, `SameSite=Strict`, `Secure` + `__Host-` prefix in production), per-IP lockout (5 failures / 15 min) plus a global failure ceiling. IPs are stored only as HMACs. State-changing cookie requests must come from the allowed origin (CSRF).

## Authorization

Every route calls a guard itself (not the UI): `requireUser`, `requireMembership(groupId, user, {admin})`, `requirePermission(permission)`. Outsiders get `404` for groups (existence is not revealed). The authorization matrix test exercises every admin route against: anonymous, no permission, every other permission, the right permission, and the admin session.

## Data protection

- Storage keys, WebDAV URLs and credentials never leave the server; images are served through `/api/submissions/:id/image` after membership + retention checks with `Cache-Control: private, max-age=300`.
- Uploads are re-encoded on the server (EXIF/GPS dropped). Rejected images are deleted immediately.
- Invite codes, refresh tokens and biometric secrets are stored only as HMACs. Plaintext invite codes are shown once.
- Logs are structured and redact keys containing `pass`, `secret`, `token`, `authorization`, `cookie`, `email`, `hash`, `code`; no request bodies are logged.
- Account deletion removes the user, sessions, photos (including storage objects), memberships and points; audit entries are anonymised.

## Transport and headers

`src/proxy.ts` adds HSTS, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: no-referrer`, a restrictive `Permissions-Policy` and a CSP (`unsafe-eval` and websockets only in development) to every response, and answers CORS preflights only for `CORS_ALLOWED_ORIGINS`. Production is HTTPS only (HSTS).

## Abuse protection

Rate limits (MongoDB): register 10/h/IP, login 30/10 min/IP and 10/15 min/e-mail, refresh/logout/biometric per IP, invite redemption 10/15 min/user, invite creation 30/h/user, upload intent and upload 60/h/user, account deletion attempts 5/15 min, admin login lockout. Body size limits: JSON 64 KB, photo 4 MB. Input is validated with Zod on every route; Mongoose queries are never built from raw input strings (regex search input is escaped).

## Reporting a leaked secret

If a secret was ever committed: revoke/rotate the credential immediately (new env value + redeploy; rotating `TOKEN_PEPPER` invalidates all refresh tokens, invite codes and biometric bindings), then remove it from the Git history (e.g. `git filter-repo`).

## Known limitations

See "Accepted risks" in the README.

# ChromaHunt

A private group color-hunt challenge platform. Each group is assigned one random color per day; members photograph something dominated by that color with the live camera, the server verifies the photo, and an optional weekly ranking scores the group.

> **Status:** backend API and admin web panel are complete and deployed on Vercel. The Android app lives in the separate `../mobile` project. File storage: the `filesharer` driver is live-verified (see [docs/filesharer-delete-spec.md](docs/filesharer-delete-spec.md)).

- Architecture: [docs/architecture.md](docs/architecture.md)
- Security model: [docs/security.md](docs/security.md)
- API reference: [docs/api.md](docs/api.md)
- Project rules for contributors and AI assistants: [AGENTS.md](AGENTS.md) (Hungarian)

## Repository layout

Standalone npm project (the Expo app lives in the sibling repository `../mobile`).

```
src/app/api      REST route handlers
src/app/admin    Admin panel (Tailwind, lucide-react, framer-motion; hu/en)
src/server       Server logic (env, db, auth, models, services, storage drivers)
src/shared       Zod schemas, constants, color math (CIEDE2000, k-means), timezone & scoring helpers
                 (copy kept in sync with ../mobile/src/shared)
tests, scripts   Integration tests, dev database + demo seed
docs             Architecture, security and API documentation
```

## Quick start (development)

Requirements: Node ≥ 20, npm.

```bash
npm install
# 1. local MongoDB replica set (transactions need one) on port 27018
node scripts/dev-db.mjs
# 2. configuration
cp .env.example .env.local     # fill in secrets; use STORAGE_DRIVER=fs locally
# 3. run
npm run dev                    # http://localhost:3000 (admin: /admin)
# 4. optional demo data (palette, users, a group with photos)
node scripts/seed-demo.mjs http://localhost:3000
```

Quality gates: `npx tsc --noEmit && npm run lint && npm test && npm run build`.

## Configuration

All configuration is read from environment variables and validated at first use (`src/server/env.ts`). See `.env.example` for every variable. Generate secrets with `openssl rand -base64 48`. **Never commit real values.**

| Variable | Purpose |
|---|---|
| `MONGODB_URI` | MongoDB Atlas / replica set connection string |
| `JWT_ACCESS_SECRET`, `UPLOAD_TOKEN_SECRET`, `ADMIN_SESSION_SECRET` | Signing keys (≥ 32 chars each) |
| `TOKEN_PEPPER` | HMAC key for refresh tokens, invite codes, biometric secrets |
| `ADMIN_PASSWORD` | Admin panel password (≥ 12 chars). Changing it = edit the environment and redeploy |
| `CRON_SECRET` | Bearer secret for `/api/cron/tick` |
| `STORAGE_DRIVER` | `filesharer` (production default), `webdav` or `fs` (development only) |
| `FILESHARER_URL`, `FILESHARER_API_KEY`, `FILESHARER_BASE_PATH` | File sharer uploader API (server side only) |
| `WEBDAV_URL`, `WEBDAV_USERNAME`, `WEBDAV_PASSWORD`, `WEBDAV_BASE_PATH` | WebDAV storage (server side only) |
| `CORS_ALLOWED_ORIGINS`, `APP_ORIGIN` | Browser origin allowlist / admin origin for the CSRF check |
| `PRIVACY_POLICY_VERSION` | Current privacy notice version; users must accept it |
| `EXPO_ACCESS_TOKEN` | Optional Expo push access token |

## Deployment (Vercel Hobby + MongoDB Atlas)

1. Create the Atlas cluster and a database user; allow Vercel's egress (or `0.0.0.0/0` with a strong user password).
2. Import the repository in Vercel with **Root Directory = empty (repository root)** (framework Next.js; leave Build/Output/Install commands on their defaults). `vercel.json` only holds the fallback cron. Set all environment variables.
3. Point `WEBDAV_*` to your WebDAV endpoint (HTTPS, dedicated service account).
4. **Scheduler:** something must call `GET /api/cron/tick` with `Authorization: Bearer $CRON_SECRET` every 5 minutes (for example a Render cron job or cron-job.org). Without it no daily draws, reminders, scoring or retention cleanups run (the daily Vercel cron in `vercel.json` is only a fallback, and Vercel Hobby cannot run more often).
5. Open `/admin`, sign in with `ADMIN_PASSWORD`, add palette colors (no active colors = draws are skipped and an alert is raised).

Index creation: Mongoose creates indexes (including TTL indexes) on first connection.

## Operational checklist

- [ ] Atlas continuous backup enabled, WebDAV snapshots scheduled (no backups are implemented in code – accepted risk).
- [ ] `CRON_SECRET` set and the 5-minute scheduler calling `/api/cron/tick` is running.
- [ ] At least one active palette color.
- [ ] Privacy notice text reviewed by the owner; `PRIVACY_POLICY_VERSION` bumped when it changes.
- [ ] Firebase/FCM configured in the Android build for push notifications.
- [ ] Monitor the dashboard alerts (`draw.palette_empty`, `storage.cleanup_failing`, `retention.cleanup_failing`).

## Accepted risks (summary)

1. The mobile pre-check is UX only; the server verification is authoritative.
2. Uploads are proxied through the backend (WebDAV has no presigned URLs) – more server bandwidth; revisit when traffic grows. Request size is capped at 4 MB (Vercel's body limit).
3. Camera-only capture is client enforced and can be bypassed by a modified client; a photo of a screen can pass. No automated face/person filtering – only manual removal by the group admin or the global admin.
4. Biometric unlock is device-local convenience; the password remains the fallback and the only recovery (an admin can reset it).
5. No backups beyond the provider's defaults.
6. E-mail addresses are unverified identifiers (no e-mail is ever sent).
7. Rate limiting uses fixed windows stored in MongoDB.
8. Expo Go cannot validate camera/push/biometrics – the Android release needs an EAS development build.

## Open decisions for the product owner

- Whether closeness should include a dominance factor (currently a pure ΔE2000 mapping).
- Privacy notice wording, minimum age, data-processing agreement.
- WebDAV server type and quota monitoring.
- Firebase project for push notifications.

# Architecture

## Overview

```
 Android app (Expo, planned)           Admin browser (Next.js UI)
        │ Bearer access token                   │ HttpOnly cookie (env password login)
        └──────────────┬────────────────────────┘
                       ▼
        Next.js 16 route handlers  (src/app/api)
         validate (Zod) → authorize → service → envelope
                       │
     ┌─────────────────┼───────────────────────┐
     ▼                 ▼                       ▼
 MongoDB (Mongoose)  WebDAV (server creds)   Expo Push API
```

External scheduler → `GET /api/cron/tick` every 5 minutes (draws, reminders, verification of stale uploads, scoring, weekly close, push receipts, storage outbox, hourly retention).

## Code organisation (`src/server`)

| Module | Responsibility |
|---|---|
| `env.ts`, `db.ts`, `logger.ts`, `errors.ts`, `http.ts` | Config validation, cached connection + transactions, redacting logger, error → envelope mapping, body limits |
| `auth.ts`, `tokens.ts`, `password.ts`, `crypto.ts` | Guards (`requireUser`, `requirePermission`, `requireMembership`), JWTs, argon2id, HMAC helpers |
| `rate-limit.ts` | Fixed-window limiter in MongoDB (atomic pipeline upsert, TTL cleanup) |
| `models/*` | Mongoose schemas and indexes |
| `services/auth.ts` | Register, login, rotation + reuse detection, password change, biometrics, admin reset |
| `services/groups.ts` | Groups, invites, join requests, admin transfer, leave/kick |
| `services/draw.ts` | Cooldown policy, daily draw, deadline reminders |
| `services/uploads.ts`, `verification.ts` | Upload gateway, image sanitising, authoritative colour check |
| `services/gallery.ts` | Today, calendar, image proxy, moderation |
| `services/scoring.ts` | Daily scoring, weekly aggregation, ranking |
| `services/retention.ts`, `cleanup.ts` | Retention, stale intents, storage deletion outbox |
| `services/account.ts` | Transactional account deletion |
| `services/admin.ts`, `admin-auth.ts` | Back-office operations (all audited), panel login with lockout |
| `storage/*` | `StorageDriver` abstraction: WebDAV (prod), local disk (dev), memory (tests) |
| `notifications.ts` | Localised (hu/en) Expo push, receipts, token cleanup |

Shared logic lives in `src/shared` (a mobile has its own copy in `../mobile/src/shared`): colour math, timezone helpers, scoring, Zod schemas, constants.

## Upload and verification flow

1. `POST /groups/:id/uploads/intent` – checks membership, open assignment, quota; creates a `Submission` (`awaiting_upload`) idempotently per `idempotencyKey`; returns a 10-minute, single-use upload token (JWT bound to user + submission, `jti` stored).
2. `PUT /uploads/:submissionId` – bearer + `X-Upload-Token`; the token is consumed atomically; body read with a 4 MB limit; image sanitised with sharp (orientation applied, metadata dropped, ≤ 1080 px, JPEG q80); stored through the server's WebDAV credentials; status → `pending_verification`. On storage failure the token is released so the client can retry (503 + `Retry-After`).
3. `POST /submissions/:id/finalize` – downloads the stored object, 64×64 centre crop, centre-weighted seeded k-means (k=4) in CIELAB, ΔE2000 to the assigned colour, `closeness = clamp(100·(1−(ΔE−5)/35),0,100)`. Accepted if `closeness ≥ threshold`; otherwise the object is deleted immediately. Only the request that wins the status transition performs side effects (push, deletion), so retries are safe. The cron tick verifies uploads that were never finalised.

## Timekeeping

Server time decides everything. The group timezone defines the local date of an assignment, the draw instant and the ISO week. `deadline = min(draw + deadlineHours, next draw)`, so two assignments are never open at once. DST gaps resolve to the first valid instant (tested).

## Data lifecycle

- Photos: `awaiting_upload` → `pending_verification` → `accepted` | `rejected` → `deleted` (retention/moderation). Rejected and deleted records keep no storage key.
- Storage deletions that cannot run inside a DB transaction go through the `StorageDeletionTask` outbox (retried by the tick; alert after 5 failures).
- Groups are never deleted: archived groups are read-only and receive no draws.

# API reference

Base path `/api`. Every response uses the envelope

```json
{ "success": true, "data": {}, "error": null, "meta": { "requestId": "…" } }
{ "success": false, "data": null, "error": { "code": "INVITE_INVALID", "message": "error.INVITE_INVALID", "details": {} }, "meta": { "requestId": "…" } }
```

`message` is an i18n key (`error.<CODE>`), never localised text. Authenticated calls send `Authorization: Bearer <accessToken>`. `429` responses carry `Retry-After`; `503` means storage/database is temporarily unavailable (retry, the app's offline queue keeps the photo).

Error codes: `VALIDATION_ERROR UNAUTHENTICATED FORBIDDEN NOT_FOUND CONFLICT RATE_LIMITED PAYLOAD_TOO_LARGE INTERNAL_ERROR SERVICE_UNAVAILABLE INVALID_CREDENTIALS ACCOUNT_DISABLED EMAIL_TAKEN REGISTRATION_CLOSED PRIVACY_NOT_ACCEPTED PASSWORD_CHANGE_REQUIRED TOKEN_REUSE_DETECTED INVITE_INVALID ALREADY_MEMBER JOIN_REQUEST_PENDING GROUP_ARCHIVED NO_ACTIVE_ASSIGNMENT DEADLINE_PASSED QUOTA_REACHED STORAGE_QUOTA_EXCEEDED UPLOAD_TOKEN_INVALID INVALID_IMAGE COLOR_MISMATCH ADMIN_ACCOUNT_PROTECTED`.

## Public

| Method & path | Notes |
|---|---|
| `GET /meta` | `privacyPolicyVersion`, `registrationOpen` |
| `POST /auth/register` | `{email,password(≥10),displayName,locale,deviceId,acceptedPrivacy:true,privacyPolicyVersion}` → `{user,tokens}` (201) |
| `POST /auth/login` | `{email,password,deviceId}` → `{user,tokens}` |
| `POST /auth/refresh` | `{refreshToken,deviceId}` → rotated tokens; reuse → `TOKEN_REUSE_DETECTED` |
| `POST /auth/logout` | `{refreshToken,deviceId?}` |
| `POST /auth/biometric/login` | `{deviceId,secret}` → `{user,tokens}` |
| `GET\|POST /cron/tick` | `Authorization: Bearer $CRON_SECRET` |

## Authenticated user

| Method & path | Notes |
|---|---|
| `POST /auth/change-password` | `{currentPassword,newPassword,deviceId}`; the only call (with `GET /me`, `POST /me/terms`, `DELETE /me`) allowed while `mustChangePassword` |
| `POST /auth/biometric/enroll` | `{deviceId,secret(≥32)}` |
| `GET\|PATCH\|DELETE /me` | profile; `DELETE {password}` deletes the account permanently |
| `POST /me/terms` | `{privacyPolicyVersion}` re-acceptance |
| `GET\|POST\|DELETE /push/tokens` | `POST {token,deviceId}`, `DELETE ?deviceId=` |
| `GET\|POST /groups` | `POST {name,settings?}` |
| `POST /groups/join` | `{code}` → pending join request |
| `GET /groups/:id` | members, effective settings, latest assignment |
| `PATCH /groups/:id/settings` | group admin |
| `POST /groups/:id/invites` | group admin → `{code,qrPayload,expiresAt}` (code shown once) |
| `GET /groups/:id/join-requests` | group admin |
| `POST /groups/:id/join-requests/:reqId/decision` | `{decision:"approve"\|"reject"}` |
| `GET /groups/:id/today` | colour, deadline, own progress, member progress |
| `POST /groups/:id/uploads/intent` | `{idempotencyKey,sizeBytes,contentType:"image/jpeg",capturedAt,clientColorScore?,clientSha256?}` → `{submissionId,uploadToken,uploadPath,status}` |
| `PUT /uploads/:submissionId` | raw `image/*` body ≤ 4 MB, headers `Authorization` + `X-Upload-Token` (deviation from `PUT /uploads/:token`: the token is not put into the URL) |
| `POST /submissions/:id/finalize` | → `{id,status,closenessScore\|null,rejectionReason}` (idempotent) |
| `GET /submissions/:id/image` | authenticated image proxy, `Cache-Control: private, max-age=300` |
| `GET /groups/:id/calendar?from=&to=` | accepted photos per day, clamped to the retention window, ≤ 62 days |
| `GET /groups/:id/ranking?week=YYYY-Www` | weekly leaderboard (`enabled:false` when scoring is off) |
| `POST /groups/:id/leave` | leaves (admin role transfers / group archives when empty) |
| `DELETE /groups/:id/members/:userId` | group admin removes a member |
| `DELETE /groups/:id/submissions/:sid` | group admin removes a photo |

## Admin (`/admin/*`)

Authenticated either by the admin panel cookie (superadmin, state-changing calls need a same-origin `Origin`) or by a user bearer token holding the permission.

| Path | Permission |
|---|---|
| `POST\|GET\|DELETE /admin/session` | admin password login / state / logout |
| `GET /admin/dashboard`, `GET /admin/audit` | `audit.view` |
| `GET\|PATCH /admin/settings` | `settings.manage` |
| `GET\|POST /admin/palette`, `PATCH\|DELETE /admin/palette/:id` | `palette.manage` |
| `GET /admin/users`, `GET\|PATCH\|DELETE /admin/users/:id`, `POST /admin/users/:id/reset-password` | `users.manage` |
| `PUT /admin/users/:id/permissions`, `GET /admin/users?withPermissions=true` | `permissions.manage` |
| `GET /admin/groups`, `GET /admin/groups/:id`, `PATCH …/settings`, `POST …/archive`, `POST …/reassign-admin`, `GET …/ranking`, `GET …/submissions`, `DELETE /admin/submissions/:id`, `GET /admin/submissions/:id/image` | `groups.manage` |
| `GET /admin/storage`, `POST /admin/storage/cleanup` | `storage.manage` |

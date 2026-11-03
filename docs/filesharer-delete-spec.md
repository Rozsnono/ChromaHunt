# File sharer uploader: what ChromaHunt uses

Verified against the published spec (`GET /docs`, uploader v1.1.0). The delete endpoint requested earlier now exists.

| Purpose | Call |
|---|---|
| Upload (one chunk, photos are <= 4 MB) | `POST /upload/start` -> `POST /upload/chunk` (multipart) -> `POST /upload/finish`; `POST /upload/failed` on errors |
| Download (server side only) | `GET /download?path=...` |
| Delete | `DELETE /files?path=...` (200 deleted, 404 already gone, 403 outside the key folder, 409 folder) |
| Key status | `GET /health/key` (name, folder, enabled/expiry, size; no secret) |

Paths are **relative to the API key's folder**; a folder-bound key cannot touch anything outside it, which is the minimum privilege ChromaHunt needs: create a dedicated key bound to its own folder (for example `chromahunt`).

```
STORAGE_DRIVER=filesharer
FILESHARER_URL=https://api.filesharer.rozsnorbert.hu:9443
FILESHARER_API_KEY=<key>      # server environment only, never committed
FILESHARER_BASE_PATH=         # optional sub-directory below the key folder
```

Verified on the live uploader (2026-11-03): upload without `targetPath`, byte-identical download with a relative `path`, delete, 404 afterwards and an idempotent second delete all work; no staging leftovers remain.

Files are written as `groups__<groupId>__<assignmentId>__<submissionId>.jpg`.
